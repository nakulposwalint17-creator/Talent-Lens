"""Screening sessions: create, read, update criteria, upload resumes, evaluate, export."""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_provider, get_runner, get_settings_dep
from app.api.errors import AppError, not_found
from app.core.config import Settings
from app.models import ScreeningSession
from app.repositories.sessions import get_session, list_events, list_sessions
from app.schemas.api import (
    AuditEventOut,
    ErrorBody,
    EvaluateRequest,
    EvaluateResponse,
    ExtractRequest,
    ExtractResponse,
    RequirementsUpdate,
    SessionCreate,
    SessionSummary,
    SessionWorkspace,
    UploadItemResult,
    UploadResponse,
)
from app.schemas.scoring import ScoringConfig
from app.services.duplicates import is_excluded_from_ranking
from app.services.evaluation import EvaluationRunner
from app.services.export import build_csv
from app.services.ingestion import parse_upload, record_event, session_lock, store_candidate
from app.services.presenters import current_evaluation, is_stale, session_detail, session_views
from app.services.providers.base import AIProvider, ProviderError

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["sessions"])


def _load(db: Session, session_id: str) -> ScreeningSession:
    session = get_session(db, session_id)
    if session is None:
        raise not_found("Screening session")
    return session


def _scoring_config(weights) -> ScoringConfig:
    try:
        return ScoringConfig(weights=weights) if weights else ScoringConfig()
    except ValidationError as exc:
        message = str(exc.errors()[0].get("msg", "Invalid scoring weights")).removeprefix("Value error, ")
        raise AppError(422, "invalid_weights", message) from None


def _workspace(session: ScreeningSession) -> SessionWorkspace:
    detail, candidates = session_detail(session)
    return SessionWorkspace(session=detail, candidates=candidates)


@router.post("/requirements/extract", response_model=ExtractResponse, summary="Propose structured criteria from a job description")
def extract_requirements(payload: ExtractRequest, provider: AIProvider = Depends(get_provider)) -> ExtractResponse:
    try:
        result = provider.extract_requirements(payload.job_title, payload.job_description)
    except ProviderError as exc:
        raise AppError(502 if exc.retryable else 422, f"extraction_{exc.code}",
                       f"Criteria extraction failed: {exc.message} You can enter the criteria manually.") from None
    return ExtractResponse(**result.model_dump())


@router.post("/sessions", response_model=SessionWorkspace, status_code=status.HTTP_201_CREATED,
             summary="Create a screening session with confirmed criteria")
def create_session(payload: SessionCreate, db: Session = Depends(get_db)) -> SessionWorkspace:
    config = _scoring_config(payload.scoring_weights)
    session = ScreeningSession(
        job_title=payload.job_title,
        department=payload.department,
        job_description=payload.job_description,
        requirements=payload.requirements.model_dump(),
        requirements_source=payload.requirements_source,
        extraction_meta=payload.extraction_meta,
        scoring_config=config.model_dump(mode="json"),
        scoring_version=config.version,
    )
    db.add(session)
    db.flush()
    record_event(db, session.id, "session_created", f"Screening session created for {session.job_title}.",
                 payload={"requirements_source": payload.requirements_source})
    db.commit()
    return _workspace(_load(db, session.id))


@router.get("/sessions", response_model=list[SessionSummary], summary="List screening sessions")
def get_sessions(db: Session = Depends(get_db)) -> list[SessionSummary]:
    return [session_views(s)[0] for s in list_sessions(db)]


@router.get("/sessions/{session_id}", response_model=SessionWorkspace, summary="Session details with candidates")
def get_workspace(session_id: str, db: Session = Depends(get_db)) -> SessionWorkspace:
    return _workspace(_load(db, session_id))


@router.put("/sessions/{session_id}/requirements", response_model=SessionWorkspace,
            summary="Update confirmed criteria (existing evaluations are kept and marked stale)")
def update_requirements(session_id: str, payload: RequirementsUpdate, db: Session = Depends(get_db)) -> SessionWorkspace:
    session = _load(db, session_id)
    if any(c.evaluation_status in ("queued", "running") for c in session.candidates):
        raise AppError(409, "evaluation_in_progress", "Wait for the current evaluation run to finish before editing criteria.")
    new_requirements = payload.requirements.model_dump()
    config = _scoring_config(payload.scoring_weights) if payload.scoring_weights else None
    changed = new_requirements != session.requirements or (
        config is not None and config.model_dump(mode="json") != session.scoring_config
    )
    if payload.job_title:
        session.job_title = " ".join(payload.job_title.split())
    if payload.department is not None:
        session.department = payload.department.strip() or None
    if payload.job_description is not None:
        session.job_description = payload.job_description
    if changed:
        session.requirements = new_requirements
        if config is not None:
            session.scoring_config = config.model_dump(mode="json")
        session.requirements_version += 1
        session.requirements_source = "manual"
        record_event(db, session.id, "criteria_updated",
                     f"Criteria updated to version {session.requirements_version}. Existing evaluations were kept.")
    session.updated_at = datetime.now(UTC)
    db.commit()
    return _workspace(_load(db, session_id))


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT,
               summary="Permanently delete a session and all its candidate data")
