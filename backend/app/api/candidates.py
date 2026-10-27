"""Candidate detail, retry, recruiter decisions and duplicate review."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_runner
from app.api.errors import AppError, not_found
from app.models import Candidate
from app.repositories.sessions import get_candidate, get_session
from app.schemas.api import (
    CandidateDetail,
    DecisionCreate,
    DecisionOut,
    DuplicateResolutionUpdate,
    EvaluateResponse,
)
from app.services.decisions import DecisionError, record_decision
from app.services.duplicates import is_excluded_from_ranking
from app.services.evaluation import EvaluationRunner
from app.services.ingestion import record_event
from app.services.presenters import candidate_detail, candidate_label, decision_out

router = APIRouter(prefix="/api/candidates", tags=["candidates"])


def _load(db: Session, candidate_id: str) -> Candidate:
    candidate = get_candidate(db, candidate_id)
    if candidate is None:
        raise not_found("Candidate")
    return candidate


def _detail(db: Session, candidate_id: str) -> CandidateDetail:
    candidate = _load(db, candidate_id)
    session = get_session(db, candidate.session_id)
    assert session is not None
    fresh = next(c for c in session.candidates if c.id == candidate_id)
    return candidate_detail(fresh, session)


@router.get("/{candidate_id}", response_model=CandidateDetail, summary="Full candidate assessment, evidence and audit trail")
def get_candidate_detail(candidate_id: str, db: Session = Depends(get_db)) -> CandidateDetail:
    return _detail(db, candidate_id)


@router.post("/{candidate_id}/evaluate", response_model=EvaluateResponse, status_code=status.HTTP_202_ACCEPTED,
             summary="Retry or re-run evaluation for one candidate (previous results are preserved)")
def retry_evaluation(candidate_id: str, db: Session = Depends(get_db),
                     runner: EvaluationRunner = Depends(get_runner)) -> EvaluateResponse:
    candidate = _load(db, candidate_id)
    if candidate.parse_status != "parsed":
        raise AppError(409, "not_evaluable",
                       "This file could not be read, so it cannot be evaluated. Upload a readable copy instead.")
    if candidate.evaluation_status in ("queued", "running"):
        raise AppError(409, "evaluation_in_progress", "An evaluation for this candidate is already in progress.")
    if candidate.duplicate_status in ("exact_file", "exact_text") and is_excluded_from_ranking(
        candidate.duplicate_status, candidate.duplicate_resolution
    ):
        raise AppError(409, "duplicate_excluded",
                       "This resume is an exact duplicate. Mark it as 'not a duplicate' to evaluate it separately.")
    candidate.evaluation_status = "queued"
    record_event(db, candidate.session_id, "evaluation_queued",
                 f"Re-evaluation queued for {candidate_label(candidate)}.", candidate_id=candidate.id)
    db.commit()
    runner.submit([candidate.id])
    return EvaluateResponse(queued=1, candidate_ids=[candidate.id], message="Evaluation queued.")


@router.post("/{candidate_id}/decisions", response_model=DecisionOut, status_code=status.HTTP_201_CREATED,
             summary="Record a recruiter decision (append-only; the AI assessment is never modified)")
def create_decision(candidate_id: str, payload: DecisionCreate, db: Session = Depends(get_db)) -> DecisionOut:
    candidate = _load(db, candidate_id)
    if candidate.evaluation_status in ("queued", "running"):
        raise AppError(409, "evaluation_in_progress", "Wait for the evaluation to finish before recording a decision.")
    try:
        review = record_decision(db, candidate, payload)
    except DecisionError as exc:
        raise AppError(422, exc.code, exc.message) from None
    db.commit()
    return decision_out(review)


@router.get("/{candidate_id}/decisions", response_model=list[DecisionOut], summary="Decision audit trail (newest first)")
def list_decisions(candidate_id: str, db: Session = Depends(get_db)) -> list[DecisionOut]:
    candidate = _load(db, candidate_id)
    return [decision_out(r) for r in reversed(candidate.reviews)]


@router.put("/{candidate_id}/duplicate-resolution", response_model=CandidateDetail,
            summary="Confirm or dismiss a duplicate relationship (reversible; no records are merged)")
def resolve_duplicate(candidate_id: str, payload: DuplicateResolutionUpdate,
                      db: Session = Depends(get_db)) -> CandidateDetail:
    candidate = _load(db, candidate_id)
    if candidate.duplicate_status == "unique":
        raise AppError(409, "not_a_duplicate", "This resume was not detected as a duplicate.")
    previous = candidate.duplicate_resolution
    candidate.duplicate_resolution = payload.resolution
    exact = candidate.duplicate_status in ("exact_file", "exact_text")
    if exact and candidate.parse_status == "parsed":
        if payload.resolution == "not_duplicate" and candidate.evaluation_status == "skipped_duplicate":
            candidate.evaluation_status = "not_started"
        elif payload.resolution != "not_duplicate" and candidate.evaluation_status == "not_started":
            candidate.evaluation_status = "skipped_duplicate"
    record_event(
        db, candidate.session_id, "duplicate_reviewed",
        f"Duplicate status of {candidate_label(candidate)} changed from {previous.replace('_', ' ')} to "
        f"{payload.resolution.replace('_', ' ')}.",
        candidate_id=candidate.id, payload={"from": previous, "to": payload.resolution},
    )
    db.commit()
    return _detail(db, candidate_id)
