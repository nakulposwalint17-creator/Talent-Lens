"""Evidence verification.

A provider's structured output can be syntactically valid and still invent
quotes. Every evidence item labelled as an exact quote is located in the
extracted resume text (case- and whitespace-insensitive, with typographic
punctuation normalised). Quotes that cannot be located are kept for audit but
marked ``unverified`` and never displayed as verified evidence. A criterion
whose positive assessment rests only on unverified evidence is downgraded to
``ambiguous`` (excluded from scoring) and flagged for human review.
"""

from __future__ import annotations

import bisect
import unicodedata
from dataclasses import dataclass
from typing import Any

from app.schemas.assessment import (
    CRITERION_LABELS,
    CandidateAssessment,
    EvidenceItem,
    EvidenceStatus,
)

_TRANSLATE = str.maketrans(
    {
        "‘": "'", "’": "'", "“": '"', "”": '"',
        "–": "-", "—": "-", "−": "-", " ": " ",
    }
)
_LEADING_JUNK = " \t\n•●▪◦·*-–—>\"'“”‘’"
MIN_QUOTE_CHARS = 3


def _norm_char(ch: str) -> str:
    ch = unicodedata.normalize("NFKC", ch).translate(_TRANSLATE)
    if len(ch) != 1:
        return ch[:1] if ch else " "
    low = ch.lower()
    return low if len(low) == 1 else ch


def _normalise_with_map(text: str) -> tuple[str, list[int]]:
    out: list[str] = []
    index_map: list[int] = []
    previous_space = True
    for i, raw in enumerate(text):
        ch = _norm_char(raw)
        if ch.isspace():
            if previous_space:
                continue
            out.append(" ")
            index_map.append(i)
            previous_space = True
        else:
            out.append(ch)
            index_map.append(i)
            previous_space = False
    return "".join(out), index_map


def _normalise(text: str) -> str:
    return _normalise_with_map(text)[0].strip()


@dataclass(frozen=True)
class QuoteMatch:
    verified: bool
    start: int | None = None
    end: int | None = None


class SourceText:
    """Pre-normalised resume text for repeated quote lookups."""

    def __init__(self, text: str | None, page_offsets: list[int] | None = None) -> None:
        self.text = text or ""
        self.page_offsets = page_offsets or None
        self._norm, self._map = _normalise_with_map(self.text)

    def locate(self, quote: str) -> QuoteMatch:
        if not self.text:
            return QuoteMatch(False)
        fragments = [f for f in quote.replace("…", "...").split("...")]
        fragments = [_normalise(f.strip(_LEADING_JUNK)) for f in fragments]
        fragments = [f for f in fragments if f]
        if not fragments or sum(len(f) for f in fragments) < MIN_QUOTE_CHARS:
            return QuoteMatch(False)
        cursor = 0
        first_start: int | None = None
        last_end: int | None = None
        for fragment in fragments:
            idx = self._norm.find(fragment, cursor)
            if idx < 0:
                return QuoteMatch(False)
            if first_start is None:
                first_start = idx
            last_end = idx + len(fragment)
            cursor = last_end
        assert first_start is not None and last_end is not None
        return QuoteMatch(True, self._map[first_start], self._map[last_end - 1] + 1)

    def page_for(self, offset: int | None) -> int | None:
        if offset is None or not self.page_offsets:
            return None
        return bisect.bisect_right(self.page_offsets, offset)


def verify_evidence(item: EvidenceItem, source: SourceText) -> dict[str, Any]:
    record: dict[str, Any] = {"quote": item.quote, "kind": item.kind, "note": item.note}
    if item.kind == "paraphrase":
        record.update(verification="paraphrase", verified=False, start=None, end=None, page=None)
        return record
    match = source.locate(item.quote)
    if match.verified:
        record.update(
            verification="verified",
            verified=True,
            start=match.start,
            end=match.end,
            page=source.page_for(match.start),
            # Display the text as it appears in the resume, not the provider's copy.
            quote=source.text[match.start : match.end],
        )
    else:
        record.update(verification="unverified", verified=False, start=None, end=None, page=None)
    return record


def _validate_items(items: list[EvidenceItem], source: SourceText) -> tuple[list[dict[str, Any]], int, int]:
    records = [verify_evidence(e, source) for e in items]
    verified = sum(1 for r in records if r["verified"])
    rejected = sum(1 for r in records if r["verification"] == "unverified")
    return records, verified, rejected


def validate_assessment(
    assessment: CandidateAssessment, text: str | None, page_offsets: list[int] | None = None
) -> tuple[CandidateAssessment, dict[str, Any], list[dict[str, str]]]:
    """Verify all evidence in ``assessment``.

    Returns (possibly downgraded assessment, evidence records keyed by location,
    review flags).
    """
    source = SourceText(text, page_offsets)
    flags: list[dict[str, str]] = []
    records: dict[str, Any] = {"criteria": {}, "skills": [], "checks": [], "concerns": []}
    rejected_total = 0
    criteria = []

    for crit in assessment.criteria:
        recs, verified, rejected = _validate_items(crit.evidence, source)
        rejected_total += rejected
        records["criteria"][crit.criterion.value] = recs
        if crit.status in (EvidenceStatus.DEMONSTRATED, EvidenceStatus.PARTIAL) and verified == 0:
            crit = crit.model_copy(
                update={
                    "status": EvidenceStatus.AMBIGUOUS,
                    "score": None,
                    "uncertainty": "The provider's positive assessment was not supported by any verifiable "
                    "quote from the resume, so it was excluded from scoring.",
                }
            )
            flags.append(
                {
                    "code": "unverified_evidence",
                    "criterion": crit.criterion.value,
                    "message": f"{CRITERION_LABELS[crit.criterion]}: cited evidence could not be verified against "
                    "the resume text; criterion excluded pending human review.",
                }
            )
        criteria.append(crit)

    skills = []
    for skill in assessment.skills:
        recs, verified, rejected = _validate_items(skill.evidence, source)
        rejected_total += rejected
        status = skill.status
        if status in (EvidenceStatus.DEMONSTRATED, EvidenceStatus.PARTIAL) and verified == 0:
            status = EvidenceStatus.AMBIGUOUS
        records["skills"].append(recs)
        skills.append(skill.model_copy(update={"status": status}))

    for check in assessment.checks:
        recs, _verified, rejected = _validate_items(check.evidence, source)
        rejected_total += rejected
        records["checks"].append(recs)
    for concern in assessment.concerns:
        recs, _verified, rejected = _validate_items(concern.evidence, source)
        rejected_total += rejected
        records["concerns"].append(recs)

    if rejected_total and not any(f["code"] == "unverified_evidence" for f in flags):
        flags.append(
            {
                "code": "unverified_evidence",
                "message": f"{rejected_total} cited quote(s) could not be found in the resume text and were "
                "rejected as evidence.",
            }
        )

    validated = assessment.model_copy(update={"criteria": criteria, "skills": skills})
    return validated, records, flags
