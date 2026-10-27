"""HTTP request/response models."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.assessment import CriterionKey
from app.schemas.requirements import ConfirmedJobRequirements, ExtractionNote, JobRequirements
from app.schemas.scoring import ScoringConfig

Decision = Literal["advance", "hold", "reject", "needs_review"]
DuplicateResolution = Literal["unreviewed", "confirmed_duplicate", "not_duplicate"]


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Any | None = None


class ProviderInfo(BaseModel):
    name: str
    mode: Literal["demo", "live"]
    model: str | None
    method_label: str
    warning: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    database: Literal["ok", "error"]
    provider: ProviderInfo
    time: datetime


class ConfigResponse(BaseModel):
    scoring: ScoringConfig
    criterion_labels: dict[str, str]
    provider: ProviderInfo
    limits: dict[str, Any]
    duplicates: dict[str, Any]
    ocr_supported: bool
    missing_evidence_policy: list[str]
    data_handling: list[str]
    limitations: list[str]


# ---------------------------------------------------------------------------- requirements
class ExtractRequest(BaseModel):
    job_title: str = Field(default="", max_length=200)
    job_description: str = Field(min_length=30, max_length=20_000)


class ExtractResponse(BaseModel):
    requirements: JobRequirements
    suggested_title: str | None
    notes: list[ExtractionNote]
    provider: str
    model: str | None
    method: str


# ---------------------------------------------------------------------------- sessions
class SessionCreate(BaseModel):
    job_title: str = Field(min_length=2, max_length=200)
    department: str | None = Field(default=None, max_length=120)
    job_description: str = Field(default="", max_length=20_000)
    requirements: ConfirmedJobRequirements
    requirements_source: Literal["manual", "extracted"] = "manual"
    extraction_meta: dict[str, Any] | None = None
    scoring_weights: dict[CriterionKey, float] | None = None

    @field_validator("job_title", "department")
    @classmethod
    def _strip(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = " ".join(value.split())
        return value or None


class RequirementsUpdate(BaseModel):
    job_title: str | None = Field(default=None, min_length=2, max_length=200)
    department: str | None = Field(default=None, max_length=120)
    job_description: str | None = Field(default=None, max_length=20_000)
    requirements: ConfirmedJobRequirements
    scoring_weights: dict[CriterionKey, float] | None = None


class SessionCounts(BaseModel):
    total: int = 0
    parsed: int = 0
    parse_failed: int = 0
    evaluated: int = 0
    evaluation_failed: int = 0
    in_progress: int = 0
    awaiting_evaluation: int = 0
    needs_review: int = 0
    duplicates: int = 0
    decided: int = 0
    ranked: int = 0


class SessionSummary(BaseModel):
    id: str
    job_title: str
    department: str | None
    created_at: datetime
    updated_at: datetime
    status: Literal["awaiting_resumes", "ready_to_evaluate", "evaluating", "evaluated", "needs_attention"]
    counts: SessionCounts
    top_score: float | None
    last_activity_at: datetime
    criteria_stale: bool
    provider_names: list[str]


class SessionDetail(SessionSummary):
    job_description: str
    requirements: JobRequirements
    requirements_source: str
    requirements_version: int
    extraction_meta: dict[str, Any] | None
    scoring_config: ScoringConfig


# ---------------------------------------------------------------------------- candidates
class DuplicateInfo(BaseModel):
    status: str
    duplicate_of_id: str | None
    duplicate_of_label: str | None
    similarity: float | None
    method: str | None
    resolution: DuplicateResolution
    excluded_from_ranking: bool


class CriterionPreview(BaseModel):
    criterion: str
    label: str
    status: str
    score: float | None
    weight: float
    contribution: float | None
    included: bool


class EvaluationSummary(BaseModel):
    id: str
    attempt: int
    status: Literal["completed", "failed"]
    overall_score: float | None
    recommendation: str | None
    evidence_completeness: float | None
    relevant_years: float | None
    required_skills_matched: int | None
    required_skills_total: int | None
    preferred_skills_matched: int | None
    preferred_skills_total: int | None
    criteria: list[CriterionPreview]
    key_skills: list[str] = Field(default_factory=list, description="Required skills shown in described work")
    missing_skills: list[str] = Field(default_factory=list, description="Required skills not established by the resume")
    provider: str
    model: str | None
    scoring_version: str
    stale: bool
    error_code: str | None
    error_message: str | None
    created_at: datetime


class DecisionOut(BaseModel):
    id: str
    decision: Decision
    is_override: bool
    reason: str | None
    notes: str | None
    ai_recommendation: str | None
    ai_score: float | None
    evaluation_id: str | None
    created_at: datetime


class ReviewFlag(BaseModel):
    code: str
    message: str


class CandidateSummary(BaseModel):
    id: str
    session_id: str
    rank: int | None
    display_name: str | None
    original_filename: str
    detected_format: str | None
    file_size: int
    page_count: int | None
    parse_status: str
    parse_error_code: str | None
    parse_error_message: str | None
    parse_warnings: list[str]
    duplicate: DuplicateInfo
    evaluation_status: str
    evaluation: EvaluationSummary | None
    review_flags: list[ReviewFlag]
    requires_review: bool
    decision: DecisionOut | None
    created_at: datetime


class CandidateDetail(CandidateSummary):
    extracted_text: str | None
    result: dict[str, Any] | None
    evaluation_history: list[EvaluationSummary]
    decision_history: list[DecisionOut]
    related_duplicates: list[dict[str, Any]]
    session_job_title: str


class UploadItemResult(BaseModel):
    filename: str
    ok: bool
    candidate: CandidateSummary | None = None
    error: ErrorBody | None = None


class UploadResponse(BaseModel):
    results: list[UploadItemResult]
    accepted: int
    failed: int


class EvaluateRequest(BaseModel):
    candidate_ids: list[str] | None = Field(default=None, max_length=500)
    scope: Literal["pending", "stale", "failed", "all"] = "pending"


class EvaluateResponse(BaseModel):
    queued: int
    candidate_ids: list[str]
    message: str


class DecisionCreate(BaseModel):
    decision: Decision
    reason: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=4000)

    @field_validator("reason", "notes")
    @classmethod
    def _blank_to_none(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class DuplicateResolutionUpdate(BaseModel):
    resolution: DuplicateResolution


class AuditEventOut(BaseModel):
    id: str
    candidate_id: str | None
    event_type: str
    message: str
    payload: dict[str, Any] | None
    created_at: datetime


# ---------------------------------------------------------------------------- dashboard
class DashboardMetrics(BaseModel):
    sessions: int
    resumes_processed: int
    unique_candidates: int
    evaluated: int
    requiring_review: int
    processing_failures: int
    decisions_recorded: int


class DashboardResponse(BaseModel):
    metrics: DashboardMetrics
    recent_sessions: list[SessionSummary]
    provider: ProviderInfo


class SessionWorkspace(BaseModel):
    session: SessionDetail
    candidates: list[CandidateSummary]
