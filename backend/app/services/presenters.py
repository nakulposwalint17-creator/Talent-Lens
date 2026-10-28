"""Derive API views (ranking, review flags, counts, statuses) from persisted records."""

from __future__ import annotations

from datetime import UTC

from app.models import Candidate, Evaluation, RecruiterReview, ScreeningSession
from app.schemas.api import (
    CandidateDetail,
    CandidateSummary,
    CriterionPreview,
    DecisionOut,
    DuplicateInfo,
    EvaluationSummary,
    ReviewFlag,
    SessionCounts,
    SessionDetail,
    SessionSummary,
)
from app.schemas.assessment import CRITERION_LABELS, CriterionKey
from app.schemas.requirements import JobRequirements
from app.schemas.scoring import ScoringConfig
from app.services.duplicates import DUPLICATE_METHODS, is_excluded_from_ranking
from app.services.resume_parser import HIDDEN_TEXT_WARNING, TAG_CHARS_WARNING

FINAL_DECISIONS = {"advance", "hold", "reject"}


def candidate_label(candidate: Candidate) -> str:
    return candidate.display_name or candidate.original_filename


def current_evaluation(candidate: Candidate) -> Evaluation | None:
    return candidate.evaluations[-1] if candidate.evaluations else None


def current_review(candidate: Candidate) -> RecruiterReview | None:
    return candidate.reviews[-1] if candidate.reviews else None


def is_stale(evaluation: Evaluation | None, session: ScreeningSession) -> bool:
    return evaluation is not None and evaluation.requirements_version != session.requirements_version


def is_rankable(candidate: Candidate) -> bool:
    evaluation = current_evaluation(candidate)
    return (
        evaluation is not None
        and evaluation.status == "completed"
        and evaluation.overall_score is not None
        and evaluation.recommendation != "insufficient_evidence"
        and candidate.evaluation_status == "completed"
        and not is_excluded_from_ranking(candidate.duplicate_status, candidate.duplicate_resolution)
    )


def compute_ranks(session: ScreeningSession) -> dict[str, int]:
    rankable = [c for c in session.candidates if is_rankable(c)]

    def key(c: Candidate):
        ev = current_evaluation(c)
        assert ev is not None and ev.overall_score is not None
        return (-ev.overall_score, -(ev.evidence_completeness or 0), candidate_label(c).casefold(), c.id)

    return {c.id: i + 1 for i, c in enumerate(sorted(rankable, key=key))}


def review_flags(candidate: Candidate, session: ScreeningSession, labels: dict[str, str]) -> list[ReviewFlag]:
    flags: list[ReviewFlag] = []
    if candidate.parse_status == "needs_ocr":
        flags.append(ReviewFlag(code="needs_ocr", message="Scanned or image-only PDF: no text could be extracted. "
                                "OCR is not supported; review the original file manually."))
    elif candidate.parse_status in ("failed", "empty"):
        flags.append(ReviewFlag(code="processing_failed",
                                message=candidate.parse_error_message or "The file could not be processed."))
    for warning in candidate.parse_warnings or []:
        if warning.startswith((HIDDEN_TEXT_WARNING, TAG_CHARS_WARNING)):
            flags.append(ReviewFlag(code="hidden_text", message=warning))
    if candidate.duplicate_status == "near_duplicate" and candidate.duplicate_resolution == "unreviewed":
        other = labels.get(candidate.duplicate_of_id or "", "another upload")
        similarity = f" ({candidate.duplicate_similarity:.0%} similar)" if candidate.duplicate_similarity else ""
        flags.append(ReviewFlag(code="possible_duplicate",
                                message=f"Possible duplicate of {other}{similarity}. Confirm or dismiss."))
    evaluation = current_evaluation(candidate)
    if evaluation is not None and candidate.evaluation_status in ("completed", "failed"):
        flags.extend(ReviewFlag(code=f["code"], message=f["message"]) for f in (evaluation.review_flags or []))
        if evaluation.status == "completed" and is_stale(evaluation, session):
            flags.append(ReviewFlag(code="criteria_changed",
                                    message="The job criteria changed after this evaluation. Re-evaluate to update it."))
    return flags


