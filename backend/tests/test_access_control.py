"""Authorisation: every route is protected, and users only reach their own screenings."""

from __future__ import annotations

import re

import pytest

from tests.conftest import REQUIREMENTS, add_user, auth, make_pdf

PUBLIC_ROUTES = {("GET", "/api/health"), ("POST", "/api/auth/login")}


def _routes(app):
    # The OpenAPI schema lists every mounted operation, including ones added later.
    for path, operations in app.openapi()["paths"].items():
        for method in operations:
            yield method.upper(), path


def test_every_route_except_health_and_login_requires_authentication(anon_client):
    checked = 0
    for method, path in _routes(anon_client.app):
        if (method, path) in PUBLIC_ROUTES:
            continue
        url = re.sub(r"\{[^}]+\}", "abc123", path)
        response = anon_client.request(method, url, json={})
        assert response.status_code == 401, f"{method} {path} returned {response.status_code}"
        checked += 1
    assert checked >= 20  # guards against the route discovery silently finding nothing


def test_public_routes_are_minimal(anon_client):
    assert anon_client.get("/api/health").status_code == 200
    assert anon_client.get("/api/config").status_code == 401
    assert anon_client.get("/api/dashboard").status_code == 401


def _create_session(client, token: str, title: str) -> str:
    response = client.post("/api/sessions", headers=auth(token),
                           json={"job_title": title, "requirements": REQUIREMENTS})
    assert response.status_code == 201, response.text
    return response.json()["session"]["id"]


@pytest.fixture
def two_recruiters(client):
    alice = add_user(client, "alice@example.com")
    bob = add_user(client, "bob@example.com")
    sid = _create_session(client, alice, "Alice's role")
    upload_response = client.post(f"/api/sessions/{sid}/resumes", headers=auth(alice),
                                  files=[("files", ("cv.pdf", make_pdf(), "application/pdf"))])
    cid = upload_response.json()["results"][0]["candidate"]["id"]
    return alice, bob, sid, cid


def test_recruiter_cannot_reach_another_recruiters_session(client, two_recruiters):
    _, bob, sid, _ = two_recruiters
    headers = auth(bob)
    requests = [
        ("GET", f"/api/sessions/{sid}", None),
        ("PUT", f"/api/sessions/{sid}/requirements", {"requirements": REQUIREMENTS}),
        ("POST", f"/api/sessions/{sid}/evaluate", {}),
        ("GET", f"/api/sessions/{sid}/export.csv", None),
        ("GET", f"/api/sessions/{sid}/events", None),
        ("DELETE", f"/api/sessions/{sid}", None),
    ]
    for method, url, body in requests:
        response = client.request(method, url, headers=headers, json=body)
        # 404, not 403: another user's screening is indistinguishable from one that doesn't exist.
        assert response.status_code == 404, f"{method} {url}"
    upload_attempt = client.post(f"/api/sessions/{sid}/resumes", headers=headers,
                                 files=[("files", ("cv.pdf", make_pdf(), "application/pdf"))])
    assert upload_attempt.status_code == 404
    assert client.get("/api/sessions", headers=headers).json() == []
    assert client.get("/api/dashboard", headers=headers).json()["metrics"]["sessions"] == 0


def test_recruiter_cannot_reach_another_recruiters_candidates(client, two_recruiters):
    _, bob, _, cid = two_recruiters
    headers = auth(bob)
    requests = [
        ("GET", f"/api/candidates/{cid}", None),
        ("POST", f"/api/candidates/{cid}/evaluate", None),
        ("POST", f"/api/candidates/{cid}/decisions", {"decision": "reject", "reason": "x"}),
        ("GET", f"/api/candidates/{cid}/decisions", None),
        ("PUT", f"/api/candidates/{cid}/duplicate-resolution", {"resolution": "not_duplicate"}),
    ]
    for method, url, body in requests:
        assert client.request(method, url, headers=headers, json=body).status_code == 404, f"{method} {url}"


def test_owner_and_admin_can_access(client, two_recruiters):
    alice, _, sid, cid = two_recruiters
    assert client.get(f"/api/sessions/{sid}", headers=auth(alice)).status_code == 200
    assert client.get(f"/api/candidates/{cid}", headers=auth(alice)).status_code == 200
    assert [s["id"] for s in client.get("/api/sessions", headers=auth(alice)).json()] == [sid]
    # The admin client sees every recruiter's screenings.
    assert client.get(f"/api/sessions/{sid}").status_code == 200
    assert sid in [s["id"] for s in client.get("/api/sessions").json()]


def test_audit_trail_records_who_acted(client, two_recruiters):
    alice, _, sid, cid = two_recruiters
    decision = client.post(f"/api/candidates/{cid}/decisions", headers=auth(alice),
                           json={"decision": "needs_review"})
    assert decision.status_code == 201
    assert decision.json()["recorded_by"] == "alice@example.com"
    events = client.get(f"/api/sessions/{sid}/events", headers=auth(alice)).json()
    actors = {e["event_type"]: e["actor"] for e in events}
    assert actors["session_created"] == actors["resume_uploaded"] == actors["recruiter_decision"] == "alice@example.com"


def test_user_management_is_admin_only(client):
    recruiter = add_user(client, "rec@example.com")
    headers = auth(recruiter)
    assert client.get("/api/users", headers=headers).status_code == 403
    attempt = client.post("/api/users", headers=headers,
                          json={"email": "evil@example.com", "password": "long-enough-password", "role": "admin"})
    assert attempt.status_code == 403
    me = client.get("/api/auth/me", headers=headers).json()
    assert client.patch(f"/api/users/{me['id']}", headers=headers, json={"role": "admin"}).status_code == 403


def test_admin_user_management(client):
    created = client.post("/api/users", json={"email": " New@Example.com ", "password": "long-enough-password",
                                              "display_name": "New"})
    assert created.status_code == 201 and created.json()["email"] == "new@example.com"
    assert created.json()["role"] == "recruiter"
    duplicate = client.post("/api/users", json={"email": "new@example.com", "password": "long-enough-password"})
    assert duplicate.status_code == 409
    weak = client.post("/api/users", json={"email": "weak@example.com", "password": "short"})
    assert weak.status_code == 422
    invalid = client.post("/api/users", json={"email": "not-an-email", "password": "long-enough-password"})
    assert invalid.status_code == 422
    assert {u["email"] for u in client.get("/api/users").json()} == {"admin@example.com", "new@example.com"}
    promoted = client.patch(f"/api/users/{created.json()['id']}", json={"role": "admin"})
    assert promoted.json()["role"] == "admin"
    assert client.patch("/api/users/missing", json={"role": "admin"}).status_code == 404


def test_last_active_admin_cannot_be_removed(client):
    admin_id = client.get("/api/auth/me").json()["id"]
    assert client.patch(f"/api/users/{admin_id}", json={"role": "recruiter"}).json()["error"]["code"] == "last_admin"
    assert client.patch(f"/api/users/{admin_id}", json={"is_active": False}).status_code == 409
    second = client.post("/api/users", json={"email": "second@example.com", "password": "long-enough-password",
                                             "role": "admin"})
    assert second.status_code == 201
    assert client.patch(f"/api/users/{admin_id}", json={"role": "recruiter"}).status_code == 200

