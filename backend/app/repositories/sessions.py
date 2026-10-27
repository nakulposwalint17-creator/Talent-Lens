"""Query helpers. All database access uses SQLAlchemy's parameterised statements."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import AuditEvent, Candidate, ScreeningSession

_FULL = (
    selectinload(ScreeningSession.candidates).selectinload(Candidate.evaluations),
    selectinload(ScreeningSession.candidates).selectinload(Candidate.reviews),
)


def get_session(db: Session, session_id: str) -> ScreeningSession | None:
    return db.scalars(select(ScreeningSession).where(ScreeningSession.id == session_id).options(*_FULL)).first()


def list_sessions(db: Session, limit: int | None = None) -> list[ScreeningSession]:
    stmt = select(ScreeningSession).options(*_FULL).order_by(ScreeningSession.created_at.desc())
    if limit:
        stmt = stmt.limit(limit)
    return list(db.scalars(stmt).all())


def count_sessions(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(ScreeningSession)) or 0


def get_candidate(db: Session, candidate_id: str) -> Candidate | None:
    return db.get(Candidate, candidate_id)


def list_events(db: Session, session_id: str, limit: int = 200) -> list[AuditEvent]:
    stmt = (
        select(AuditEvent)
        .where(AuditEvent.session_id == session_id)
        .order_by(AuditEvent.created_at.desc())
        .limit(limit)
    )
    return list(db.scalars(stmt).all())
