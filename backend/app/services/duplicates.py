"""Three-level duplicate detection.

1. Exact file duplicate      – identical SHA-256 of the uploaded bytes.
2. Exact text duplicate      – identical SHA-256 of normalised extracted text
                               (catches the same resume saved as PDF and DOCX).
3. Near duplicate            – Jaccard similarity of word 3-shingles ≥ threshold.

Detection never merges or deletes records; it only annotates the later upload
with a pointer to the earlier one so a recruiter can review the relationship.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass

SHINGLE_SIZE = 3
_NON_WORD = re.compile(r"[^\w\s]+", re.UNICODE)
_WS = re.compile(r"\s+")


def normalize_text(text: str | None) -> str:
    """Case-fold, strip punctuation/bullets and collapse whitespace."""
    if not text:
        return ""
    value = unicodedata.normalize("NFKC", text).casefold()
    value = value.replace("_", " ")
    value = _NON_WORD.sub(" ", value)
    return _WS.sub(" ", value).strip()


def text_hash(text: str | None) -> str | None:
    normalized = normalize_text(text)
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def shingles(text: str | None, size: int = SHINGLE_SIZE) -> frozenset[str]:
    tokens = normalize_text(text).split()
    if not tokens:
        return frozenset()
    if len(tokens) < size:
        return frozenset({" ".join(tokens)})
    return frozenset(" ".join(tokens[i : i + size]) for i in range(len(tokens) - size + 1))


def jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


@dataclass(frozen=True)
class ExistingResume:
    id: str
    file_hash: str
    text_hash: str | None
    text: str | None


@dataclass(frozen=True)
class DuplicateMatch:
    status: str  # exact_file | exact_text | near_duplicate
    duplicate_of_id: str
    similarity: float
    method: str


def find_duplicate(
    file_hash: str,
    text: str | None,
    existing: Iterable[ExistingResume],
    threshold: float,
) -> DuplicateMatch | None:
    if not 0 < threshold <= 1:
        raise ValueError("threshold must be in (0, 1]")
    candidates = list(existing)

    for other in candidates:
        if other.file_hash == file_hash:
            return DuplicateMatch("exact_file", other.id, 1.0, "Identical file (SHA-256 of file bytes)")

    own_hash = text_hash(text)
    if own_hash is None:
        return None
    for other in candidates:
        if other.text_hash and other.text_hash == own_hash:
            return DuplicateMatch(
                "exact_text", other.id, 1.0, "Identical text after normalising case, punctuation and whitespace"
            )

    own_shingles = shingles(text)
    best: tuple[float, ExistingResume] | None = None
    for other in candidates:
        if not other.text:
            continue
        score = jaccard(own_shingles, shingles(other.text))
        if best is None or score > best[0]:
            best = (score, other)
    if best and best[0] >= threshold:
        return DuplicateMatch(
            "near_duplicate",
            best[1].id,
            round(best[0], 4),
            f"Word 3-shingle Jaccard similarity {best[0]:.2f} ≥ threshold {threshold:.2f}",
        )
    return None


DUPLICATE_METHODS = {
    "exact_file": "Identical file (SHA-256 of file bytes)",
    "exact_text": "Identical text after normalising case, punctuation and whitespace",
    "near_duplicate": "Word 3-shingle Jaccard similarity above the configured threshold",
}


def is_excluded_from_ranking(duplicate_status: str, resolution: str) -> bool:
    """Exact duplicates are excluded unless a recruiter marks them distinct;
    near duplicates are excluded only once a recruiter confirms them."""
    if resolution == "not_duplicate" or duplicate_status == "unique":
        return False
    if duplicate_status in ("exact_file", "exact_text"):
        return True
    return resolution == "confirmed_duplicate"
