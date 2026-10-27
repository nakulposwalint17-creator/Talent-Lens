"""CSV export of a screening session (AI assessment and recruiter decision side by side)."""

from __future__ import annotations

import csv
import io
from typing import Literal

from app.schemas.api import CandidateSummary
from app.schemas.assessment import CriterionKey

ExportFilter = Literal["all", "ranked", "advanced"]

RECOMMENDATION_LABELS = {
    "strong_match": "Strong match",
    "potential_match": "Potential match",
    "lower_match": "Lower evidence-based match",
    "insufficient_evidence": "Insufficient evidence",
}


def _safe(value: object) -> str:
    """Neutralise spreadsheet formula injection from user-controlled text."""
    text = "" if value is None else str(value)
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


def build_csv(job_title: str, candidates: list[CandidateSummary], which: ExportFilter = "all") -> str:
    if which == "ranked":
        rows = [c for c in candidates if c.rank is not None]
    elif which == "advanced":
        rows = [c for c in candidates if c.decision and c.decision.decision == "advance"]
    else:
        rows = list(candidates)
    rows.sort(key=lambda c: (c.rank is None, c.rank or 0, (c.display_name or c.original_filename).casefold()))

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    header = [
        "rank", "candidate", "file", "job", "parse_status", "evaluation_status", "ai_overall_score",
        "ai_recommendation", "evidence_completeness", "required_skills_found", "preferred_skills_found",
        "relevant_years", *[f"score_{k.value}" for k in CriterionKey], "review_flags", "duplicate_status",
        "duplicate_of", "recruiter_decision", "is_override", "decision_reason", "decision_notes",
        "decided_at", "provider", "model", "scoring_version", "evaluated_at",
    ]
    writer.writerow(header)
    for c in rows:
        ev = c.evaluation if c.evaluation and c.evaluation.status == "completed" else None
        scores = {p.criterion: p.score for p in ev.criteria} if ev else {}
        status = c.evaluation_status
        if c.evaluation and c.evaluation.status == "failed":
            status = f"failed: {c.evaluation.error_message or 'unable to evaluate'}"
        writer.writerow([_safe(v) for v in [
            c.rank or "",
            c.display_name or "",
            c.original_filename,
            job_title,
            c.parse_status if c.parse_status == "parsed" else f"{c.parse_status}: {c.parse_error_message or ''}",
            status,
            f"{ev.overall_score:.1f}" if ev and ev.overall_score is not None else "",
            RECOMMENDATION_LABELS.get(ev.recommendation or "", "") if ev else "",
            f"{ev.evidence_completeness:.0%}" if ev and ev.evidence_completeness is not None else "",
            f"{ev.required_skills_matched}/{ev.required_skills_total}" if ev else "",
            f"{ev.preferred_skills_matched}/{ev.preferred_skills_total}" if ev and ev.preferred_skills_total else "",
            f"{ev.relevant_years:g}" if ev and ev.relevant_years is not None else "",
            *[("" if scores.get(k.value) is None else f"{scores[k.value]:.1f}") for k in CriterionKey],
            "; ".join(f.message for f in c.review_flags),
            c.duplicate.status if c.duplicate.status == "unique" else f"{c.duplicate.status} ({c.duplicate.resolution})",
            c.duplicate.duplicate_of_label or "",
            c.decision.decision if c.decision else "",
            ("yes" if c.decision.is_override else "no") if c.decision else "",
            c.decision.reason if c.decision else "",
            c.decision.notes if c.decision else "",
            c.decision.created_at.isoformat() if c.decision else "",
            ev.provider if ev else "",
            ev.model or "" if ev else "",
            ev.scoring_version if ev else "",
            ev.created_at.isoformat() if ev else "",
        ]])
    return buffer.getvalue()
