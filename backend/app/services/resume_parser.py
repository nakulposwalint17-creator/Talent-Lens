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

from app.services.prompt_safety import strip_invisible

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".pdf", ".docx"}
MIN_TEXT_CHARS = 40
MAX_TEXT_CHARS = 120_000
MAX_DOCX_UNCOMPRESSED = 60 * 1024 * 1024  # zip-bomb guard

# Text a human reader can't see is a classic way to smuggle instructions to automated
# screeners, so it is removed before storage and the recruiter is told about it.
HIDDEN_TEXT_WARNING = "Hidden text was removed"
TAG_CHARS_WARNING = "Invisible Unicode tag characters were removed"
MIN_VISIBLE_FONT_PT = 3.0
_LIGHT_CHANNEL = 0xE6  # each RGB channel at or above this counts as near-white

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
    text, _ = strip_invisible(text)
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
        hidden_chars = tag_chars = 0
        cursor = 0
        for index in range(min(page_count, max_pages)):
            page = doc.load_page(index)
            hidden_chars += _remove_hidden_pdf_text(page)
            raw_text = page.get_text("text", sort=True)
            tag_chars += strip_invisible(raw_text)[1]
            page_text = clean_text(raw_text)
            if page.get_images(full=False):
                has_images = True
            if parts:
                cursor += 2  # "\n\n" separator
            offsets.append(cursor)
            parts.append(page_text)
            cursor += len(page_text)

    text = "\n\n".join(parts)
    warnings.extend(_hidden_text_warnings(hidden_chars, tag_chars))
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
    hidden = [0]

    def visible(element) -> str:
        parts = []
        for run in element.iter(qn("w:r")):
            run_text = "".join(t.text or "" for t in run.findall(qn("w:t")))
            if run_text and _docx_run_hidden(run):
                hidden[0] += len(run_text.strip())
            else:
                parts.append(run_text)
        return "".join(parts)

    body = document.element.body
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            lines.append(visible(child))
        elif child.tag == qn("w:tbl"):
            for row in child.iter(qn("w:tr")):
                cells = []
                for cell in row.iter(qn("w:tc")):
                    cell_text = " ".join(visible(p) for p in cell.iter(qn("w:p"))).strip()
                    if cell_text:
                        cells.append(cell_text)
                if cells:
                    lines.append(" | ".join(cells))

    raw_text = "\n".join(lines)
    text = clean_text(raw_text)
    warnings: list[str] = _hidden_text_warnings(hidden[0], strip_invisible(raw_text)[1])
    if len(text) < MIN_TEXT_CHARS:
        raise _ParseFailure("empty_document", "The DOCX contains no readable text.", ParseStatus.EMPTY)
    if len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]
        warnings.append("Extracted text was truncated to the first 120,000 characters.")
    return text, None, None, warnings


# ---------------------------------------------------------------------------- hidden text
def _hidden_text_warnings(hidden_chars: int, tag_chars: int) -> list[str]:
    warnings = []
    if hidden_chars:
        warnings.append(
            f"{HIDDEN_TEXT_WARNING} before evaluation ({hidden_chars} characters of white, covered, microscopic, "
            "transparent or hidden-formatted text). Hidden text can be used to manipulate automated screening; review the "
            "original file."
        )
    if tag_chars:
        warnings.append(f"{TAG_CHARS_WARNING} ({tag_chars}). They are invisible to readers but can carry hidden "
                        "instructions; review the original file.")
    return warnings


def _is_light(rgb: int) -> bool:
    return all(((rgb >> shift) & 0xFF) >= _LIGHT_CHANNEL for shift in (16, 8, 0))


