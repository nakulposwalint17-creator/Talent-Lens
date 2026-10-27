"""Runtime configuration loaded from environment variables (and an optional .env file)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]

APP_VERSION = "1.0.0"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", BACKEND_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

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

    @field_validator("data_dir")
    @classmethod
    def _resolve_data_dir(cls, value: Path) -> Path:
        return value if value.is_absolute() else (BACKEND_DIR / value).resolve()

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{self.data_dir / 'talentlens.db'}"

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
