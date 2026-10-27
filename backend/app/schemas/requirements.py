"""Structured job requirements confirmed by the recruiter."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _clean_list(values: list[str], *, max_len: int) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw in values:
        item = " ".join(str(raw).split()).strip(" ,;•-")
        if not item:
            continue
        if len(item) > max_len:
            raise ValueError(f"'{item[:30]}…' is longer than {max_len} characters")
        key = item.casefold()
        if key not in seen:
            seen.add(key)
            cleaned.append(item)
    return cleaned


class JobRequirements(BaseModel):
    model_config = ConfigDict(extra="forbid")

    required_skills: list[str] = Field(default_factory=list, max_length=30)
    preferred_skills: list[str] = Field(default_factory=list, max_length=30)
    min_years_experience: float | None = Field(default=None, ge=0, le=50)
    experience_focus: list[str] = Field(
        default_factory=list,
        max_length=15,
        description="Role/domain terms that make prior experience relevant (e.g. 'backend', 'API').",
    )
    qualifications: list[str] = Field(default_factory=list, max_length=15)
    additional_criteria: list[str] = Field(default_factory=list, max_length=15)

    @field_validator("required_skills", "preferred_skills", "experience_focus")
    @classmethod
    def _clean_terms(cls, value: list[str]) -> list[str]:
        return _clean_list(value, max_len=80)

    @field_validator("qualifications", "additional_criteria")
    @classmethod
    def _clean_sentences(cls, value: list[str]) -> list[str]:
        return _clean_list(value, max_len=300)

    @field_validator("min_years_experience")
    @classmethod
    def _finite_years(cls, value: float | None) -> float | None:
        if value is None:
            return None
        if value != value or value in (float("inf"), float("-inf")):  # NaN / inf
            raise ValueError("must be a finite number")
        return round(float(value), 1)


class ConfirmedJobRequirements(JobRequirements):
    """Requirements used for evaluation must include at least one required skill."""

    @field_validator("required_skills")
    @classmethod
    def _at_least_one(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("at least one required skill is needed to evaluate candidates")
        return value


class ExtractionNote(BaseModel):
    field: str
    note: str


class RequirementsExtraction(BaseModel):
    """Draft requirements proposed by a provider. Never authoritative until confirmed."""

    requirements: JobRequirements
    suggested_title: str | None = None
    notes: list[ExtractionNote] = Field(default_factory=list)
    provider: str
    model: str | None = None
    method: str
