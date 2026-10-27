"""Select the active provider from configuration."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Settings
from app.services.providers.base import AIProvider
from app.services.providers.demo import DemoProvider


@dataclass(frozen=True)
class ProviderSelection:
    provider: AIProvider
    warning: str | None = None


def build_provider(settings: Settings) -> ProviderSelection:
    if settings.ai_provider == "anthropic":
        if settings.anthropic_api_key is None or not settings.anthropic_api_key.get_secret_value().strip():
            return ProviderSelection(
                DemoProvider(),
                "AI_PROVIDER is 'anthropic' but ANTHROPIC_API_KEY is not set, so the application is running "
                "in demo mode.",
            )
        from app.services.providers.anthropic_provider import AnthropicProvider

        return ProviderSelection(AnthropicProvider(settings))
    return ProviderSelection(DemoProvider())
