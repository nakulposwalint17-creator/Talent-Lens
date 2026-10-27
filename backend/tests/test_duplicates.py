import pytest

from app.services.duplicates import (
    ExistingResume,
    find_duplicate,
    is_excluded_from_ranking,
    jaccard,
    normalize_text,
    shingles,
    text_hash,
)
from app.services.resume_parser import parse_resume, sha256_hex
from tests.conftest import RESUME_LINES, make_docx, make_pdf

BASE = "\n".join(RESUME_LINES)


def existing(id_: str, data: bytes, text: str | None) -> ExistingResume:
    return ExistingResume(id_, sha256_hex(data), text_hash(text), text)


def test_identical_file_hash():
    data = b"%PDF-1.4 same bytes"
    match = find_duplicate(sha256_hex(data), "x", [existing("a", data, "something else")], 0.8)
    assert match and match.status == "exact_file" and match.duplicate_of_id == "a"


def test_identical_normalised_text_with_whitespace_and_case_differences():
    variant = BASE.upper().replace("\n", "   \n\n ").replace("•", "-")
    assert text_hash(variant) == text_hash(BASE)
    match = find_duplicate(sha256_hex(b"other"), variant, [existing("a", b"first", BASE)], 0.8)
    assert match and match.status == "exact_text"


def test_same_text_in_pdf_and_docx_is_exact_text_duplicate():
    pdf = parse_resume("a.pdf", make_pdf(), max_bytes=10**7)
    docx = parse_resume("a.docx", make_docx(), max_bytes=10**7)
    assert pdf.ok and docx.ok
    assert pdf.file_hash != docx.file_hash
    match = find_duplicate(docx.file_hash, docx.text, [ExistingResume("pdf", pdf.file_hash, text_hash(pdf.text), pdf.text)], 0.8)
    assert match and match.status == "exact_text"


def test_near_duplicate_threshold_behaviour():
    edited = BASE.replace("jordan@example.com | +1 555 0110", "jordan.dev@example.com | +1 555 0199")
    similarity = jaccard(shingles(BASE), shingles(edited))
    assert 0.6 < similarity < 1.0
    below = find_duplicate("h2", edited, [existing("a", b"f1", BASE)], threshold=similarity + 0.01)
    above = find_duplicate("h2", edited, [existing("a", b"f1", BASE)], threshold=similarity - 0.01)
    assert below is None
    assert above and above.status == "near_duplicate" and above.similarity == pytest.approx(similarity, abs=1e-4)


def test_different_candidates_with_similar_names_are_not_duplicates():
    other = "\n".join([
        "Jordan Example", "j.example@example.com", "", "EXPERIENCE",
        "Nurse Practitioner, City Hospital | 2015 - 2020", "• Coordinated patient care across 3 clinics.",
        "", "EDUCATION", "MSc Nursing, Example University",
    ])
    assert find_duplicate("h2", other, [existing("a", b"f1", BASE)], 0.8) is None
    assert jaccard(shingles(BASE), shingles(other)) < 0.2


@pytest.mark.parametrize("value", ["", None, "   \n\t ", "!!!"])
def test_empty_and_malformed_inputs(value):
    assert text_hash(value) is None
    assert shingles(value) == frozenset()
    assert find_duplicate("hash", value, [existing("a", b"x", BASE)], 0.8) is None


def test_invalid_threshold_rejected():
    with pytest.raises(ValueError):
        find_duplicate("h", BASE, [], 0)


def test_normalisation():
    assert normalize_text("  Hello,\n\nWORLD — Python™ ") == "hello world pythontm"


def test_ranking_exclusion_rules_are_reversible():
    assert is_excluded_from_ranking("exact_text", "unreviewed") is True
    assert is_excluded_from_ranking("exact_text", "not_duplicate") is False
    assert is_excluded_from_ranking("near_duplicate", "unreviewed") is False
    assert is_excluded_from_ranking("near_duplicate", "confirmed_duplicate") is True
    assert is_excluded_from_ranking("unique", "confirmed_duplicate") is False
