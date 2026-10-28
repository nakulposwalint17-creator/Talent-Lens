"""HTTP hardening: security headers, production settings, body size limits and rate limiting."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.middleware import client_ip
from app.core.rate_limit import RateLimiter, retry_after_header
from app.main import create_app
from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD, REQUIREMENTS, auth, login, make_pdf, make_settings, upload


def _client(tmp_path, **overrides) -> TestClient:
    return TestClient(create_app(make_settings(tmp_path, **overrides), inline_evaluation=True))


# ---------------------------------------------------------------------------- headers & production
def test_security_headers_on_success_and_error_responses(client):
    for response in (client.get("/api/sessions"), client.get("/api/sessions/missing"),
                     client.get("/api/health", headers={"Authorization": ""})):
        headers = response.headers
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["x-frame-options"] == "DENY"
        assert headers["referrer-policy"] == "no-referrer"
        assert "frame-ancestors 'none'" in headers["content-security-policy"]
        assert headers["cache-control"] == "no-store"
        assert "strict-transport-security" not in headers  # development: plain HTTP on localhost


def test_api_docs_available_in_development(client):
    assert client.get("/docs").status_code == 200
    assert "content-security-policy" not in client.get("/docs").headers  # Swagger UI needs its CDN assets


def test_production_mode_hides_docs_and_sends_hsts(tmp_path):
    with _client(tmp_path, ENVIRONMENT="production", CORS_ORIGINS="https://app.example.com") as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404
        assert "max-age=" in client.get("/api/health").headers["strict-transport-security"]
    with _client(tmp_path, ENVIRONMENT="production", ENABLE_API_DOCS=True) as client:
        assert client.get("/docs").status_code == 200


def test_production_refuses_the_public_demo_password(tmp_path):
    from app.core.config import DEMO_ADMIN_PASSWORD

    make_settings(tmp_path, ADMIN_PASSWORD=DEMO_ADMIN_PASSWORD)  # fine for local development
    with pytest.raises(ValidationError, match="public demo password"):
        make_settings(tmp_path, ENVIRONMENT="production", ADMIN_PASSWORD=DEMO_ADMIN_PASSWORD,
                      CORS_ORIGINS="https://app.example.com")


def test_production_refuses_wildcard_cors(tmp_path):
    with pytest.raises(ValidationError, match="explicit origins"):
        make_settings(tmp_path, ENVIRONMENT="production", CORS_ORIGINS="*")


def test_cors_allows_only_configured_origins_and_the_auth_header(client):
    preflight = client.options("/api/sessions", headers={
        "Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
    })
    assert preflight.status_code == 200
    assert "authorization" in preflight.headers["access-control-allow-headers"].lower()
    evil = client.options("/api/sessions", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "GET",
    })
    assert "access-control-allow-origin" not in evil.headers


# ---------------------------------------------------------------------------- body size
def test_oversized_json_body_is_rejected_before_parsing(client):
    response = client.post("/api/sessions", content=b"{" + b" " * (1024 * 1024 + 10) + b"}",
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_oversized_streamed_body_without_content_length_is_rejected(client):
    def chunks():
        for _ in range(20):
            yield b"x" * (128 * 1024)

    response = client.post("/api/requirements/extract", content=chunks(),
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 413


def test_invalid_content_length_is_rejected(client):
    response = client.post("/api/sessions", content=b"{}",
                           headers={"Content-Type": "application/json", "Content-Length": "abc"})
    assert response.status_code == 400


def test_uploads_have_a_larger_body_allowance(client, session_id):
    # 1.5 MB is over the JSON cap but within the upload allowance (the 1 MB per-file limit still applies).
    response = upload(client, session_id, ("big.pdf", b"%PDF-1.4" + b"0" * (1536 * 1024)))
    assert response.status_code == 201
    assert response.json()["results"][0]["candidate"]["parse_error_code"] == "file_too_large"


# ---------------------------------------------------------------------------- rate limits
def test_rate_limiter_sliding_window():
    now = [0.0]
    limiter = RateLimiter(clock=lambda: now[0])
    assert limiter.hit("k", 2, 60) is None
    assert limiter.hit("k", 2, 60) is None
    assert limiter.hit("k", 2, 60) == pytest.approx(60)
    assert limiter.peek("k", 2, 60) == pytest.approx(60)
    now[0] = 30
    assert limiter.hit("k", 2, 60) == pytest.approx(30)
    now[0] = 60.5
    assert limiter.peek("k", 2, 60) is None
    assert limiter.hit("k", 2, 60) is None
    limiter.reset("k")
    assert limiter.peek("k", 1, 60) is None
    assert retry_after_header(0.2) == "1" and retry_after_header(29.1) == "30"


def test_rate_limiter_memory_is_bounded():
    limiter = RateLimiter(max_keys=1500)
    for i in range(3000):
        limiter.hit(f"k{i}", 5, 60)
    assert len(limiter._hits) <= 1500


def test_per_ip_request_limit(tmp_path):
    with _client(tmp_path, RATE_LIMIT_PER_MINUTE=5) as client:
        client.headers.update(auth(login(client)))  # counts as one request
        statuses = [client.get("/api/sessions").status_code for _ in range(6)]
        assert statuses[:4] == [200] * 4 and statuses[4:] == [429, 429]
        limited = client.get("/api/sessions")
        assert limited.headers["retry-after"].isdigit()
        assert limited.json()["error"]["code"] == "rate_limited"
        assert client.get("/api/health").status_code == 200  # health checks are never throttled


def test_rate_limited_responses_keep_cors_headers(tmp_path):
    with _client(tmp_path, RATE_LIMIT_PER_MINUTE=1) as client:
        client.get("/api/sessions")
        limited = client.get("/api/sessions", headers={"Origin": "http://localhost:3000"})
        assert limited.status_code == 429
        assert limited.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_rate_limiting_can_be_disabled(tmp_path):
    with _client(tmp_path, RATE_LIMIT_PER_MINUTE=1, RATE_LIMIT_ENABLED=False) as client:
        assert all(client.get("/api/health").status_code == 200 for _ in range(3))
        assert all(client.get("/api/sessions").status_code == 401 for _ in range(3))


def test_account_lockout_after_repeated_failed_logins(tmp_path):
    with _client(tmp_path, LOGIN_FAILURES_PER_ACCOUNT=3) as client:
        for _ in range(3):
            assert client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": "guess"}).status_code == 401
        locked = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert locked.status_code == 429  # even the right password is refused while locked
        assert int(locked.headers["retry-after"]) > 0
        # Other accounts are unaffected by the lockout.
        other = client.post("/api/auth/login", json={"email": "someone@example.com", "password": "x"})
        assert other.status_code == 401


def test_successful_login_resets_the_failure_count(tmp_path):
    with _client(tmp_path, LOGIN_FAILURES_PER_ACCOUNT=3) as client:
        for _ in range(2):
            client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": "guess"})
        login(client)
        for _ in range(2):
            client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": "guess"})
        login(client)


def test_login_attempts_are_limited_per_ip(tmp_path):
    with _client(tmp_path, LOGIN_ATTEMPTS_PER_IP=3) as client:
        statuses = [client.post("/api/auth/login", json={"email": f"u{i}@example.com", "password": "x"}).status_code
                    for i in range(4)]
        assert statuses == [401, 401, 401, 429]


def test_expensive_operations_are_limited_per_user(tmp_path):
    with _client(tmp_path, RATE_LIMIT_EXPENSIVE_PER_MINUTE=2) as client:
        client.headers.update(auth(login(client)))
        sid = client.post("/api/sessions", json={"job_title": "Engineer", "requirements": REQUIREMENTS}).json()
        sid = sid["session"]["id"]
        assert upload(client, sid, ("a.pdf", make_pdf())).status_code == 201
        assert client.post(f"/api/sessions/{sid}/evaluate", json={}).status_code == 202
        limited = upload(client, sid, ("b.pdf", make_pdf()))
        assert limited.status_code == 429 and limited.headers["retry-after"].isdigit()
        # Cheap reads stay available.
        assert client.get(f"/api/sessions/{sid}").status_code == 200


def test_client_ip_trusts_only_the_configured_proxy_hops():
    scope = {"client": ("10.0.0.1", 1234), "headers": [(b"x-forwarded-for", b"6.6.6.6, 203.0.113.7")]}
    assert client_ip(scope) == "10.0.0.1"  # no trusted proxy: the header is ignored
    assert client_ip(scope, 1) == "203.0.113.7"  # appended by our proxy; 6.6.6.6 was forged by the client
    assert client_ip(scope, 2) == "6.6.6.6"
    assert client_ip({"client": ("10.0.0.1", 1), "headers": []}, 1) == "10.0.0.1"
    assert client_ip({"headers": []}) == "unknown"


def test_spoofed_forwarded_for_cannot_evade_the_ip_limit(tmp_path):
    with _client(tmp_path, LOGIN_ATTEMPTS_PER_IP=2, TRUSTED_PROXY_HOPS=1) as client:
        statuses = [
            client.post("/api/auth/login", json={"email": "x@example.com", "password": "x"},
                        headers={"X-Forwarded-For": f"10.9.9.{i}, 198.51.100.4"}).status_code
            for i in range(3)
        ]
        assert statuses == [401, 401, 429]
