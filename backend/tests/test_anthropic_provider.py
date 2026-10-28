"""Live-provider behaviour with a mocked Anthropic client (no network, no API key)."""

from __future__ import annotations

import json
import re
from datetime import date
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from app.core.config import Settings
from app.schemas.assessment import CriterionKey
from app.schemas.requirements import JobRequirements
from app.schemas.scoring import ScoringConfig
from app.services.providers.anthropic_provider import AnthropicProvider, strict_json_schema
from app.services.providers.base import AssessmentContext, ProviderError
from app.services.providers.factory import build_provider
from app.services.resume_analysis import analyze_resume
from tests.conftest import REQUIREMENTS, RESUME_LINES

TEXT = "\n".join(RESUME_LINES)


def valid_payload(quote: str = "Built FastAPI services on PostgreSQL serving 5k requests per second.") -> dict:
    return {
        "candidate_name": "Jordan Example",
        "summary": "Strong backend evidence.",
        "criteria": [
            {"criterion": "required_skills", "status": "demonstrated", "score": 85, "explanation": "Most skills shown.",
             "evidence": [{"quote": quote, "kind": "exact_quote", "note": None}], "uncertainty": None},
            {"criterion": "relevant_experience", "status": "demonstrated", "score": 100, "explanation": "7 years.",
             "evidence": [], "uncertainty": None},
            {"criterion": "projects", "status": "partial", "score": 60, "explanation": "Some projects.",
             "evidence": [], "uncertainty": None},
            {"criterion": "preferred_qualifications", "status": "not_found", "score": 0,
             "explanation": "Not established.", "evidence": [], "uncertainty": None},
        ],
        "skills": [], "experience": {"total_years": 7, "relevant_years": 7, "method": "", "roles": [], "notes": []},
        "checks": [], "concerns": [],
    }


def response(text: str | None, stop_reason: str = "end_turn"):
    content = [] if text is None else [SimpleNamespace(type="text", text=text)]
    return SimpleNamespace(content=content, stop_reason=stop_reason)


class FakeMessages:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeClient:
    def __init__(self, outcomes):
        self.messages = FakeMessages(outcomes)
        self.beta = SimpleNamespace(messages=self.messages)


_REQUEST = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def status_error(cls, status: int, headers: dict | None = None):
    return cls("error", response=httpx2.Response(status, request=_REQUEST, headers=headers or {}), body=None)


def make_provider(outcomes, **overrides) -> tuple[AnthropicProvider, FakeClient, list[float]]:
    settings = Settings(AI_PROVIDER="anthropic", ANTHROPIC_API_KEY="test-key", _env_file=None, **overrides)
    client = FakeClient(outcomes)
    sleeps: list[float] = []
    return AnthropicProvider(settings, client=client, sleep=sleeps.append), client, sleeps


def context() -> AssessmentContext:
    return AssessmentContext("Backend", JobRequirements(**REQUIREMENTS), TEXT,
                             analyze_resume(TEXT, as_of=date(2026, 1, 1)), ScoringConfig())


def test_successful_structured_response():
    provider, client, sleeps = make_provider([response(json.dumps(valid_payload()))])
    result = provider.assess_candidate(context())
    assert result.criteria[0].criterion == CriterionKey.REQUIRED_SKILLS
    call = client.messages.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["output_config"]["format"]["type"] == "json_schema"
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert re.search(r"<resume_[0-9a-f]{16}>\n", call["messages"][0]["content"])
    assert sleeps == []


def test_invalid_json_is_retried_then_succeeds():
    provider, client, sleeps = make_provider([response("{not json"), response(json.dumps(valid_payload()))])
    provider.assess_candidate(context())
    assert len(client.messages.calls) == 2 and len(sleeps) == 1


def test_missing_fields_and_invalid_enum_values_exhaust_retries():
    missing = valid_payload()
    del missing["criteria"]
    bad_enum = valid_payload()
    bad_enum["criteria"][0]["status"] = "superb"
    provider, client, _ = make_provider([response(json.dumps(missing)), response(json.dumps(bad_enum)),
                                         response(json.dumps(missing))])
    with pytest.raises(ProviderError) as err:
        provider.assess_candidate(context())
    assert err.value.code == "invalid_response"
    assert "3 attempt" in err.value.message
    assert len(client.messages.calls) == 3