class _PageRender:
    """The page rendered once (greyscale), used to check whether each text span is actually visible.

    A span is hidden when the middle of its box shows no contrast: the text is the same colour as
    whatever is drawn behind or over it (white-on-white, or text covered by a filled shape). Light
    text on a dark banner, a common resume design, renders with contrast and is kept.
    """

    DPI = 96
    MIN_CONTRAST = 24

    def __init__(self, page: pymupdf.Page) -> None:
        self._page = page
        self._pix: pymupdf.Pixmap | None = None
        self._failed = False

    def _pixmap(self) -> pymupdf.Pixmap | None:
        if self._pix is None and not self._failed:
            try:
                self._pix = self._page.get_pixmap(dpi=self.DPI, colorspace=pymupdf.csGRAY, alpha=False)
            except Exception:  # noqa: BLE001 - be conservative: keep text we can't check
                self._failed = True
        return self._pix

    def is_invisible(self, rect: pymupdf.Rect, light: bool) -> bool:
        # Span boxes on rotated pages don't map directly onto the rendered image; there, only
        # light-coloured text is checked, with a per-span render.
        if self._page.rotation:
            return light and _clip_is_uniform(self._page, rect)
        pix = self._pixmap()
        if pix is None:
            return False
        scale = self.DPI / 72
        origin = self._page.rect
        # Sample the vertical middle of the span: glyph boxes overlap neighbouring lines when spacing is tight.
        inset = rect.height * 0.3
        x0 = max(0, int((rect.x0 - origin.x0) * scale))
        x1 = min(pix.width, int((rect.x1 - origin.x0) * scale) + 1)
        y0 = max(0, int((rect.y0 + inset - origin.y0) * scale))
        y1 = min(pix.height, int((rect.y1 - inset - origin.y0) * scale) + 1)
        if x1 <= x0 or y1 <= y0:
            return False
        samples, stride = pix.samples_mv, pix.stride
        low, high = 255, 0
        for row in range(y0, y1):
            segment = samples[row * stride + x0: row * stride + x1]
            low, high = min(low, min(segment)), max(high, max(segment))
            if high - low >= self.MIN_CONTRAST:
                return False
        return True


def _clip_is_uniform(page: pymupdf.Page, rect: pymupdf.Rect) -> bool:
    inset = rect.height * 0.3
    clip = pymupdf.Rect(rect.x0, rect.y0 + inset, rect.x1, rect.y1 - inset)
    if clip.is_empty:
        return False
    try:
        pix = page.get_pixmap(clip=clip, dpi=144, colorspace=pymupdf.csGRAY, alpha=False)
    except Exception:  # noqa: BLE001
        return False
    samples = pix.samples
    return bool(samples) and max(samples) - min(samples) < _PageRender.MIN_CONTRAST


def _remove_hidden_pdf_text(page: pymupdf.Page) -> int:
    """Redact (in memory) text a reader cannot see; returns the number of characters removed."""
    hidden: list[pymupdf.Rect] = []
    removed = 0
    render = _PageRender(page)
    for block in page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                content = span.get("text", "").strip()
                if not content:
                    continue
                rect = pymupdf.Rect(span["bbox"])
                invisible = (
                    span.get("alpha", 255) == 0  # transparent fill or invisible render mode
                    or span.get("size", MIN_VISIBLE_FONT_PT) < MIN_VISIBLE_FONT_PT
                    or render.is_invisible(rect, light=_is_light(span.get("color", 0)))
                )
                if invisible:
                    hidden.append(rect)
                    removed += len(content)
    if hidden:
        for rect in hidden:
            # Inset vertically so neighbouring visible lines are never caught by the redaction.
            inset = rect.height * 0.25
            page.add_redact_annot(pymupdf.Rect(rect.x0, rect.y0 + inset, rect.x1, rect.y1 - inset))
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
    return removed


def _on(element) -> bool:
    return element is not None and (element.get(qn("w:val")) or "true").lower() not in ("0", "false", "off")


def _shaded(props) -> bool:
    if props is None:
        return False
    shd = props.find(qn("w:shd"))
    fill = (shd.get(qn("w:fill")) or "auto").upper() if shd is not None else "AUTO"
    highlight = props.find(qn("w:highlight"))
    return fill not in ("AUTO", "FFFFFF") or (highlight is not None and highlight.get(qn("w:val")) not in (None, "none", "white"))


def _docx_run_hidden(run) -> bool:
    """Hidden formatting, near-white text on an unshaded background, or a font under MIN_VISIBLE_FONT_PT.
    Formatting inherited from styles is not resolved; direct run formatting is what hiding tricks use."""
    rpr = run.find(qn("w:rPr"))
    if rpr is None:
        return False
    if any(_on(rpr.find(qn(tag))) for tag in ("w:vanish", "w:specVanish", "w:webHidden")):
        return True
    size = rpr.find(qn("w:sz"))
    if size is not None:
        try:
            if int(size.get(qn("w:val")) or 24) < MIN_VISIBLE_FONT_PT * 2:  # half-points
                return True
        except ValueError:
            pass
    color = rpr.find(qn("w:color"))
    value = (color.get(qn("w:val")) or "") if color is not None else ""
    if len(value) == 6 and all(c in "0123456789abcdefABCDEF" for c in value) and _is_light(int(value, 16)):
        paragraph = next((a for a in run.iterancestors(qn("w:p"))), None)
        cell = next((a for a in run.iterancestors(qn("w:tc"))), None)
        backgrounds = [rpr,
                       paragraph.find(qn("w:pPr")) if paragraph is not None else None,
                       cell.find(qn("w:tcPr")) if cell is not None else None]
        return not any(_shaded(props) for props in backgrounds)
    return False
