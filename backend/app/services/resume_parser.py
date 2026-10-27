"""Resume file validation and text extraction.

Files are inspected by their *content* (magic bytes / container structure), not
by their extension. Uploaded content is only ever read as data: nothing is
executed, rendered as HTML, or written to a publicly served location. Parsing
happens fully in memory, so no temporary files are created by this module.
"""

from __future__ import annotations

import hashlib
import io
import logging
import re
import unicodedata
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePath

import pymupdf
from docx import Document
from docx.oxml.ns import qn

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".pdf", ".docx"}
MIN_TEXT_CHARS = 40
MAX_TEXT_CHARS = 120_000
MAX_DOCX_UNCOMPRESSED = 60 * 1024 * 1024  # zip-bomb guard

pymupdf.TOOLS.mupdf_display_errors(False)
pymupdf.TOOLS.mupdf_display_warnings(False)


class ParseStatus:
    PARSED = "parsed"
    FAILED = "failed"
    NEEDS_OCR = "needs_ocr"
    EMPTY = "empty"


@dataclass
class ParseResult:
    status: str
    detected_format: str | None
    file_hash: str
    file_size: int
    text: str | None = None
    page_count: int | None = None
    page_offsets: list[int] | None = None
    error_code: str | None = None
    error_message: str | None = None
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.status == ParseStatus.PARSED


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sanitize_filename(name: str | None) -> str:
    base = PurePath((name or "").replace("\\", "/")).name
    base = unicodedata.normalize("NFKC", base)
    base = re.sub(r"[\x00-\x1f\x7f]", "", base).strip()
    return (base or "unnamed-file")[:200]


def detect_format(data: bytes) -> str | None:
    """Return 'pdf', 'docx', 'doc' (legacy, unsupported) or None."""
    head = data[:1024]
    if b"%PDF-" in head:
        return "pdf"
    if data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "doc"
    if data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = set(zf.namelist())
        except zipfile.BadZipFile:
            return "zip-corrupt"
        if "word/document.xml" in names and "[Content_Types].xml" in names:
            return "docx"
        return "zip"
    return None


