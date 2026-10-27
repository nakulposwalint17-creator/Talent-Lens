"""The structured assessment contract every provider (demo or live) must return.

Provider output is *untrusted*: it is validated with these models, then evidence
quotes are verified against the extracted resume text before scoring.
"""

from __future__ import annotations

import math
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class CriterionKey(StrEnum):
    REQUIRED_SKILLS = "required_skills"
    RELEVANT_EXPERIENCE = "relevant_experience"
    PROJECTS = "projects"
    PREFERRED_QUALIFICATIONS = "preferred_qualifications"


CRITERION_LABELS: dict[CriterionKey, str] = {
    CriterionKey.REQUIRED_SKILLS: "Required skills",
    CriterionKey.RELEVANT_EXPERIENCE: "Relevant experience",
    CriterionKey.PROJECTS: "Relevant projects & demonstrated work",
    CriterionKey.PREFERRED_QUALIFICATIONS: "Preferred qualifications",
}


class EvidenceStatus(StrEnum):
    DEMONSTRATED = "demonstrated"
    PARTIAL = "partial"
    NOT_FOUND = "not_found"
    AMBIGUOUS = "ambiguous"
    NOT_ASSESSABLE = "not_assessable"


SCORED_STATUSES = {EvidenceStatus.DEMONSTRATED, EvidenceStatus.PARTIAL, EvidenceStatus.NOT_FOUND}


class EvidenceItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    quote: str = Field(min_length=1, max_length=800)
    kind: Literal["exact_quote", "paraphrase"] = "exact_quote"
    note: str | None = Field(default=None, max_length=400)


class CriterionAssessment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    criterion: CriterionKey
    status: EvidenceStatus
    score: float | None = None
    explanation: str = Field(min_length=1, max_length=1500)
    evidence: list[EvidenceItem] = Field(default_factory=list, max_length=12)
    uncertainty: str | None = Field(default=None, max_length=600)

    @field_validator("score")
    @classmethod
    def _valid_score(cls, value: float | None) -> float | None:
        if value is None:
            return None
        if isinstance(value, bool) or not math.isfinite(float(value)):
            raise ValueError("score must be a finite number")
        if not 0 <= value <= 100:
            raise ValueError("score must be between 0 and 100")
        return float(value)

    @model_validator(mode="after")
    def _score_matches_status(self) -> CriterionAssessment:
        if self.status in SCORED_STATUSES and self.score is None:
            raise ValueError(f"criterion '{self.criterion}' with status '{self.status}' requires a score")
        if self.status not in SCORED_STATUSES:
            # Ambiguous / not assessable criteria never carry a score.
            self.score = None
        if self.status == EvidenceStatus.NOT_FOUND and self.score and self.score > 0:
            raise ValueError("a 'not_found' criterion cannot have a positive score")
        return self


class SkillAssessment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    skill: str = Field(min_length=1, max_length=120)
    kind: Literal["required", "preferred"]
    status: EvidenceStatus
    evidence: list[EvidenceItem] = Field(default_factory=list, max_length=6)
    note: str | None = Field(default=None, max_length=400)


class RoleEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(max_length=300)
    start: str | None = None
    end: str | None = None
    months: int | None = None
    relevant: bool = False
    quote: str | None = Field(default=None, max_length=800)


class ExperienceAssessment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    total_years: float | None = None
    relevant_years: float | None = None
    method: str = Field(default="", max_length=600)
    roles: list[RoleEntry] = Field(default_factory=list, max_length=30)
    notes: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("total_years", "relevant_years")
    @classmethod
    def _valid_years(cls, value: float | None) -> float | None:
        if value is None:
            return None
        if not math.isfinite(float(value)) or value < 0 or value > 60:
            raise ValueError("years must be a finite number between 0 and 60")
        return round(float(value), 1)


class CheckAssessment(BaseModel):
    """A required qualification or additional criterion surfaced for human verification."""

    model_config = ConfigDict(extra="ignore")

    item: str = Field(min_length=1, max_length=300)
    kind: Literal["qualification", "additional"]
    status: EvidenceStatus
    evidence: list[EvidenceItem] = Field(default_factory=list, max_length=4)
    note: str | None = Field(default=None, max_length=400)


class Concern(BaseModel):
    model_config = ConfigDict(extra="ignore")

    category: Literal["potential_inconsistency", "missing_information", "embedded_instructions", "other"]
    description: str = Field(min_length=1, max_length=600)
    evidence: list[EvidenceItem] = Field(default_factory=list, max_length=4)


class CandidateAssessment(BaseModel):
    """Provider output. Scores here are per-criterion only; the overall score is
    always computed by the deterministic scoring engine."""

    model_config = ConfigDict(extra="ignore")

    candidate_name: str | None = Field(default=None, max_length=120)
    summary: str = Field(min_length=1, max_length=2000)
    criteria: list[CriterionAssessment]
    skills: list[SkillAssessment] = Field(default_factory=list, max_length=60)
    experience: ExperienceAssessment = Field(default_factory=ExperienceAssessment)
    checks: list[CheckAssessment] = Field(default_factory=list, max_length=30)
    concerns: list[Concern] = Field(default_factory=list, max_length=15)

    @model_validator(mode="after")
    def _all_criteria_once(self) -> CandidateAssessment:
        keys = [c.criterion for c in self.criteria]
        if len(keys) != len(set(keys)):
            raise ValueError("each criterion must be assessed exactly once")
        missing = set(CriterionKey) - set(keys)
        if missing:
            raise ValueError(f"missing criteria: {', '.join(sorted(missing))}")
        return self