def delete_session(session_id: str, db: Session = Depends(get_db)) -> Response:
    session = _load(db, session_id)
    if any(c.evaluation_status in ("queued", "running") for c in session.candidates):
        raise AppError(409, "evaluation_in_progress", "Wait for the current evaluation run to finish before deleting.")
    db.delete(session)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sessions/{session_id}/resumes", response_model=UploadResponse, status_code=status.HTTP_201_CREATED,
             summary="Upload one or more PDF/DOCX resumes (each file is processed independently)")
def upload_resumes(
    session_id: str,
    files: list[UploadFile] = File(..., description="PDF or DOCX resumes"),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> UploadResponse:
    session = _load(db, session_id)
    if len(files) > settings.max_files_per_request:
        raise AppError(413, "too_many_files",
                       f"Upload at most {settings.max_files_per_request} files per request.")
    # (filename, candidate_id or None, error or None) per file, in upload order.
    outcomes: list[tuple[str, str | None, ErrorBody | None]] = []
    for upload in files:
        filename = upload.filename or "unnamed-file"
        try:
            data = upload.file.read(settings.max_upload_bytes + 1)
            name, parsed = parse_upload(filename, data, settings)
            with session_lock(session_id):
                # Re-read inside the lock so files committed by concurrent requests
                # take part in duplicate detection.
                db.expire_all()
                session = _load(db, session_id)
                candidate = store_candidate(db, session, name, parsed, settings)
                db.commit()
            outcomes.append((candidate.original_filename, candidate.id, None))
        except Exception:  # noqa: BLE001 - isolate failures per file
            db.rollback()
            logger.exception("Failed to store an uploaded file")
            outcomes.append((filename, None, ErrorBody(code="upload_failed",
                                                       message="The file could not be saved. Please retry.")))
        finally:
            upload.file.close()

    session = _load(db, session_id)
    session.updated_at = datetime.now(UTC)
    db.commit()
    _, summaries = session_views(session)
    by_id = {s.id: s for s in summaries}
    results = [
        UploadItemResult(filename=name, ok=cid is not None, candidate=by_id.get(cid) if cid else None, error=error)
        for name, cid, error in outcomes
    ]
    accepted = sum(1 for r in results if r.ok)
    return UploadResponse(results=results, accepted=accepted, failed=len(results) - accepted)


@router.post("/sessions/{session_id}/evaluate", response_model=EvaluateResponse, status_code=status.HTTP_202_ACCEPTED,
             summary="Queue evaluation of candidates (processed in the background)")
def evaluate_session(
    session_id: str,
    payload: EvaluateRequest | None = None,
    db: Session = Depends(get_db),
    runner: EvaluationRunner = Depends(get_runner),
) -> EvaluateResponse:
    payload = payload or EvaluateRequest()
    session = _load(db, session_id)

    def eligible(c) -> bool:
        return (
            c.parse_status == "parsed"
            and c.evaluation_status not in ("queued", "running")
            and not (c.duplicate_status in ("exact_file", "exact_text")
                     and is_excluded_from_ranking(c.duplicate_status, c.duplicate_resolution))
        )

    if payload.candidate_ids:
        wanted = set(payload.candidate_ids)
        targets = [c for c in session.candidates if c.id in wanted and eligible(c)]
    elif payload.scope == "pending":
        targets = [c for c in session.candidates if c.evaluation_status == "not_started" and eligible(c)]
    elif payload.scope == "failed":
        targets = [c for c in session.candidates if c.evaluation_status == "failed" and eligible(c)]
    elif payload.scope == "stale":
        targets = [c for c in session.candidates
                   if c.evaluation_status == "completed" and is_stale(current_evaluation(c), session) and eligible(c)]
    else:
        targets = [c for c in session.candidates if eligible(c)]

    for candidate in targets:
        candidate.evaluation_status = "queued"
    if targets:
        record_event(db, session.id, "evaluation_queued", f"Queued {len(targets)} candidate(s) for evaluation.")
    db.commit()
    ids = [c.id for c in targets]
    runner.submit(ids)
    message = f"Queued {len(ids)} candidate(s) for evaluation." if ids else "No candidates needed evaluation."
    return EvaluateResponse(queued=len(ids), candidate_ids=ids, message=message)


@router.get("/sessions/{session_id}/export.csv", summary="Export results as CSV",
            response_class=Response, responses={200: {"content": {"text/csv": {}}}})
def export_csv(
    session_id: str,
    which: Literal["all", "ranked", "advanced"] = Query("all", alias="filter"),
    db: Session = Depends(get_db),
) -> Response:
    session = _load(db, session_id)
    _, candidates = session_views(session)
    body = build_csv(session.job_title, candidates, which)  # type: ignore[arg-type]
    slug = re.sub(r"[^a-z0-9]+", "-", session.job_title.lower()).strip("-")[:40] or "screening"
    filename = f"talentlens-{slug}-{datetime.now(UTC):%Y%m%d}.csv"
    return Response(
        content="﻿" + body,  # BOM so spreadsheet apps detect UTF-8
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/sessions/{session_id}/events", response_model=list[AuditEventOut], summary="Session activity log")
def session_events(session_id: str, db: Session = Depends(get_db)) -> list[AuditEventOut]:
    _load(db, session_id)
    return [AuditEventOut.model_validate(e, from_attributes=True) for e in list_events(db, session_id)]

