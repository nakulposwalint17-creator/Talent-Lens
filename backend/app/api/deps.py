"""FastAPI dependencies resolved from application state (overridable in tests)."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.schemas.api import ProviderInfo
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
