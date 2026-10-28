"""HTTP hardening: security headers, request body size cap and a per-IP request rate limit.

These are plain ASGI middlewares so they also apply to error responses and to
requests that never reach a route.
"""

from __future__ import annotations

import json
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import Settings
from app.core.rate_limit import RateLimiter, retry_after_header

_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


def client_ip(scope: Scope, trusted_proxy_hops: int = 0) -> str:
    """The caller's address. Behind N trusted proxies, the Nth X-Forwarded-For entry from the right is the
    one our nearest proxy saw; entries further left are supplied by the client and can be forged."""
    if trusted_proxy_hops:
        forwarded = [h for k, h in scope.get("headers", []) if k == b"x-forwarded-for"]
        hops = [part.strip() for h in forwarded for part in h.decode("latin-1").split(",") if part.strip()]
        if len(hops) >= trusted_proxy_hops:
            return hops[-trusted_proxy_hops]
    client = scope.get("client")
    return client[0] if client else "unknown"


async def send_error(send: Send, status: int, code: str, message: str,
                     headers: list[tuple[bytes, bytes]] | None = None) -> None:
    body = json.dumps({"error": {"code": code, "message": message, "details": None}}).encode()
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
                    *(headers or [])],
    })
    await send({"type": "http.response.body", "body": body})


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.hsts = settings.is_production

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope.get("path", "")
        docs = path.startswith(_DOCS_PATHS)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers += [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), interest-cohort=()"),
                    (b"cross-origin-opener-policy", b"same-origin"),
                ]
                if not docs:
                    # JSON/CSV only: nothing here should ever be rendered or framed as a page.
                    headers.append((b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"))
                if path.startswith("/api/"):
                    # Responses contain candidate personal data; keep them out of shared and browser caches.
                    headers.append((b"cache-control", b"no-store"))
                if self.hsts:
                    headers.append((b"strict-transport-security", b"max-age=63072000; includeSubDomains"))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


class BodySizeLimitMiddleware:
    """Rejects oversized request bodies before they are buffered or parsed.

    Uploads may carry up to MAX_FILES_PER_REQUEST files of MAX_UPLOAD_MB each (plus
    multipart overhead); every other endpoint takes small JSON bodies.
    """

    def __init__(self, app: ASGIApp, settings: Settings, json_limit: int = 1024 * 1024) -> None:
        self.app = app
        self.upload_limit = settings.max_files_per_request * settings.max_upload_bytes + 1024 * 1024
        self.json_limit = json_limit

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = self.upload_limit if scope.get("path", "").endswith("/resumes") else self.json_limit
        declared = dict(scope.get("headers", [])).get(b"content-length")
        if declared is not None:
            try:
                too_large = int(declared) > limit
            except ValueError:
                await send_error(send, 400, "bad_request", "Invalid Content-Length header.")
                return
            if too_large:
                await send_error(send, 413, "payload_too_large", "The request body is too large.")
                return

        received = 0
        started = rejected = False

        async def counting_receive() -> Message:
            nonlocal received, rejected
            if rejected:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # Answer now and present the rest of the request as a disconnect. (Raising here
                    # would be caught by FastAPI's body parsing and reported as a generic 400.)
                    rejected = True
                    if not started:
                        await send_error(send, 413, "payload_too_large", "The request body is too large.")
                    return {"type": "http.disconnect"}
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if rejected:
                return  # the 413 has already been sent
            started = started or message["type"] == "http.response.start"
            await send(message)

        try:
            await self.app(scope, counting_receive, tracking_send)
        except Exception:
            if not rejected:
                raise


class RateLimitMiddleware:
    """Caps the number of /api requests per client IP per minute."""

    def __init__(self, app: ASGIApp, settings: Settings, limiter: RateLimiter) -> None:
        self.app = app
        self.enabled = settings.rate_limit_enabled
        self.limit = settings.rate_limit_per_minute
        self.hops = settings.trusted_proxy_hops
        self.limiter = limiter

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path: str = scope.get("path", "")
        exempt = scope["type"] != "http" or not path.startswith("/api/") or path == "/api/health" \
            or scope.get("method") == "OPTIONS"
        if self.enabled and not exempt:
            retry = self.limiter.hit(f"ip:{client_ip(scope, self.hops)}", self.limit, 60)
            if retry is not None:
                await send_error(send, 429, "rate_limited", "Too many requests. Please slow down and retry shortly.",
                                 [(b"retry-after", retry_after_header(retry).encode())])
                return
        await self.app(scope, receive, send)


def install_middleware(app: Any, settings: Settings, limiter: RateLimiter) -> None:
    # Starlette wraps in reverse order of registration: the last one added runs first.
    app.add_middleware(RateLimitMiddleware, settings=settings, limiter=limiter)
    app.add_middleware(BodySizeLimitMiddleware, settings=settings)
    app.add_middleware(SecurityHeadersMiddleware, settings=settings)
