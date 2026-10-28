"""FastAPI dependencies resolved from application state (overridable in tests)."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.core.config import Settings
from app.core.middleware import client_ip
from app.core.rate_limit import RateLimiter, retry_after_header
from app.models import ScreeningSession, User
from app.schemas.api import ProviderInfo
from app.services.auth import resolve_token
from app.services.evaluation import EvaluationRunner
from app.services.providers.base import AIProvider
from app.services.providers.factory import ProviderSelection


def get_db(request: Request) -> Iterator[Session]:
    db = request.app.state.database.session()
    try:
        yield db
    finally:
        db.close()


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_provider(request: Request) -> AIProvider:
    return request.app.state.provider_selection.provider


def get_runner(request: Request) -> EvaluationRunner:
    return request.app.state.runner


def provider_info(selection: ProviderSelection) -> ProviderInfo:
    provider = selection.provider
    return ProviderInfo(
        name=provider.name,
        mode="live" if provider.is_live else "demo",
        model=provider.model,
        method_label=provider.method_label,
        warning=selection.warning,
    )


def get_provider_info(request: Request) -> ProviderInfo:
    return provider_info(request.app.state.provider_selection)


def get_limiter(request: Request) -> RateLimiter:
    return request.app.state.limiter


def bearer_token(request: Request) -> str | None:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    return token.strip() or None if scheme.lower() == "bearer" else None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    """Every non-public endpoint depends on this: a valid, unexpired token for an active account."""
    token = bearer_token(request)
    user = resolve_token(db, token) if token else None
    if user is None:
        raise AppError(401, "not_authenticated", "Sign in to continue.")
    request.state.user = user
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise AppError(403, "forbidden", "Only administrators can do this.")
    return user


def can_access(user: User, session: ScreeningSession) -> bool:
    """Object-level authorisation: recruiters own their screenings; admins can see all of them."""
    return user.role == "admin" or session.owner_id == user.id


def limit_expensive(request: Request, user: User = Depends(get_current_user),
                    settings: Settings = Depends(get_settings_dep)) -> None:
    """Per-user cap on endpoints that parse files or call the AI provider."""
    if not settings.rate_limit_enabled:
        return
    retry = get_limiter(request).hit(f"expensive:{user.id}", settings.rate_limit_expensive_per_minute, 60)
    if retry is not None:
        raise AppError(429, "rate_limited", "Too many uploads or evaluation requests. Please wait a moment and retry.",
                       {"retry_after": retry_after_header(retry)})


def login_rate_key(request: Request) -> str:
    return f"login-ip:{client_ip(request.scope, request.app.state.settings.trusted_proxy_hops)}"
