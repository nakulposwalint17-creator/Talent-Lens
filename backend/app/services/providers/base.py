"""Provider interface shared by the demo (rule-based) and live (Anthropic) providers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.schemas.assessment import CandidateAssessment
from app.schemas.requirements import JobRequirements, RequirementsExtraction
from app.schemas.scoring import ScoringConfig
from app.services.resume_analysis import ResumeAnalysis


class ProviderError(Exception):
    """A provider failure that must surface as 'Unable to evaluate', never as a low score."""

    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass(frozen=True)
class AssessmentContext:
    job_title: str
    requirements: JobRequirements
    resume_text: str
    analysis: ResumeAnalysis
    scoring_config: ScoringConfig


class AIProvider(Protocol):
    name: str
    model: str | None
    is_live: bool
    method_label: str

    def extract_requirements(self, job_title: str, job_description: str) -> RequirementsExtraction: ...

    def assess_candidate(self, context: AssessmentContext) -> CandidateAssessment: ...
