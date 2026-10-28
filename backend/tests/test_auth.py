"""Authentication: password hashing, login, tokens, bootstrap admin and schema migration."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, inspect, text

from app.core.database import Database
from app.core.security import hash_password, token_digest, verify_password
from app.main import create_app
from app.models import AuthToken, ScreeningSession, User
from tests.conftest import ADMIN_EMAIL, ADMIN_PASSWORD, REQUIREMENTS, add_user, auth, login, make_settings


def test_password_hashing_round_trip():
    encoded = hash_password("s3cret-password!")
    assert encoded.startswith("scrypt$") and "s3cret" not in encoded
    assert verify_password("s3cret-password!", encoded)
    assert not verify_password("wrong-password", encoded)
    assert hash_password("same") != hash_password("same")  # per-hash salt


@pytest.mark.parametrize("encoded", ["", "plain", "bcrypt$1$2$3$4$5", "scrypt$x$8$1$AAAA$BBBB"])
def test_malformed_hashes_never_verify(encoded):
    assert not verify_password("anything", encoded)


def test_login_me_and_logout(anon_client):
    response = anon_client.post("/api/auth/login", json={"email": "  Admin@Example.com ", "password": ADMIN_PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer" and body["user"]["role"] == "admin"
    assert "password" not in str(body).lower().replace("password_", "")
    headers = auth(body["token"])
    me = anon_client.get("/api/auth/me", headers=headers).json()
    assert me["email"] == ADMIN_EMAIL and me["last_login_at"]

    assert anon_client.post("/api/auth/logout", headers=headers).status_code == 204
    assert anon_client.get("/api/auth/me", headers=headers).status_code == 401


def test_wrong_password_and_unknown_email_look_identical(anon_client):
    wrong = anon_client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": "nope"})
    unknown = anon_client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    assert wrong.json()["error"]["code"] == "invalid_credentials"


def test_tokens_are_stored_only_as_digests(anon_client):
    token = login(anon_client)
    with anon_client.app.state.database.session() as db:
        stored = [t.token_hash for t in db.query(AuthToken).all()]
    assert token not in stored and token_digest(token) in stored


@pytest.mark.parametrize("header", ["", "Bearer", "Bearer ", "Basic YWRtaW46cGFzcw==", "Bearer not-a-real-token"])
def test_missing_or_invalid_credentials_are_rejected(anon_client, header):
    response = anon_client.get("/api/sessions", headers={"Authorization": header} if header else {})
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert response.json()["error"]["code"] == "not_authenticated"


def test_expired_token_is_rejected_and_removed(anon_client):
    token = login(anon_client)
    with anon_client.app.state.database.session() as db:
        record = db.query(AuthToken).filter_by(token_hash=token_digest(token)).one()
        record.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    assert anon_client.get("/api/auth/me", headers=auth(token)).status_code == 401
    with anon_client.app.state.database.session() as db:
        assert db.query(AuthToken).filter_by(token_hash=token_digest(token)).first() is None


def test_change_password_revokes_existing_sessions(client):
    other = login(client)
    bad = client.post("/api/auth/password", json={"current_password": "wrong", "new_password": "a-brand-new-password"})
    assert bad.status_code == 422
    ok = client.post("/api/auth/password",
                     json={"current_password": ADMIN_PASSWORD, "new_password": "a-brand-new-password"})
    assert ok.status_code == 204
    assert client.get("/api/auth/me", headers=auth(other)).status_code == 401
    login(client, ADMIN_EMAIL, "a-brand-new-password")
    short = client.post("/api/auth/password", json={"current_password": "x", "new_password": "short"})
    assert short.status_code == 422


def test_deactivated_user_loses_access_immediately(client):
    token = add_user(client, "rec@example.com")
    user_id = client.get("/api/auth/me", headers=auth(token)).json()["id"]
    assert client.patch(f"/api/users/{user_id}", json={"is_active": False}).json()["is_active"] is False
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401
    denied = client.post("/api/auth/login", json={"email": "rec@example.com", "password": "recruiter-password-1"})
    assert denied.status_code == 401


def test_admin_password_reset_revokes_tokens(client):
    token = add_user(client, "rec@example.com")
    user_id = client.get("/api/auth/me", headers=auth(token)).json()["id"]
    client.patch(f"/api/users/{user_id}", json={"password": "reset-by-admin-123", "display_name": "  Rec  "})
    assert client.get("/api/auth/me", headers=auth(token)).status_code == 401
    me = client.get("/api/auth/me", headers=auth(login(client, "rec@example.com", "reset-by-admin-123"))).json()
    assert me["display_name"] == "Rec"


def test_bootstrap_admin_is_created_once_and_never_overwritten(tmp_path):
    with TestClient(create_app(make_settings(tmp_path), inline_evaluation=True)) as first:
        login(first)
    changed = make_settings(tmp_path, ADMIN_PASSWORD="a-different-password")
    with TestClient(create_app(changed, inline_evaluation=True)) as second:
        login(second)  # the original password still works
        rejected = second.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": "a-different-password"})
        assert rejected.status_code == 401
        with second.app.state.database.session() as db:
            assert db.query(User).count() == 1


def test_without_bootstrap_credentials_nobody_can_sign_in(tmp_path, caplog):
    settings = make_settings(tmp_path, ADMIN_EMAIL=None, ADMIN_PASSWORD=None)
    with caplog.at_level(logging.WARNING), TestClient(create_app(settings, inline_evaluation=True)) as anon:
        response = anon.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert response.status_code == 401
    assert "No user accounts exist" in caplog.text


def test_weak_bootstrap_password_is_refused(tmp_path):
    with pytest.raises(ValidationError, match="at least 12 characters"):
        make_settings(tmp_path, ADMIN_PASSWORD="short")


def test_legacy_database_is_migrated_and_orphan_sessions_go_to_admin(tmp_path):
    url = f"sqlite:///{tmp_path / 'talentlens.db'}"
    legacy = create_engine(url)
    with legacy.begin() as conn:  # the screening_sessions table as the first release created it
        conn.execute(text(
            "CREATE TABLE screening_sessions (id VARCHAR(32) PRIMARY KEY, job_title VARCHAR(200), "
            "department VARCHAR(120), job_description TEXT, requirements JSON, requirements_source VARCHAR(20), "
            "requirements_version INTEGER, extraction_meta JSON, scoring_config JSON, scoring_version VARCHAR(40), "
            "created_at DATETIME, updated_at DATETIME)"
        ))
        conn.execute(text(
            "INSERT INTO screening_sessions VALUES ('legacy1', 'Old job', NULL, '', :req, 'manual', 1, NULL, '{}', "
            "'v1', '2025-01-01 00:00:00', '2025-01-01 00:00:00')"
        ), {"req": json.dumps(REQUIREMENTS)})
    legacy.dispose()

    database = Database(url)
    database.init_schema()
    columns = {c["name"] for c in inspect(database.engine).get_columns("screening_sessions")}
    database.engine.dispose()
    assert "owner_id" in columns

    with TestClient(create_app(make_settings(tmp_path), inline_evaluation=True)) as client:
        with client.app.state.database.session() as db:
            admin = db.query(User).filter_by(email=ADMIN_EMAIL).one()
            assert db.get(ScreeningSession, "legacy1").owner_id == admin.id
