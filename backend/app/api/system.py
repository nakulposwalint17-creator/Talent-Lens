"""Health, configuration/methodology and dashboard endpoints."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_provider_info, get_settings_dep
from app.core.config import APP_VERSION, Settings
from app.repositories.sessions import list_sessions
from app.schemas.api import ConfigResponse, DashboardMetrics, DashboardResponse, HealthResponse, ProviderInfo
from app.schemas.assessment import CRITERION_LABELS
from app.schemas.scoring import ScoringConfig
from app.services.duplicates import is_excluded_from_ranking
from app.services.presenters import session_views
from app.services.resume_parser import ALLOWED_EXTENSIONS

router = APIRouter(prefix="/api", tags=["system"])

MISSING_EVIDENCE_POLICY = [
    "Each criterion is classed as demonstrated, partially demonstrated, not found in the resume, ambiguous, or "
    "not assessable.",
    "“Not found in the resume” means the resume does not establish the item. It is scored from the available "
    "evidence but is never described as the candidate lacking the qualification.",
    "Ambiguous or not-assessable criteria are excluded from the score and the remaining weights are renormalised. "
    "Evidence completeness shows how much of the criteria weight could actually be assessed.",
    "If evidence completeness falls below the configured minimum, the recommendation becomes "
    "“Insufficient evidence” and the candidate is shown for human review instead of being ranked.",
    "Criteria the job does not use (for example, no preferred skills) are not applicable and do not reduce evidence "
    "completeness.",
    "Failed evaluations and unreadable files are shown as “Unable to evaluate”; they never receive a score.",
]

DATA_HANDLING = [
    "All data is stored locally in a SQLite database under backend/data/ (configurable with DATA_DIR / "
    "DATABASE_URL). Nothing is sent to an external service in demo mode.",
    "Uploaded files are parsed in memory. The original file bytes are not retained; the extracted text, file hash "
    "and parsing metadata are stored so results can be reopened and evidence verified.",
    "Uploads are never served back by the web server and are never executed.",
    "In live AI mode, the extracted resume text and the confirmed job criteria are sent to the Anthropic API for "
    "evaluation. API keys are read from environment variables and are never logged or returned by the API.",
    "Deleting a screening session permanently removes its candidates, evaluations, decisions and audit events.",
    "There is no authentication or encryption at rest; run the application locally or behind your own access controls.",
]

LIMITATIONS = [
    "OCR is not supported: scanned or image-only PDFs are flagged for manual review.",
    "The demo provider uses keyword, section and date heuristics. It can miss skills described with different "
    "wording and cannot judge quality or transferable experience the way a person can.",
    "Experience duration is computed only from parseable date ranges in the experience section; year-only dates are "
    "counted conservatively and overlapping roles are counted once.",
    "Scoring weights and recommendation thresholds are configurable product defaults, not validated hiring standards.",
    "Names are extracted heuristically from the top of the resume and may be missing.",
    "Legacy .doc files, images and other formats are not supported.",
    "This is a decision-support tool. It does not make hiring decisions and has not been audited for bias or legal "
    "compliance.",
]


@router.get("/health", response_model=HealthResponse, summary="Service and database health")
def health(request: Request, db: Session = Depends(get_db),
           provider: ProviderInfo = Depends(get_provider_info)) -> HealthResponse:
    try:
        db.execute(text("SELECT 1"))
        database = "ok"
    except Exception:  # noqa: BLE001
        database = "error"
    return HealthResponse(
        status="ok" if database == "ok" else "degraded",
        version=APP_VERSION, database=database, provider=provider, time=datetime.now(UTC),
    )


@router.get("/config", response_model=ConfigResponse, summary="Scoring methodology, limits and provider")
def config(settings: Settings = Depends(get_settings_dep),
           provider: ProviderInfo = Depends(get_provider_info)) -> ConfigResponse:
    return ConfigResponse(
        scoring=ScoringConfig(),
        criterion_labels={k.value: v for k, v in CRITERION_LABELS.items()},
        provider=provider,
        limits={
            "max_upload_mb": settings.max_upload_mb,
            "max_files_per_request": settings.max_files_per_request,
            "max_pdf_pages": settings.max_pdf_pages,
            "allowed_extensions": sorted(ALLOWED_EXTENSIONS),
        },
        duplicates={
            "near_duplicate_threshold": settings.near_duplicate_threshold,
            "methods": [
                "Exact file: identical SHA-256 hash of the uploaded bytes.",
                "Exact text: identical SHA-256 hash of the extracted text after normalising case, punctuation and "
                "whitespace (catches the same resume in PDF and DOCX).",
                "Near duplicate: Jaccard similarity of word 3-shingles at or above the threshold. The threshold is an "
                "initial hypothesis, not a validated value.",
            ],
        },
        ocr_supported=False,
        missing_evidence_policy=MISSING_EVIDENCE_POLICY,
        data_handling=DATA_HANDLING,
        limitations=LIMITATIONS,
    )


@router.get("/dashboard", response_model=DashboardResponse, summary="Overview metrics from persisted data")
def dashboard(db: Session = Depends(get_db), provider: ProviderInfo = Depends(get_provider_info)) -> DashboardResponse:
    sessions = list_sessions(db)
    metrics = DashboardMetrics(sessions=len(sessions), resumes_processed=0, unique_candidates=0, evaluated=0,
                               requiring_review=0, processing_failures=0, decisions_recorded=0)
    summaries = []
    for session in sessions:
        summary, candidates = session_views(session)
        summaries.append(summary)
        metrics.resumes_processed += summary.counts.total
        metrics.evaluated += summary.counts.evaluated
        metrics.requiring_review += summary.counts.needs_review
        metrics.processing_failures += summary.counts.parse_failed + summary.counts.evaluation_failed
        metrics.decisions_recorded += summary.counts.decided
        metrics.unique_candidates += sum(
            1 for c in candidates
            if c.parse_status == "parsed" and not is_excluded_from_ranking(c.duplicate.status, c.duplicate.resolution)
        )
    return DashboardResponse(metrics=metrics, recent_sessions=summaries[:6], provider=provider)