def evaluation_summary(evaluation: Evaluation, session: ScreeningSession) -> EvaluationSummary:
    previews: list[CriterionPreview] = []
    contributions = ((evaluation.result or {}).get("scoring") or {}).get("contributions") or []
    for item in contributions:
        previews.append(CriterionPreview(
            criterion=item["criterion"],
            label=item.get("label") or CRITERION_LABELS[CriterionKey(item["criterion"])],
            status=item["status"], score=item.get("score"), weight=item["weight"],
            contribution=item.get("contribution"), included=item["included"],
        ))
    skills = (evaluation.result or {}).get("skills") or []
    required = [s for s in skills if s.get("kind") == "required"]
    return EvaluationSummary(
        key_skills=[s["skill"] for s in required if s.get("status") == "demonstrated"],
        missing_skills=[s["skill"] for s in required if s.get("status") in ("not_found", "ambiguous")],
        id=evaluation.id, attempt=evaluation.attempt, status=evaluation.status,  # type: ignore[arg-type]
        overall_score=evaluation.overall_score, recommendation=evaluation.recommendation,
        evidence_completeness=evaluation.evidence_completeness, relevant_years=evaluation.relevant_years,
        required_skills_matched=evaluation.required_skills_matched,
        required_skills_total=evaluation.required_skills_total,
        preferred_skills_matched=evaluation.preferred_skills_matched,
        preferred_skills_total=evaluation.preferred_skills_total,
        criteria=previews, provider=evaluation.provider, model=evaluation.model,
        scoring_version=evaluation.scoring_version, stale=is_stale(evaluation, session),
        error_code=evaluation.error_code, error_message=evaluation.error_message,
        created_at=evaluation.created_at,
    )


def decision_out(review: RecruiterReview) -> DecisionOut:
    return DecisionOut(
        id=review.id, decision=review.decision,  # type: ignore[arg-type]
        is_override=review.is_override, reason=review.reason, notes=review.notes,
        ai_recommendation=review.ai_recommendation, ai_score=review.ai_score,
        evaluation_id=review.evaluation_id, recorded_by=review.recorded_by, created_at=review.created_at,
    )


def candidate_summary(candidate: Candidate, session: ScreeningSession, ranks: dict[str, int],
                      labels: dict[str, str]) -> CandidateSummary:
    evaluation = current_evaluation(candidate)
    review = current_review(candidate)
    flags = review_flags(candidate, session, labels)
    decided = review is not None and review.decision in FINAL_DECISIONS
    return CandidateSummary(
        id=candidate.id, session_id=candidate.session_id, rank=ranks.get(candidate.id),
        display_name=candidate.display_name, original_filename=candidate.original_filename,
        detected_format=candidate.detected_format, file_size=candidate.file_size, page_count=candidate.page_count,
        parse_status=candidate.parse_status, parse_error_code=candidate.parse_error_code,
        parse_error_message=candidate.parse_error_message, parse_warnings=candidate.parse_warnings or [],
        duplicate=DuplicateInfo(
            status=candidate.duplicate_status, duplicate_of_id=candidate.duplicate_of_id,
            duplicate_of_label=labels.get(candidate.duplicate_of_id or ""),
            similarity=candidate.duplicate_similarity,
            method=DUPLICATE_METHODS.get(candidate.duplicate_status),
            resolution=candidate.duplicate_resolution,  # type: ignore[arg-type]
            excluded_from_ranking=is_excluded_from_ranking(candidate.duplicate_status, candidate.duplicate_resolution),
        ),
        evaluation_status=candidate.evaluation_status,
        evaluation=evaluation_summary(evaluation, session) if evaluation else None,
        review_flags=flags,
        requires_review=bool(flags) and not decided,
        decision=decision_out(review) if review else None,
        created_at=candidate.created_at,
    )


