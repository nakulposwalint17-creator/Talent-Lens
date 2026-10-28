"""Relational data model.

Evaluations and recruiter reviews are append-only: a new evaluation run or a new
recruiter decision adds a row and never mutates the original AI/demo assessment.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    """A person who can sign in. Recruiters see only their own screenings; admins see all and manage users."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    # admin | recruiter
    role: Mapped[str] = mapped_column(String(20), default="recruiter")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    tokens: Mapped[list[AuthToken]] = relationship(back_populates="user", cascade="all, delete-orphan")


class AuthToken(Base):
    """A server-side login session. Only the SHA-256 digest of the bearer token is stored."""

    __tablename__ = "auth_tokens"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="tokens")


class ScreeningSession(Base):
    __tablename__ = "screening_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    # Sessions created before authentication existed have no owner and are visible to admins only.
    owner_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    job_title: Mapped[str] = mapped_column(String(200))
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    job_description: Mapped[str] = mapped_column(Text, default="")
    requirements: Mapped[dict[str, Any]] = mapped_column(JSON)
    requirements_source: Mapped[str] = mapped_column(String(20), default="manual")
    requirements_version: Mapped[int] = mapped_column(Integer, default=1)
    extraction_meta: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    scoring_config: Mapped[dict[str, Any]] = mapped_column(JSON)
    scoring_version: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    candidates: Mapped[list[Candidate]] = relationship(
        back_populates="session", cascade="all, delete-orphan", order_by="Candidate.created_at"
    )


class Candidate(Base):
    """One uploaded resume file and everything derived from parsing it."""

    __tablename__ = "candidates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("screening_sessions.id", ondelete="CASCADE"), index=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    declared_extension: Mapped[str] = mapped_column(String(16), default="")
    detected_format: Mapped[str | None] = mapped_column(String(16), nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    file_hash: Mapped[str] = mapped_column(String(64), index=True)
    text_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_offsets: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)

    # parsed | failed | needs_ocr | empty
    parse_status: Mapped[str] = mapped_column(String(20))
    parse_error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    parse_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    parse_warnings: Mapped[list[str]] = mapped_column(JSON, default=list)

    # unique | exact_file | exact_text | near_duplicate
    duplicate_status: Mapped[str] = mapped_column(String(20), default="unique")
    duplicate_of_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    duplicate_similarity: Mapped[float | None] = mapped_column(Float, nullable=True)
    # unreviewed | confirmed_duplicate | not_duplicate
    duplicate_resolution: Mapped[str] = mapped_column(String(24), default="unreviewed")

    # not_applicable | not_started | queued | running | completed | failed | skipped_duplicate
    evaluation_status: Mapped[str] = mapped_column(String(24), default="not_started")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    session: Mapped[ScreeningSession] = relationship(back_populates="candidates")
    evaluations: Mapped[list[Evaluation]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan", order_by="Evaluation.created_at"
    )
    reviews: Mapped[list[RecruiterReview]] = relationship(
        back_populates="candidate", cascade="all, delete-orphan", order_by="RecruiterReview.created_at"
    )


class Evaluation(Base):
    """An immutable record of one evaluation attempt (successful or failed)."""

    __tablename__ = "evaluations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), index=True)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    # completed | failed
    status: Mapped[str] = mapped_column(String(20))
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    scoring_version: Mapped[str] = mapped_column(String(40))
    requirements_version: Mapped[int] = mapped_column(Integer)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    recommendation: Mapped[str | None] = mapped_column(String(32), nullable=True)
    evidence_completeness: Mapped[float | None] = mapped_column(Float, nullable=True)
    relevant_years: Mapped[float | None] = mapped_column(Float, nullable=True)
    required_skills_matched: Mapped[int | None] = mapped_column(Integer, nullable=True)
    required_skills_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    preferred_skills_matched: Mapped[int | None] = mapped_column(Integer, nullable=True)
    preferred_skills_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Full structured result (criteria, contributions, skills, evidence, concerns...)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    review_flags: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    candidate: Mapped[Candidate] = relationship(back_populates="evaluations")


class RecruiterReview(Base):
    """An immutable recruiter decision. The latest row is the current decision."""

    __tablename__ = "recruiter_reviews"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id", ondelete="CASCADE"), index=True)
    evaluation_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ai_recommendation: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ai_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    # advance | hold | reject | needs_review
    decision: Mapped[str] = mapped_column(String(20))
    is_override: Mapped[bool] = mapped_column(Boolean, default=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Email of the signed-in user who recorded the decision (a snapshot, kept if the account is removed).
    recorded_by: Mapped[str | None] = mapped_column(String(254), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    candidate: Mapped[Candidate] = relationship(back_populates="reviews")


class AuditEvent(Base):
    """Session-level activity log (uploads, evaluation runs, criteria and duplicate changes)."""

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    session_id: Mapped[str] = mapped_column(ForeignKey("screening_sessions.id", ondelete="CASCADE"), index=True)
    candidate_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    event_type: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Email of the signed-in user who caused the event; None for system events.
    actor: Mapped[str | None] = mapped_column(String(254), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