def test_out_of_range_score_is_invalid():
    payload = valid_payload()
    payload["criteria"][1]["score"] = 140
    provider, _, _ = make_provider([response(json.dumps(payload))], ANTHROPIC_MAX_ATTEMPTS=1)
    with pytest.raises(ProviderError) as err:
        provider.assess_candidate(context())
    assert err.value.code == "invalid_response"


def test_timeout_is_retried_with_bounded_backoff():
    timeout = anthropic.APITimeoutError(request=_REQUEST)
    provider, client, sleeps = make_provider([timeout, timeout, timeout])
    with pytest.raises(ProviderError) as err:
        provider.assess_candidate(context())
    assert err.value.code == "timeout" and err.value.retryable
    assert len(client.messages.calls) == 3
    assert len(sleeps) == 2 and sleeps[1] > sleeps[0]


def test_rate_limit_honours_retry_after():
    limited = status_error(anthropic.RateLimitError, 429, {"retry-after": "7"})
    provider, _, sleeps = make_provider([limited, response(json.dumps(valid_payload()))])
    provider.assess_candidate(context())
    assert 7 <= sleeps[0] <= 8


def test_retry_exhaustion_on_rate_limit():
    limited = status_error(anthropic.RateLimitError, 429)
    provider, client, _ = make_provider([limited, limited], ANTHROPIC_MAX_ATTEMPTS=2)
    with pytest.raises(ProviderError) as err:
        provider.assess_candidate(context())
    assert err.value.code == "rate_limited" and len(client.messages.calls) == 2


def test_provider_unavailable_and_server_errors():
    provider, _, _ = make_provider([anthropic.APIConnectionError(request=_REQUEST)] * 3)
    with pytest.raises(ProviderError) as err:
        provider.assess_candidate(context())
    assert err.value.code == "unavailable"
    provider, client, _ = make_provider([status_error(anthropic.InternalServerError, 500),
                                         response(json.dumps(valid_payload()))])
    provider.assess_candidate(context())
    assert len(client.messages.calls) == 2


def test_auth_errors_are_not_retried():
    provider, client, _ = make_provider([status_error(anthropic.AuthenticationError, 401)])
    with pytest.raises(ProviderError) as err:
        provider.assess_candidate(context())
    assert err.value.code == "auth_failed" and not err.value.retryable
    assert len(client.messages.calls) == 1
    assert "test-key" not in err.value.message


def test_refusal_and_truncation():
    provider, _, _ = make_provider([response(None, stop_reason="refusal")])
    with pytest.raises(ProviderError) as err:
        provider.assess_candidate(context())
    assert err.value.code == "refused"
    provider, client, _ = make_provider([response('{"partial":', stop_reason="max_tokens"),
                                         response(json.dumps(valid_payload()))])
    provider.assess_candidate(context())
    assert len(client.messages.calls) == 2


def test_fallbacks_can_be_disabled():
    provider, client, _ = make_provider([response(json.dumps(valid_payload()))], ANTHROPIC_SERVER_FALLBACKS=False)
    provider.assess_candidate(context())
    assert "fallbacks" not in client.messages.calls[0]


def test_strict_schema_is_closed_and_fully_required():
    schema = strict_json_schema(__import__("app.schemas.assessment", fromlist=["CandidateAssessment"]).CandidateAssessment)
    criterion = schema["$defs"]["CriterionAssessment"]
    assert criterion["additionalProperties"] is False
    assert set(criterion["required"]) == set(criterion["properties"])
    assert "maxLength" not in json.dumps(schema)


def test_factory_falls_back_to_demo_without_key():
    selection = build_provider(Settings(AI_PROVIDER="anthropic", _env_file=None))
    assert selection.provider.name == "demo" and selection.warning
    assert build_provider(Settings(_env_file=None)).provider.name == "demo"