def clean_text(text: str) -> str:
    text = text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n").replace(" ", " ")
    text = re.sub(r"[ \t\f\v]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def parse_resume(filename: str, data: bytes, *, max_bytes: int, max_pdf_pages: int = 30) -> ParseResult:
    size = len(data)
    file_hash = sha256_hex(data)
    ext = PurePath(filename).suffix.lower()

    def fail(code: str, message: str, status: str = ParseStatus.FAILED, fmt: str | None = None) -> ParseResult:
        return ParseResult(status=status, detected_format=fmt, file_hash=file_hash, file_size=size,
                           error_code=code, error_message=message)

    if size == 0:
        return fail("empty_file", "The file is empty (0 bytes).", ParseStatus.EMPTY)
    if size > max_bytes:
        return fail("file_too_large", f"The file exceeds the {max_bytes // (1024 * 1024)} MB upload limit.")

    fmt = detect_format(data)
    if fmt == "doc":
        return fail("unsupported_format", "Legacy Word (.doc) files are not supported. Save the resume as DOCX or PDF.", fmt=fmt)
    if fmt == "zip-corrupt":
        return fail("corrupted_file", "The file looks like a Word document but its archive structure is damaged.", fmt="docx")
    if fmt not in ("pdf", "docx"):
        if ext in ALLOWED_EXTENSIONS:
            return fail("corrupted_file", f"The file has a {ext} extension but its contents are not a valid {ext[1:].upper()} document.")
        return fail("unsupported_format", "Unsupported file type. Upload PDF or DOCX resumes.")

    warnings: list[str] = []
    if ext != f".{fmt}":
        warnings.append(
            f"File extension '{ext or '(none)'}' does not match its contents ({fmt.upper()}); processed as {fmt.upper()}."
        )

    try:
        result = _parse_pdf(data, max_pdf_pages) if fmt == "pdf" else _parse_docx(data)
    except _ParseFailure as exc:
        return fail(exc.code, exc.message, exc.status, fmt)
    except Exception:  # noqa: BLE001 - isolate any parser crash to this file
        logger.warning("Unexpected parser failure for a %s upload", fmt, exc_info=True)
        return fail("corrupted_file", f"The {fmt.upper()} file could not be read; it may be damaged.", fmt=fmt)

    text, page_count, page_offsets, extra_warnings = result
    warnings.extend(extra_warnings)
    return ParseResult(
        status=ParseStatus.PARSED,
        detected_format=fmt,
        file_hash=file_hash,
        file_size=size,
        text=text,
        page_count=page_count,
        page_offsets=page_offsets,
        warnings=warnings,
    )


class _ParseFailure(Exception):
    def __init__(self, code: str, message: str, status: str = ParseStatus.FAILED) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _parse_pdf(data: bytes, max_pages: int) -> tuple[str, int, list[int], list[str]]:
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:  # noqa: BLE001
        raise _ParseFailure("corrupted_file", "The PDF could not be opened; it appears to be damaged.") from exc

    with doc:
        if doc.needs_pass:
            raise _ParseFailure(
                "password_protected",
                "The PDF is password-protected. Ask the candidate for an unlocked copy.",
            )
        warnings: list[str] = []
        page_count = doc.page_count
        if page_count == 0:
            raise _ParseFailure("corrupted_file", "The PDF appears to be damaged: no readable pages were found.")
        if page_count > max_pages:
            warnings.append(f"Only the first {max_pages} of {page_count} pages were processed.")

        parts: list[str] = []
        offsets: list[int] = []
        has_images = False
        cursor = 0
        for index in range(min(page_count, max_pages)):
            page = doc.load_page(index)
            page_text = clean_text(page.get_text("text", sort=True))
            if page.get_images(full=False):
                has_images = True
            if parts:
                cursor += 2  # "\n\n" separator
            offsets.append(cursor)
            parts.append(page_text)
            cursor += len(page_text)

    text = "\n\n".join(parts)
    if len(text.strip()) < MIN_TEXT_CHARS:
        if has_images:
            raise _ParseFailure(
                "no_extractable_text",
                "No extractable text was found. This looks like a scanned or image-only PDF; OCR is not "
                "supported, so the resume needs manual review.",
                ParseStatus.NEEDS_OCR,
            )
        raise _ParseFailure("empty_document", "The PDF contains no readable text.", ParseStatus.EMPTY)
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]
        warnings.append("Extracted text was truncated to the first 120,000 characters.")
    return text, page_count, offsets, warnings


def _parse_docx(data: bytes) -> tuple[str, int | None, None, list[str]]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            uncompressed = sum(info.file_size for info in zf.infolist())
    except zipfile.BadZipFile as exc:
        raise _ParseFailure("corrupted_file", "The DOCX archive is damaged.") from exc
    if uncompressed > MAX_DOCX_UNCOMPRESSED:
        raise _ParseFailure("unsafe_archive", "The DOCX expands to an unusually large size and was not processed.")

    try:
        document = Document(io.BytesIO(data))
    except Exception as exc:  # noqa: BLE001
        raise _ParseFailure("corrupted_file", "The DOCX file could not be opened; it appears to be damaged.") from exc

    lines: list[str] = []
    body = document.element.body
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            lines.append("".join(node.text or "" for node in child.iter(qn("w:t"))))
        elif child.tag == qn("w:tbl"):
            for row in child.iter(qn("w:tr")):
                cells = []
                for cell in row.iter(qn("w:tc")):
                    cell_text = " ".join(
                        "".join(n.text or "" for n in p.iter(qn("w:t"))) for p in cell.iter(qn("w:p"))
                    ).strip()
                    if cell_text:
                        cells.append(cell_text)
                if cells:
                    lines.append(" | ".join(cells))

    text = clean_text("\n".join(lines))
    warnings: list[str] = []
    if len(text) < MIN_TEXT_CHARS:
        raise _ParseFailure("empty_document", "The DOCX contains no readable text.", ParseStatus.EMPTY)
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]
        warnings.append("Extracted text was truncated to the first 120,000 characters.")
    return text, None, None, warnings