def candidate_detail(candidate: Candidate, session: ScreeningSession) -> CandidateDetail:
    labels = {c.id: candidate_label(c) for c in session.candidates}
    ranks = compute_ranks(session)
    summary = candidate_summary(candidate, session, ranks, labels)
    evaluation = current_evaluation(candidate)
    related = [
        {"id": c.id, "label": candidate_label(c), "status": c.duplicate_status,
         "similarity": c.duplicate_similarity, "resolution": c.duplicate_resolution}
        for c in session.candidates if c.duplicate_of_id == candidate.id
    ]
    return CandidateDetail(
        **summary.model_dump(),
        extracted_text=candidate.extracted_text,
        result=evaluation.result if evaluation and evaluation.status == "completed" else None,
        evaluation_history=[evaluation_summary(e, session) for e in reversed(candidate.evaluations)],
        decision_history=[decision_out(r) for r in reversed(candidate.reviews)],
        related_duplicates=related,
        session_job_title=session.job_title,
    )


def session_counts(session: ScreeningSession, summaries: list[CandidateSummary]) -> SessionCounts:
    counts = SessionCounts(total=len(summaries))
    for s in summaries:
        if s.parse_status == "parsed":
            counts.parsed += 1
        else:
            counts.parse_failed += 1
        if s.evaluation_status == "completed":
            counts.evaluated += 1
        elif s.evaluation_status == "failed":
            counts.evaluation_failed += 1
        elif s.evaluation_status in ("queued", "running"):
            counts.in_progress += 1
        elif s.evaluation_status == "not_started":
            counts.awaiting_evaluation += 1
        if s.requires_review:
            counts.needs_review += 1
        if s.duplicate.status != "unique" and s.duplicate.resolution != "not_duplicate":
            counts.duplicates += 1
        if s.decision and s.decision.decision in FINAL_DECISIONS:
            counts.decided += 1
        if s.rank is not None:
            counts.ranked += 1
    return counts


def _status(counts: SessionCounts) -> str:
    if counts.in_progress:
        return "evaluating"
    if counts.total == 0:
        return "awaiting_resumes"
    if counts.awaiting_evaluation:
        return "ready_to_evaluate"
    if counts.evaluation_failed or counts.parse_failed or counts.needs_review:
        return "needs_attention"
    return "evaluated"


def _last_activity(session: ScreeningSession):
    """Most recent change: session edits, uploads, evaluations or recruiter decisions."""
    stamps = [session.updated_at, session.created_at]
    for c in session.candidates:
        stamps.append(c.created_at)
        stamps.extend(e.created_at for e in c.evaluations)
        stamps.extend(r.created_at for r in c.reviews)
    aware = [s if s.tzinfo else s.replace(tzinfo=UTC) for s in stamps if s is not None]
    return max(aware)


def session_views(session: ScreeningSession) -> tuple[SessionSummary, list[CandidateSummary]]:
    labels = {c.id: candidate_label(c) for c in session.candidates}
    ranks = compute_ranks(session)
    summaries = [candidate_summary(c, session, ranks, labels) for c in session.candidates]
    counts = session_counts(session, summaries)
    scores = [s.evaluation.overall_score for s in summaries if s.rank is not None and s.evaluation]
    providers = sorted({s.evaluation.provider for s in summaries if s.evaluation and s.evaluation.status == "completed"})
    summary = SessionSummary(
        id=session.id, job_title=session.job_title, department=session.department,
        created_at=session.created_at, updated_at=session.updated_at,
        status=_status(counts),  # type: ignore[arg-type]
        counts=counts, top_score=max((s for s in scores if s is not None), default=None),
        last_activity_at=_last_activity(session),
        criteria_stale=any(s.evaluation and s.evaluation.stale and s.evaluation.status == "completed"
                           for s in summaries),
        provider_names=providers,
    )
    return summary, summaries


def session_detail(session: ScreeningSession) -> tuple[SessionDetail, list[CandidateSummary]]:
    summary, candidates = session_views(session)
    detail = SessionDetail(
        **summary.model_dump(),
        job_description=session.job_description,
        requirements=JobRequirements.model_validate(session.requirements),
        requirements_source=session.requirements_source,
        requirements_version=session.requirements_version,
        extraction_meta=session.extraction_meta,
        scoring_config=ScoringConfig.model_validate(session.scoring_config),
    )
    return detail, candidates
