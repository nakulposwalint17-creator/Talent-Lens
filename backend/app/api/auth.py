"""Sign-in, sign-out, the current account, and administrator user management."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import (
    bearer_token,
    get_current_user,
    get_db,
    get_limiter,
    get_settings_dep,
    login_rate_key,
    require_admin,
)
from app.api.errors import AppError, not_found
from app.core.config import Settings
from app.core.rate_limit import RateLimiter, retry_after_header
from app.core.security import hash_password, verify_password
from app.models import User
from app.schemas.api import LoginRequest, LoginResponse, PasswordChange, UserCreate, UserOut, UserUpdate
from app.services.auth import (
    authenticate,
    create_user,
    get_user_by_email,
    issue_token,
    normalise_email,
    revoke_all_tokens,
    revoke_token,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
users_router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(require_admin)])

LOGIN_WINDOW_SECONDS = 15 * 60
INVALID_CREDENTIALS = "The email or password is incorrect."


def user_out(user: User) -> UserOut:
    return UserOut.model_validate(user, from_attributes=True)


def _too_many(retry: float) -> AppError:
    return AppError(429, "rate_limited", "Too many sign-in attempts. Please wait before trying again.",
                    {"retry_after": retry_after_header(retry)})


@router.post("/login", response_model=LoginResponse, summary="Exchange email and password for a bearer token")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db),
          settings: Settings = Depends(get_settings_dep),
          limiter: RateLimiter = Depends(get_limiter)) -> LoginResponse:
    account_key = f"login-fail:{normalise_email(payload.email)}"
    if settings.rate_limit_enabled:
        # Per-IP cap on all attempts, and a per-account lockout after repeated failures
        # (checked first, so a locked account can't be probed further).
        retry = limiter.peek(account_key, settings.login_failures_per_account, LOGIN_WINDOW_SECONDS)
        if retry is None:
            retry = limiter.hit(login_rate_key(request), settings.login_attempts_per_ip, LOGIN_WINDOW_SECONDS)
        if retry is not None:
            raise _too_many(retry)
    user = authenticate(db, payload.email, payload.password)
    if user is None:
        if settings.rate_limit_enabled:
            limiter.hit(account_key, settings.login_failures_per_account, LOGIN_WINDOW_SECONDS)
        raise AppError(401, "invalid_credentials", INVALID_CREDENTIALS)
    limiter.reset(account_key)
    token, expires_at = issue_token(db, user, settings)
    db.commit()
    return LoginResponse(token=token, expires_at=expires_at, user=user_out(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke the current token")
def logout(request: Request, db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> Response:
    token = bearer_token(request)
    if token:
        revoke_token(db, token)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserOut, summary="The signed-in account")
def me(user: User = Depends(get_current_user)) -> UserOut:
    return user_out(user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT,
             summary="Change your password (signs out every other session)")
def change_password(payload: PasswordChange, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)) -> Response:
    if not verify_password(payload.current_password, user.password_hash):
        raise AppError(422, "invalid_credentials", "The current password is incorrect.")
    user.password_hash = hash_password(payload.new_password)
    revoke_all_tokens(db, user, keep=bearer_token(request))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------- admin: users
@users_router.get("", response_model=list[UserOut], summary="List accounts (admin)")
def list_users(db: Session = Depends(get_db)) -> list[UserOut]:
    return [user_out(u) for u in db.scalars(select(User).order_by(User.created_at))]


@users_router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED, summary="Create an account (admin)")
def add_user(payload: UserCreate, db: Session = Depends(get_db)) -> UserOut:
    if get_user_by_email(db, payload.email) is not None:
        raise AppError(409, "email_taken", "An account with this email already exists.")
    try:
        user = create_user(db, payload.email, payload.password, role=payload.role, display_name=payload.display_name)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError(409, "email_taken", "An account with this email already exists.") from None
    return user_out(user)


@users_router.patch("/{user_id}", response_model=UserOut,
                    summary="Change role, active status, name or password (admin)")
def update_user(user_id: str, payload: UserUpdate, db: Session = Depends(get_db)) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User")
    demoting = (payload.role is not None and payload.role != "admin") or payload.is_active is False
    if demoting and user.role == "admin" and user.is_active:
        remaining = db.scalar(select(func.count()).select_from(User).where(
            User.role == "admin", User.is_active.is_(True), User.id != user.id)) or 0
        if remaining == 0:
            raise AppError(409, "last_admin", "At least one active administrator must remain.")
    if payload.role is not None:
        user.role = payload.role
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip() or None
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
        revoke_all_tokens(db, user)
    if payload.is_active is not None:
        user.is_active = payload.is_active
        if not payload.is_active:
            revoke_all_tokens(db, user)
    db.commit()
    db.refresh(user)
    return user_out(user)
