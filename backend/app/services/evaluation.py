"""Evaluation pipeline: provider assessment → evidence verification → deterministic scoring → persistence.

Failures are persisted as ``failed`` evaluations with an explicit error and are
never given a score, so they can't be ranked against successful evaluations.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import Database
from app.models import Candidate, Evaluation, ScreeningSession
from app.schemas.assessment import CRITERION_LABELS, CandidateAssessment, CriterionKey, EvidenceStatus
from app.schemas.requirements import JobRequirements
from app.schemas.scoring import Recommendation, ScoringConfig
from app.services.evidence import SourceText, validate_assessment
from app.services.ingestion import record_event
from app.services.prompt_safety import find_output_directives
from app.services.providers.base import AIProvider, AssessmentContext, ProviderError
from app.services.providers.demo import DemoProvider
from app.services.resume_analysis import analyze_resume, merged_months
from app.services.scoring import ScoringError, compute_score

logger = logging.getLogger(__name__)

# Resumes with less extracted text than this are never ranked numerically.
MIN_RANKABLE_CHARS = 300
# A live AI score this many points above the rule-based baseline is flagged for review.
BASELINE_DIVERGENCE_POINTS = 30.0


def _flag(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def _review_flags(assessment: CandidateAssessment, scoring, evidence_flags: list[dict[str, str]]) -> list[dict[str, str]]:
    flags = list(evidence_flags)
    if scoring.recommendation == Recommendation.INSUFFICIENT_EVIDENCE:
        flags.append(_flag(
            "insufficient_evidence",
            f"Only {scoring.evidence_completeness:.0%} of the criteria weight could be assessed from the resume; "
            "a human review is needed before relying on this score.",
        ))
    already_flagged = {f.get("criterion") for f in evidence_flags}
    for crit in assessment.criteria:
        label = CRITERION_LABELS[crit.criterion]
        if crit.status == EvidenceStatus.AMBIGUOUS and crit.criterion.value not in already_flagged:
            flags.append(_flag("ambiguous_evidence", f"{label}: {crit.uncertainty or crit.explanation}"))
    for concern in assessment.concerns:
        code = {
            "embedded_instructions": "embedded_instructions",
            "potential_inconsistency": "potential_inconsistency",
            "missing_information": "missing_information",
        }.get(concern.category, "concern")
        flags.append(_flag(code, concern.description))
    for check in assessment.checks:
        if check.kind == "qualification" and check.status in (EvidenceStatus.NOT_FOUND, EvidenceStatus.AMBIGUOUS):
            flags.append(_flag(
                "qualification_not_established",
                f"Required qualification not established by the resume: “{check.item}”. Verify with the candidate.",
            ))
    # De-duplicate identical messages while keeping order.
    seen: set[tuple[str, str]] = set()
    unique = []
    for f in flags:
        key = (f["code"], f["message"])
        if key not in seen:
            seen.add(key)
            unique.append({"code": f["code"], "message": f["message"]})
    return unique


def _assessment_free_text(assessment: CandidateAssessment) -> list[str | None]:
    """Model-written prose shown to the recruiter. Concerns are excluded: they legitimately
    describe embedded instructions found in the resume."""
    texts: list[str | None] = [assessment.summary, *assessment.experience.notes]
    texts += [t for c in assessment.criteria for t in (c.explanation, c.uncertainty)]
    texts += [s.note for s in assessment.skills] + [c.note for c in assessment.checks]
    return texts


def _baseline_score(context: AssessmentContext, text: str, page_offsets, config: ScoringConfig,
                    not_applicable: set[CriterionKey]) -> float | None:
    """The deterministic rule-based score for the same resume: a reference that no resume text can talk into
    a higher number. Never allowed to fail the evaluation."""
    try:
        baseline = DemoProvider().assess_candidate(context)
        validated, _, _ = validate_assessment(baseline, text, page_offsets)
        return compute_score(validated.criteria, config, not_applicable).overall_score
    except Exception:  # noqa: BLE001
        logger.warning("Baseline scoring failed", exc_info=True)
        return None


def _output_flags(assessment: CandidateAssessment, overall: float | None, baseline: float | None) -> list[dict[str, str]]:
    flags = []
    directives = find_output_directives(_assessment_free_text(assessment))
    if directives:
        flags.append(_flag(
            "ai_output_policy",
            f"The AI's explanation contains a directive or instruction-like text (“{directives[0][:160]}”), which it "
            "is told never to write. The resume may have influenced the model; check the assessment against the "
            "verified evidence.",
        ))
    if overall is not None and baseline is not None and overall - baseline >= BASELINE_DIVERGENCE_POINTS:
        flags.append(_flag(
            "score_divergence",
            f"The AI score ({overall:.0f}) is {overall - baseline:.0f} points above the rule-based baseline "
            f"({baseline:.0f}) for the same resume. Large gaps can be legitimate (skills described in other words) "
            "but can also indicate manipulation; verify the evidence before relying on the score.",
        ))
    return flags


def evaluate_candidate(db: Session, candidate: Candidate, session: ScreeningSession, provider: AIProvider,
                       as_of: date | None = None) -> Evaluation:
    requirements = JobRequirements.model_validate(session.requirements)
    config = ScoringConfig.model_validate(session.scoring_config)
    attempt = len(candidate.evaluations) + 1
    started = time.monotonic()

    def failed(code: str, message: str) -> Evaluation:
        evaluation = Evaluation(
            candidate_id=candidate.id, attempt=attempt, status="failed", provider=provider.name,
            model=provider.model, scoring_version=config.version,
            requirements_version=session.requirements_version, error_code=code, error_message=message,
            review_flags=[_flag("evaluation_failed", f"Unable to evaluate: {message}")],
            duration_ms=int((time.monotonic() - started) * 1000),
        )
        candidate.evaluations.append(evaluation)
        candidate.evaluation_status = "failed"
        record_event(db, session.id, "evaluation_failed", f"Evaluation failed for {candidate.original_filename}: {message}",
                     candidate_id=candidate.id, payload={"error_code": code})
        return evaluation

    text = candidate.extracted_text or ""
    if candidate.parse_status != "parsed" or not text:
        return failed("not_parsed", "The resume text is not available for evaluation.")

    analysis = analyze_resume(text, as_of=as_of)
    context = AssessmentContext(
        job_title=session.job_title, requirements=requirements, resume_text=text,
        analysis=analysis, scoring_config=config,
    )
    try:
        assessment = provider.assess_candidate(context)
    except ProviderError as exc:
        return failed(exc.code, exc.message)
    except Exception:  # noqa: BLE001 - one candidate must never break the batch
        logger.exception("Unexpected provider failure for candidate %s", candidate.id)
        return failed("internal_error", "An unexpected error occurred while evaluating this resume.")

    # Durations always come from the application's own date parsing.
    if analysis.roles:
        total_months, _ = merged_months([r.span for r in analysis.roles])
        total_years = round(total_months / 12, 1)
        exp = assessment.experience
        relevant = exp.relevant_years if exp.relevant_years is None else min(exp.relevant_years, total_years)
        assessment = assessment.model_copy(update={
            "experience": exp.model_copy(update={"total_years": total_years, "relevant_years": relevant})
        })

    validated, evidence_records, evidence_flags = validate_assessment(assessment, text, candidate.page_offsets)
    not_applicable = set() if requirements.preferred_skills else {CriterionKey.PREFERRED_QUALIFICATIONS}
    try:
        scoring = compute_score(validated.criteria, config, not_applicable)
    except ScoringError as exc:
        return failed("invalid_assessment", f"The assessment could not be scored: {exc}")

    content_chars = len(" ".join(text.split()))
    if content_chars < MIN_RANKABLE_CHARS and scoring.recommendation != Recommendation.INSUFFICIENT_EVIDENCE:
        scoring = scoring.model_copy(update={
            "recommendation": Recommendation.INSUFFICIENT_EVIDENCE,
            "notes": [*scoring.notes, f"Only {content_chars} characters of text were extracted, which is too little "
                      "to rank reliably; the score is shown for reference only."],
        })

    flags = _review_flags(validated, scoring, evidence_flags)
    baseline = (_baseline_score(context, text, candidate.page_offsets, config, not_applicable)
                if provider.is_live else None)
    flags += _output_flags(validated, scoring.overall_score, baseline)
    # Raised by the application itself, so detection never depends on the model reporting it.
    if analysis.injection_lines and not any(f["code"] == "embedded_instructions" for f in flags):
        flags.append(_flag(
            "embedded_instructions",
            f"The resume contains {len(analysis.injection_lines)} line(s) that resemble instructions to an automated "
            "screening system. They were withheld from the AI and ignored; review the original file.",
        ))
    result = _result_payload(validated, evidence_records, scoring, config, provider, session)
    if baseline is not None:
        result["baseline_score"] = baseline

    found = (EvidenceStatus.DEMONSTRATED, EvidenceStatus.PARTIAL)
    required = [s for s in validated.skills if s.kind == "required"]
    preferred = [s for s in validated.skills if s.kind == "preferred"]
    evaluation = Evaluation(
        candidate_id=candidate.id, attempt=attempt, status="completed", provider=provider.name,
        model=provider.model, scoring_version=config.version,
        requirements_version=session.requirements_version,
        overall_score=scoring.overall_score,
        recommendation=scoring.recommendation.value if scoring.recommendation else None,
        evidence_completeness=scoring.evidence_completeness,
        relevant_years=validated.experience.relevant_years,
        required_skills_matched=sum(1 for s in required if s.status in found),
        required_skills_total=len(requirements.required_skills),
        preferred_skills_matched=sum(1 for s in preferred if s.status in found),
        preferred_skills_total=len(requirements.preferred_skills),
        result=result, review_flags=flags,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
    candidate.evaluations.append(evaluation)
    candidate.evaluation_status = "completed"
    if not candidate.display_name and validated.candidate_name:
        # Only accept a provider-supplied name if it literally appears in the resume.
        if SourceText(text).locate(validated.candidate_name).verified:
            candidate.display_name = validated.candidate_name[:120]
    score_text = f"{scoring.overall_score:.1f}" if scoring.overall_score is not None else "n/a"
    record_event(db, session.id, "evaluation_completed",
                 f"Evaluated {candidate.display_name or candidate.original_filename}: score {score_text}.",
                 candidate_id=candidate.id, payload={"provider": provider.name, "attempt": attempt})
    return evaluation


def _result_payload(assessment: CandidateAssessment, records: dict[str, Any], scoring, config: ScoringConfig,
                    provider: AIProvider, session: ScreeningSession) -> dict[str, Any]:
    return {
        "summary": assessment.summary,
        "candidate_name": assessment.candidate_name,
        "method": provider.method_label,
        "criteria": [
            {
                "criterion": c.criterion.value,
                "label": CRITERION_LABELS[c.criterion],
                "status": c.status.value,
                "score": c.score,
                "explanation": c.explanation,
                "uncertainty": c.uncertainty,
                "evidence": records["criteria"].get(c.criterion.value, []),
            }
            for c in assessment.criteria
        ],
        "scoring": scoring.model_dump(mode="json"),
        "skills": [
            {"skill": s.skill, "kind": s.kind, "status": s.status.value, "note": s.note, "evidence": recs}
            for s, recs in zip(assessment.skills, records["skills"], strict=True)
        ],
        "experience": assessment.experience.model_dump(mode="json"),
        "checks": [
            {"item": c.item, "kind": c.kind, "status": c.status.value, "note": c.note, "evidence": recs}
            for c, recs in zip(assessment.checks, records["checks"], strict=True)
        ],
        "concerns": [
            {"category": c.category, "description": c.description, "evidence": recs}
            for c, recs in zip(assessment.concerns, records["concerns"], strict=True)
        ],
        "scoring_config": config.model_dump(mode="json"),
        "requirements_version": session.requirements_version,
    }


class EvaluationRunner:
    """Processes queued candidates sequentially on a single background worker.

    One worker keeps SQLite writes simple and bounds load on a live provider.
    Progress is visible through persisted statuses (queued → running → completed/failed).
    """

    def __init__(self, database: Database, provider_getter: Callable[[], AIProvider], *, inline: bool = False) -> None:
        self._database = database
        self._provider_getter = provider_getter
        self._inline = inline
        self._executor = None if inline else ThreadPoolExecutor(max_workers=1, thread_name_prefix="evaluator")

    def submit(self, candidate_ids: Iterable[str]) -> None:
        ids = list(candidate_ids)
        if not ids:
            return
        if self._executor is None:
            self._run(ids)
        else:
            self._executor.submit(self._run, ids)

    def shutdown(self) -> None:
        if self._executor is not None:
            self._executor.shutdown(wait=False, cancel_futures=True)

    def _run(self, candidate_ids: list[str]) -> None:
        provider = self._provider_getter()
        for candidate_id in candidate_ids:
            db = self._database.session()
            try:
                candidate = db.get(Candidate, candidate_id)
                if candidate is None or candidate.evaluation_status != "queued":
                    continue
                candidate.evaluation_status = "running"
                db.commit()
                evaluate_candidate(db, candidate, candidate.session, provider)
                db.commit()
            except Exception:  # noqa: BLE001
                db.rollback()
                logger.exception("Evaluation worker error for candidate %s", candidate_id)
                _mark_failed(db, candidate_id, "internal_error", "An unexpected error occurred while saving the evaluation.")
            finally:
                db.close()


def _mark_failed(db: Session, candidate_id: str, code: str, message: str) -> None:
    try:
        candidate = db.get(Candidate, candidate_id)
        if candidate is not None:
            candidate.evaluation_status = "failed"
            db.add(Evaluation(
                candidate_id=candidate.id, attempt=len(candidate.evaluations) + 1, status="failed",
                provider="system", model=None, scoring_version="n/a",
                requirements_version=candidate.session.requirements_version,
                error_code=code, error_message=message,
                review_flags=[_flag("evaluation_failed", f"Unable to evaluate: {message}")],
            ))
            db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Could not record evaluation failure for %s", candidate_id)


def recover_interrupted(db: Session) -> int:
    """Mark evaluations left queued/running by a previous process as failed (retryable)."""
    stuck = db.scalars(select(Candidate).where(Candidate.evaluation_status.in_(["queued", "running"]))).all()
    for candidate in stuck:
        candidate.evaluation_status = "failed"
        candidate.evaluations.append(Evaluation(
            candidate_id=candidate.id, attempt=len(candidate.evaluations) + 1, status="failed",
            provider="system", model=None, scoring_version="n/a",
            requirements_version=candidate.session.requirements_version,
            error_code="interrupted",
            error_message="Evaluation was interrupted by a server restart. Retry to evaluate.",
            review_flags=[_flag("evaluation_failed", "Unable to evaluate: interrupted by a server restart.")],
        ))
    db.commit()
    return len(stuck)
