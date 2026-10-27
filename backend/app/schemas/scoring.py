"""Scoring configuration and the deterministic scoring result."""

from __future__ import annotations

import math
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.assessment import CriterionKey, EvidenceStatus

SCORING_VERSION = "tl-score-2026.10-v1"

DEFAULT_WEIGHTS: dict[CriterionKey, float] = {
    CriterionKey.REQUIRED_SKILLS: 40.0,
    CriterionKey.RELEVANT_EXPERIENCE: 25.0,
    CriterionKey.PROJECTS: 20.0,
    CriterionKey.PREFERRED_QUALIFICATIONS: 15.0,
}


class Recommendation(StrEnum):
    STRONG_MATCH = "strong_match"
    POTENTIAL_MATCH = "potential_match"
    LOWER_MATCH = "lower_match"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


class ScoringConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str = SCORING_VERSION
    weights: dict[CriterionKey, float] = Field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    strong_threshold: float = Field(default=80.0, ge=0, le=100)
    potential_threshold: float = Field(default=65.0, ge=0, le=100)
    min_evidence_completeness: float = Field(default=0.6, ge=0, le=1)
    experience_reference_years: float = Field(
        default=3.0, gt=0, le=30, description="Used only when the job sets no minimum years."
    )

    @field_validator("weights")
    @classmethod
    def _valid_weights(cls, weights: dict[CriterionKey, float]) -> dict[CriterionKey, float]:
        missing = set(CriterionKey) - set(weights)
        if missing:
            raise ValueError(f"weights missing for: {', '.join(sorted(missing))}")
        for key, value in weights.items():
            if isinstance(value, bool) or not math.isfinite(float(value)):
                raise ValueError(f"weight for {key} must be a finite number")
            if value < 0 or value > 100:
                raise ValueError(f"weight for {key} must be between 0 and 100")
        total = sum(weights.values())
        if not math.isclose(total, 100.0, abs_tol=1e-6):
            raise ValueError(f"weights must sum to 100 (got {total:g})")
        return {k: float(v) for k, v in weights.items()}

    @model_validator(mode="after")
    def _ordered_thresholds(self) -> ScoringConfig:
        if self.potential_threshold > self.strong_threshold:
            raise ValueError("potential threshold must not exceed strong threshold")
        return self


class CriterionContribution(BaseModel):
    criterion: CriterionKey
    label: str
    weight: float
    effective_weight: float
    status: EvidenceStatus
    score: float | None
    contribution: float | None
    included: bool
    explanation: str


class ScoringResult(BaseModel):
    overall_score: float | None
    recommendation: Recommendation | None
    evidence_completeness: float
    assessed_weight: float
    contributions: list[CriterionContribution]
    notes: list[str]
