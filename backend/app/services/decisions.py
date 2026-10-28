"""Recruiter decisions: append-only, with override detection against the AI recommendation."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Candidate, RecruiterReview
from app.schemas.api import DecisionCreate
from app.services.ingestion import record_event
from app.services.presenters import candidate_label, current_evaluation

# Decisions considered consistent with each AI recommendation band. Anything else
# is an explicit override and requires a reason. The AI never "rejects": a lower
# evidence-based match is consistent with either holding or rejecting.
ALIGNED_DECISIONS: dict[str, set[str]] = {
    "strong_match": {"advance"},
    "potential_match": {"advance", "hold"},
    "lower_match": {"hold", "reject"},
    "insufficient_evidence": {"needs_review"},
}


class DecisionError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def record_decision(db: Session, candidate: Candidate, payload: DecisionCreate,
                    recorded_by: str | None = None) -> RecruiterReview:
    evaluation = current_evaluation(candidate)
    completed = evaluation is not None and evaluation.status == "completed"
    ai_recommendation = evaluation.recommendation if completed and evaluation else None

    if ai_recommendation is None:
        is_override = False
        if not payload.reason and payload.decision != "needs_review":
            raise DecisionError(
                "reason_required",
                "This resume has no completed AI assessment, so a reason is required for a manual decision.",
            )
    else:
        is_override = payload.decision not in ALIGNED_DECISIONS.get(ai_recommendation, set())
        if is_override and not payload.reason:
            raise DecisionError(
                "reason_required",
                "This decision differs from the AI recommendation. Please record the reason for the override.",
            )
    if payload.decision == "reject" and not payload.reason:
        raise DecisionError("reason_required", "A reason is required when rejecting a candidate.")

    review = RecruiterReview(
        candidate_id=candidate.id,
        evaluation_id=evaluation.id if completed and evaluation else None,
        ai_recommendation=ai_recommendation,
        ai_score=evaluation.overall_score if completed and evaluation else None,
        decision=payload.decision,
        is_override=is_override,
        reason=payload.reason,
        notes=payload.notes,
        recorded_by=recorded_by,
    )
    candidate.reviews.append(review)
    db.flush()
    verb = "override" if is_override else "decision"
    record_event(
        db, candidate.session_id, "recruiter_decision",
        f"Recruiter {verb} for {candidate_label(candidate)}: {payload.decision.replace('_', ' ')}.",
        candidate_id=candidate.id, payload={"decision": payload.decision, "is_override": is_override},
        actor=recorded_by,
    )
    return review
