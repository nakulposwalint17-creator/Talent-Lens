"""Turn an uploaded file into a persisted Candidate record (parse → hash → dedupe)."""

from __future__ import annotations

import logging
import threading
from pathlib import PurePath

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import AuditEvent, Candidate, ScreeningSession
from app.services.duplicates import ExistingResume, find_duplicate, text_hash
from app.services.resume_analysis import analyze_resume
from app.services.resume_parser import ParseResult, parse_resume, sanitize_filename

logger = logging.getLogger(__name__)


def record_event(
    db: Session,
    session_id: str,
    event_type: str,
    message: str,
    *,
    candidate_id: str | None = None,
    payload: dict | None = None,
    actor: str | None = None,
) -> None:
    db.add(AuditEvent(session_id=session_id, candidate_id=candidate_id, event_type=event_type,
                      message=message, payload=payload, actor=actor))


_locks_guard = threading.Lock()
_session_locks: dict[str, threading.Lock] = {}


def session_lock(session_id: str) -> threading.Lock:
    """Serialises duplicate detection + insert per session, so concurrent uploads
    can't both miss each other (single-process deployment, as documented)."""
    with _locks_guard:
        return _session_locks.setdefault(session_id, threading.Lock())


def parse_upload(filename: str | None, data: bytes, settings: Settings) -> tuple[str, ParseResult]:
    """CPU-bound parsing, safe to run concurrently and outside any lock."""
    name = sanitize_filename(filename)
    return name, parse_resume(name, data, max_bytes=settings.max_upload_bytes, max_pdf_pages=settings.max_pdf_pages)


def store_candidate(db: Session, session: ScreeningSession, name: str, parsed: ParseResult, settings: Settings,
                    actor: str | None = None) -> Candidate:
    """Persist a parsed upload with duplicate metadata. Call while holding ``session_lock``."""
    candidate = Candidate(
        session_id=session.id,
        original_filename=name,
        declared_extension=PurePath(name).suffix.lower()[:16],
        detected_format=parsed.detected_format,
        file_size=parsed.file_size,
        file_hash=parsed.file_hash,
        parse_status=parsed.status,
        parse_error_code=parsed.error_code,
        parse_error_message=parsed.error_message,
        parse_warnings=parsed.warnings,
        evaluation_status="not_started" if parsed.ok else "not_applicable",
    )
    if parsed.ok and parsed.text:
        candidate.extracted_text = parsed.text
        candidate.text_hash = text_hash(parsed.text)
        candidate.page_count = parsed.page_count
        candidate.page_offsets = parsed.page_offsets
        candidate.display_name = analyze_resume(parsed.text).name

    existing = [
        ExistingResume(c.id, c.file_hash, c.text_hash, c.extracted_text)
        for c in session.candidates
    ]
    match = find_duplicate(parsed.file_hash, parsed.text if parsed.ok else None, existing,
                           settings.near_duplicate_threshold)
    if match:
        candidate.duplicate_status = match.status
        candidate.duplicate_of_id = match.duplicate_of_id
        candidate.duplicate_similarity = match.similarity
        if parsed.ok and match.status in ("exact_file", "exact_text"):
            candidate.evaluation_status = "skipped_duplicate"

    session.candidates.append(candidate)
    db.flush()
    status_text = "parsed" if parsed.ok else f"{parsed.status} ({parsed.error_code})"
    record_event(
        db, session.id, "resume_uploaded", f"Uploaded {name}: {status_text}.", candidate_id=candidate.id,
        payload={"parse_status": parsed.status, "duplicate_status": candidate.duplicate_status}, actor=actor,
    )
    if not parsed.ok:
        logger.info("Upload %s could not be parsed: %s", candidate.id, parsed.error_code)
    return candidate
