"""Accounts and server-side login sessions."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import DUMMY_PASSWORD_HASH, hash_password, new_session_token, token_digest, verify_password
from app.models import AuthToken, ScreeningSession, User

logger = logging.getLogger(__name__)

ROLES = ("admin", "recruiter")


def normalise_email(email: str) -> str:
    return email.strip().lower()


def _as_utc(value: datetime) -> datetime:
    # SQLite returns naive datetimes even for timezone-aware columns.
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalars(select(User).where(User.email == normalise_email(email))).first()


def create_user(db: Session, email: str, password: str, *, role: str = "recruiter",
                display_name: str | None = None) -> User:
    user = User(email=normalise_email(email), password_hash=hash_password(password), role=role,
                display_name=display_name)
    db.add(user)
    db.flush()
    return user


def authenticate(db: Session, email: str, password: str) -> User | None:
    """Return the active user for these credentials, or None. Runs in constant time
    with respect to whether the account exists."""
    user = get_user_by_email(db, email)
    valid = verify_password(password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if user is None or not valid or not user.is_active:
        return None
    return user


def issue_token(db: Session, user: User, settings: Settings) -> tuple[str, datetime]:
    token = new_session_token()
    now = datetime.now(UTC)
    expires_at = now + timedelta(hours=settings.auth_token_ttl_hours)
    db.add(AuthToken(token_hash=token_digest(token), user_id=user.id, expires_at=expires_at))
    user.last_login_at = now
    # Opportunistic clean-up keeps the table small without a scheduler.
    db.execute(delete(AuthToken).where(AuthToken.expires_at < now))
    db.flush()
    return token, expires_at


def resolve_token(db: Session, token: str) -> User | None:
    record = db.scalars(select(AuthToken).where(AuthToken.token_hash == token_digest(token))).first()
    if record is None:
        return None
    if _as_utc(record.expires_at) <= datetime.now(UTC):
        db.delete(record)
        db.commit()
        return None
    user = record.user
    return user if user.is_active else None


def revoke_token(db: Session, token: str) -> None:
    db.execute(delete(AuthToken).where(AuthToken.token_hash == token_digest(token)))


def revoke_all_tokens(db: Session, user: User, *, keep: str | None = None) -> None:
    """Sign the user out everywhere, optionally keeping the session for token ``keep``."""
    stmt = delete(AuthToken).where(AuthToken.user_id == user.id)
    if keep is not None:
        stmt = stmt.where(AuthToken.token_hash != token_digest(keep))
    db.execute(stmt)


def ensure_bootstrap_admin(db: Session, settings: Settings) -> User | None:
    """Create the administrator named by ADMIN_EMAIL/ADMIN_PASSWORD if it does not exist yet.

    An existing account is never modified, so changing ADMIN_PASSWORD later does not
    silently reset a password that was changed in the app. Screenings created before
    authentication existed are assigned to this administrator.
    """
    if not settings.admin_email or settings.admin_password is None:
        if db.scalars(select(User.id).limit(1)).first() is None:
            logger.warning("No user accounts exist. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first "
                           "administrator; until then nobody can sign in.")
        return None
    user = get_user_by_email(db, settings.admin_email)
    if user is None:
        user = create_user(db, settings.admin_email, settings.admin_password.get_secret_value(), role="admin",
                           display_name="Administrator")
        logger.info("Created bootstrap administrator account.")
    for session in db.scalars(select(ScreeningSession).where(ScreeningSession.owner_id.is_(None))):
        session.owner_id = user.id
    db.commit()
    return user
