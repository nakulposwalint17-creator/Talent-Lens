"""Runtime configuration loaded from environment variables (and an optional .env file)."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]

APP_VERSION = "1.1.0"
MIN_PASSWORD_LENGTH = 12

# Public demo login, published in the README and created by scripts/setup.sh for local
# use. Because it is public, the application refuses to start with it in production.
DEMO_ADMIN_EMAIL = "admin@talentlens.local"
DEMO_ADMIN_PASSWORD = "5zAFCJZhXDi4Suo1hp-n8K8b"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", BACKEND_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Deployment --------------------------------------------------------
    # "production" disables the interactive API docs, adds HSTS and refuses
    # unsafe settings (wildcard CORS, weak bootstrap passwords) at startup.
    environment: Literal["development", "production"] = Field(default="development", alias="ENVIRONMENT")
    enable_api_docs: bool | None = Field(default=None, alias="ENABLE_API_DOCS")

    # --- Authentication ----------------------------------------------------
    # Bootstrap administrator, created on startup if no user has this email.
    admin_email: str | None = Field(default=None, alias="ADMIN_EMAIL")
    admin_password: SecretStr | None = Field(default=None, alias="ADMIN_PASSWORD")
    auth_token_ttl_hours: float = Field(default=12.0, alias="AUTH_TOKEN_TTL_HOURS", gt=0, le=24 * 30)

    # --- Rate limiting (in-memory, per process) ----------------------------
    rate_limit_enabled: bool = Field(default=True, alias="RATE_LIMIT_ENABLED")
    # Every /api request, per client IP.
    rate_limit_per_minute: int = Field(default=300, alias="RATE_LIMIT_PER_MINUTE", ge=1)
    # Uploads, criteria extraction and evaluation runs, per user.
    rate_limit_expensive_per_minute: int = Field(default=30, alias="RATE_LIMIT_EXPENSIVE_PER_MINUTE", ge=1)
    # Login attempts per client IP, and failed logins per account, in a 15-minute window.
    login_attempts_per_ip: int = Field(default=20, alias="LOGIN_ATTEMPTS_PER_IP", ge=1)
    login_failures_per_account: int = Field(default=5, alias="LOGIN_FAILURES_PER_ACCOUNT", ge=1)
    # Number of reverse proxies in front of the API that append to X-Forwarded-For (Render: 1).
    # 0 ignores the header, which clients can forge, and uses the socket address.
    trusted_proxy_hops: int = Field(default=0, alias="TRUSTED_PROXY_HOPS", ge=0, le=5)

    # --- AI provider -------------------------------------------------------
    ai_provider: Literal["demo", "anthropic"] = Field(default="demo", alias="AI_PROVIDER")
    anthropic_api_key: SecretStr | None = Field(default=None, alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field(default="claude-opus-5-5", alias="ANTHROPIC_MODEL")
    anthropic_effort: Literal["low", "medium", "high", "xhigh", "max"] = Field(
        default="medium", alias="ANTHROPIC_EFFORT"
    )
    anthropic_timeout_seconds: float = Field(default=90.0, alias="ANTHROPIC_TIMEOUT_SECONDS", gt=0, le=600)
    anthropic_max_attempts: int = Field(default=3, alias="ANTHROPIC_MAX_ATTEMPTS", ge=1, le=6)
    anthropic_server_fallbacks: bool = Field(default=True, alias="ANTHROPIC_SERVER_FALLBACKS")

    # --- Storage -----------------------------------------------------------
    database_url: str = Field(default="", alias="DATABASE_URL")
    data_dir: Path = Field(default=BACKEND_DIR / "data", alias="DATA_DIR")

    # --- Upload limits -----------------------------------------------------
    max_upload_mb: float = Field(default=10.0, alias="MAX_UPLOAD_MB", gt=0, le=50)
    max_files_per_request: int = Field(default=25, alias="MAX_FILES_PER_REQUEST", ge=1, le=100)
    max_pdf_pages: int = Field(default=30, alias="MAX_PDF_PAGES", ge=1, le=200)

    # --- Duplicate detection -----------------------------------------------
    near_duplicate_threshold: float = Field(default=0.80, alias="NEAR_DUPLICATE_THRESHOLD", gt=0, le=1)

    # --- HTTP --------------------------------------------------------------
    cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000", alias="CORS_ORIGINS"
    )

    @field_validator("admin_email")
    @classmethod
    def _normalise_email(cls, value: str | None) -> str | None:
        return value.strip().lower() or None if value else None

    @model_validator(mode="after")
    def _check_production_safety(self) -> Settings:
        if self.admin_email and self.admin_password is not None:
            if len(self.admin_password.get_secret_value()) < MIN_PASSWORD_LENGTH:
                raise ValueError(f"ADMIN_PASSWORD must be at least {MIN_PASSWORD_LENGTH} characters.")
        if (self.is_production and self.admin_password is not None
                and self.admin_password.get_secret_value() == DEMO_ADMIN_PASSWORD):
            raise ValueError("ADMIN_PASSWORD is the public demo password from the README; "
                             "set a private password in production.")
        if self.is_production and "*" in self.cors_origin_list:
            raise ValueError("CORS_ORIGINS must list explicit origins in production (no '*').")
        return self

    @field_validator("data_dir")
    @classmethod
    def _resolve_data_dir(cls, value: Path) -> Path:
        return value if value.is_absolute() else (BACKEND_DIR / value).resolve()

    @property
    def resolved_database_url(self) -> str:
        url = self.database_url.strip()
        if not url:
            return f"sqlite:///{self.data_dir / 'talentlens.db'}"
        # Hosted Postgres providers (Render, Neon, Heroku...) hand out postgres:// or
        # postgresql:// URLs; point SQLAlchemy at the psycopg 3 driver explicitly.
        return re.sub(r"^postgres(ql)?://", "postgresql+psycopg://", url)

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def api_docs_enabled(self) -> bool:
        return self.enable_api_docs if self.enable_api_docs is not None else not self.is_production

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def live_ai_configured(self) -> bool:
        return self.ai_provider == "anthropic" and self.anthropic_api_key is not None


@lru_cache
def get_settings() -> Settings:
    return Settings()
