"""Defences for untrusted text (resumes, pasted job descriptions) before it reaches a model.

The system prompt tells the model to treat resume text as data, but that is one
layer. The application adds deterministic layers that do not depend on the model
following its instructions:

1. Invisible characters that a reader can't see but a model can read (Unicode
   tag characters used for "ASCII smuggling", zero-width spaces, bidi overrides)
   are stripped during parsing (see ``strip_invisible``).
2. Hidden text in the file itself (white-on-white, microscopic, transparent or
   invisible-render-mode text) is removed by the parser before storage.
3. Lines that look like instructions to an AI system are removed from the text
   sent to the model and flagged for the recruiter (``redact_instruction_lines``).
4. The untrusted block is fenced with a random, unguessable tag name and any
   delimiter-like tags inside it are neutralised, so text such as ``</resume>``
   can't close the data block early (``fence``).

And on the way back, the model's output is treated as untrusted too:

5. Free-text fields are scanned for hiring directives or instruction-like text
   the model was told never to produce (``find_output_directives``).
6. For live AI, the evaluation pipeline compares the score with the
   deterministic rule-based baseline and flags large unexplained gaps
   (see ``app.services.evaluation``).
7. Quotes are verified against the resume and unsupported positive judgements
   are downgraded (see ``app.services.evidence``); the overall score and the
   recommendation are always computed by application code.
"""

from __future__ import annotations

import re
import secrets

INJECTION_PATTERNS = [
    r"ignore\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions|prompts?|directions|rules)",
    r"disregard\s+(?:all\s+|any\s+|the\s+)?(?:previous\s+|prior\s+|above\s+)?(?:instructions|rules|criteria|guidelines)",
    r"(?:forget|override)\s+(?:all\s+|any\s+|your\s+|the\s+)?(?:previous\s+|prior\s+|above\s+)?(?:instructions|rules|guidelines)",
    r"(?:you\s+are|act\s+as)\s+(?:now\s+)?(?:an?\s+)?(?:ai|assistant|language\s+model|llm|chatgpt|claude|gpt)",
    r"(?:rank|rate|score|mark|classify|evaluate)\s+(?:this|the|me|my)\s+(?:candidate|applicant|resume|profile|application)?\s*(?:as|at|with)\s+(?:a\s+)?(?:the\s+)?(?:top|perfect|strong|best|highest|100|maximum)",
    r"(?:system|developer)\s+(?:prompt|message|instructions?)",
    r"new\s+instructions\s*:",
    r"\b100\s*/\s*100\b|score\s+of\s+100\b",
    r"(?:hire|shortlist|advance)\s+this\s+(?:candidate|applicant)\s+immediately",
    r"<\|?(?:im_start|im_end|system|endoftext)\|?>",
    r"\[/?(?:INST|SYS)\]|<</?SYS>>",
    r"^\s*(?:system|assistant|human)\s*:",
    r"(?:note|message|instructions?)\s+(?:to|for)\s+(?:the\s+|any\s+)?(?:ai|llm|language\s+model|screening\s+(?:system|tool|software|bot)|ats|automated\s+(?:system|screener|reviewer))\b",
    # Tags that mimic the prompt's own delimiters.
    r"</?\s*(?:resume|criteria|job_description|instructions?|system|prompt)(?:_[0-9a-f]+)?\s*>",
]
INJECTION_RE = re.compile("|".join(INJECTION_PATTERNS), re.IGNORECASE | re.MULTILINE)

# Unicode tag block (U+E0000–U+E007F): invisible, but models decode it as ASCII.
_TAG_CHARS_RE = re.compile("[\U000e0000-\U000e007f]")
# Zero-width space/word joiners, BOM, and bidi embedding/override/isolate controls.
_INVISIBLE_RE = re.compile("[​⁠-⁤﻿‪-‮⁦-⁩]")

_DELIMITER_TAG_RE = re.compile(
    r"<(\s*/?\s*(?:resume|criteria|job_description|document|data|untrusted)[\w-]*[^<>]{0,200})>", re.IGNORECASE
)

REDACTED_LINE = "[line removed by TalentLens: it resembles instructions to an automated system]"


def strip_invisible(text: str) -> tuple[str, int]:
    """Remove invisible characters. Returns the text and how many tag characters were removed
    (those only appear in deliberately crafted text, so the caller warns about them)."""
    tag_chars = len(_TAG_CHARS_RE.findall(text))
    text = _TAG_CHARS_RE.sub("", text)
    return _INVISIBLE_RE.sub("", text), tag_chars


def find_instruction_lines(text: str) -> list[str]:
    return [line.strip() for line in text.splitlines() if INJECTION_RE.search(line)]


def redact_instruction_lines(text: str) -> tuple[str, int]:
    """Replace lines that look like instructions to an AI with a neutral placeholder."""
    removed = 0
    lines = []
    for line in text.split("\n"):
        if INJECTION_RE.search(line):
            removed += 1
            lines.append(REDACTED_LINE)
        else:
            lines.append(line)
    return "\n".join(lines), removed


def neutralise_delimiters(text: str) -> str:
    """Turn tag-like sequences that could imitate prompt delimiters into inert look-alikes."""
    return _DELIMITER_TAG_RE.sub(lambda m: f"‹{m.group(1)}›", text)


def fence(label: str, text: str) -> tuple[str, str]:
    """Wrap untrusted text in a block whose tag name carries a random id.

    Returns ``(block, tag_name)``. Because the id is generated per request, text
    inside the block cannot know (and so cannot forge) the closing tag.
    """
    tag = f"{label}_{secrets.token_hex(8)}"
    return f"<{tag}>\n{neutralise_delimiters(text)}\n</{tag}>", tag


# Phrases the model is instructed never to write: hiring decisions, directives to the
# recruiter, or attempts to wave away the application's own checks.
_OUTPUT_DIRECTIVE_PATTERNS = [
    r"\b(?:you|we|i|recruiters?|the\s+team)\s+(?:should|must|need\s+to|have\s+to)\s+"
    r"(?:immediately\s+)?(?:hire|advance|shortlist|interview|reject|make\s+an\s+offer)\b",
    r"^\s*(?:hire|advance|shortlist|reject)\s+(?:this|the)\s+(?:candidate|applicant)\b",
    r"\b(?:hire|advance|shortlist)\s+(?:this|the)\s+(?:candidate|applicant)\s+(?:immediately|now|without)\b",
    r"\b(?:ignore|disregard|skip|override)\b.{0,40}\b(?:flags?|concerns?|warnings?|verification|criteria|instructions)\b",
    r"\bwithout\s+(?:any\s+)?(?:further\s+)?(?:review|verification|checks?)\b",
]
_OUTPUT_DIRECTIVE_RE = re.compile("|".join(_OUTPUT_DIRECTIVE_PATTERNS), re.IGNORECASE | re.MULTILINE)


def find_output_directives(texts: list[str | None]) -> list[str]:
    """Snippets of model output that read as directives or instructions rather than evidence."""
    hits = []
    for text in texts:
        if not text:
            continue
        for match in (_OUTPUT_DIRECTIVE_RE.search(text), INJECTION_RE.search(text)):
            if match:
                start = max(0, match.start() - 30)
                hits.append(text[start:match.end() + 30].strip())
                break
    return hits
