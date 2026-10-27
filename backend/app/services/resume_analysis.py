"""Deterministic structural analysis of extracted resume text.

Used by both providers: the demo provider builds its whole assessment from it,
and the live provider receives the computed employment timeline as
application-verified facts. Nothing here infers protected characteristics.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

SECTION_ALIASES: dict[str, list[str]] = {
    "experience": [
        "experience", "work experience", "professional experience", "employment", "employment history",
        "work history", "career history", "relevant experience", "professional history", "selected work",
        "freelance work", "freelance experience", "consulting experience", "client work", "independent work",
        "internships", "internship experience",
    ],
    "projects": [
        "projects", "selected projects", "personal projects", "key projects", "portfolio", "open source",
        "open-source", "project experience", "side projects", "notable projects",
    ],
    "skills": [
        "skills", "technical skills", "core skills", "technologies", "tools", "skills & tools",
        "skills and tools", "tech stack", "core competencies", "competencies",
    ],
    "education": ["education", "academic background", "education & training", "training"],
    "certifications": ["certifications", "certificates", "licenses", "licenses & certifications", "certification"],
    "summary": ["summary", "profile", "about", "about me", "professional summary", "objective", "overview"],
    "other": [
        "awards", "publications", "volunteering", "volunteer experience", "interests", "languages",
        "references", "achievements", "activities", "contact",
    ],
}
APPLIED_SECTIONS = {"experience", "projects"}

_HEADING_LOOKUP = {alias: section for section, aliases in SECTION_ALIASES.items() for alias in aliases}

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_MONTH_RE = r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?"


def _date_re(prefix: str) -> str:
    return (
        rf"(?:(?P<{prefix}mon>{_MONTH_RE})\.?\s+|(?P<{prefix}num>\d{{1,2}})\s*[/.]\s*)?"
        rf"(?P<{prefix}year>(?:19|20)\d{{2}})"
    )


_RANGE_RE = re.compile(
    rf"(?<!\d){_date_re('s')}\s*(?:-|–|—|to|until)\s*"
    rf"(?:(?P<present>present|current|currently|now|today|ongoing|date)|{_date_re('e')})(?!\d)",
    re.IGNORECASE,
)

_INJECTION_PATTERNS = [
    r"ignore\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions|prompts?|directions|rules)",
    r"disregard\s+(?:all\s+|any\s+|the\s+)?(?:previous\s+|prior\s+|above\s+)?(?:instructions|rules|criteria|guidelines)",
    r"(?:you\s+are|act\s+as)\s+(?:now\s+)?(?:an?\s+)?(?:ai|assistant|language\s+model|llm|chatgpt|claude|gpt)",
    r"(?:rank|rate|score|mark|classify|evaluate)\s+(?:this|the|me|my)\s+(?:candidate|applicant|resume|profile|application)?\s*(?:as|at|with)\s+(?:a\s+)?(?:the\s+)?(?:top|perfect|strong|best|highest|100|maximum)",
    r"(?:system|developer)\s+(?:prompt|message|instructions?)",
    r"new\s+instructions\s*:",
    r"\b100\s*/\s*100\b|score\s+of\s+100\b",
    r"(?:hire|shortlist|advance)\s+this\s+(?:candidate|applicant)\s+immediately",
    r"<\|?(?:im_start|system|endoftext)\|?>",
]
_INJECTION_RE = re.compile("|".join(_INJECTION_PATTERNS), re.IGNORECASE)

_BULLET_RE = re.compile(r"^[\s•●▪◦·*\-–—]+")
_NAME_TOKEN = re.compile(r"^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’\-.]*$")


@dataclass
class Line:
    index: int
    text: str
    start: int
    end: int
    section: str = "unknown"
    is_heading: bool = False
    is_injection: bool = False

    @property
    def clean(self) -> str:
        return _BULLET_RE.sub("", self.text).strip()


@dataclass
class DateSpan:
    start_year: int
    start_month: int
    end_year: int
    end_month: int
    month_precision: bool
    is_present: bool
    raw: str

    @property
    def start_index(self) -> int:
        return self.start_year * 12 + (self.start_month - 1)

    @property
    def end_index(self) -> int:
        """Exclusive month index. Month-precision ends are inclusive of that month;
        year-only ends are counted conservatively up to January of that year."""
        base = self.end_year * 12 + (self.end_month - 1)
        return base + 1 if (self.month_precision or self.is_present) else base

    @property
    def months(self) -> int:
        return max(0, self.end_index - self.start_index)

    def label(self, which: str) -> str:
        if which == "start":
            return f"{self.start_year}-{self.start_month:02d}" if self.month_precision else str(self.start_year)
        if self.is_present:
            return "present"
        return f"{self.end_year}-{self.end_month:02d}" if self.month_precision else str(self.end_year)


@dataclass
class Role:
    header: Line
    span: DateSpan
    title: str
    block: list[Line] = field(default_factory=list)

    @property
    def block_text(self) -> str:
        return "\n".join(line.text for line in self.block)


@dataclass
class DateIssue:
    line: Line
    message: str


@dataclass
class ResumeAnalysis:
    text: str
    lines: list[Line]
    sections_found: set[str]
    name: str | None
    roles: list[Role]
    date_issues: list[DateIssue]
    injection_lines: list[Line]
    as_of: date

    @property
    def content_lines(self) -> list[Line]:
        return [ln for ln in self.lines if not ln.is_heading and not ln.is_injection and ln.clean]

    def applied_lines(self) -> list[Line]:
        """Lines describing work actually done (experience/projects)."""
        if self.sections_found & APPLIED_SECTIONS:
            return [ln for ln in self.content_lines if ln.section in APPLIED_SECTIONS]
        # Unstructured resume: treat sentence-like lines as describing work.
        return [ln for ln in self.content_lines if len(ln.clean) >= 60]


def merged_months(spans: list[DateSpan]) -> tuple[int, bool]:
    """Total months covered by ``spans`` counting overlaps once. Returns (months, had_overlap)."""
    intervals = sorted((s.start_index, s.end_index) for s in spans if s.end_index > s.start_index)
    total = 0
    overlap = False
    current: list[int] | None = None
    for start, end in intervals:
        if current is None:
            current = [start, end]
        elif start < current[1]:
            overlap = True
            current[1] = max(current[1], end)
        else:
            total += current[1] - current[0]
            current = [start, end]
    if current is not None:
        total += current[1] - current[0]
    return total, overlap


def _heading_section(text: str) -> str | None:
    stripped = text.strip()
    if not stripped or len(stripped) > 48:
        return None
    key = re.sub(r"[^a-z&\- ]", "", stripped.lower().rstrip(":")).strip()
    key = " ".join(key.split())
    return _HEADING_LOOKUP.get(key)


def _split_lines(text: str) -> list[Line]:
    lines: list[Line] = []
    offset = 0
    for i, raw in enumerate(text.split("\n")):
        stripped = raw.strip()
        lead = len(raw) - len(raw.lstrip())
        lines.append(Line(index=i, text=stripped, start=offset + lead, end=offset + lead + len(stripped)))
        offset += len(raw) + 1
    return lines


def _detect_name(lines: list[Line]) -> str | None:
    for line in [ln for ln in lines if ln.text][:4]:
        text = re.sub(r"^(?:name|candidate)\s*:\s*", "", line.text, flags=re.IGNORECASE).strip()
        if _heading_section(text) or any(ch.isdigit() for ch in text) or "@" in text:
            continue
        if re.search(r"resume|curriculum|vitae|\bcv\b", text, re.IGNORECASE):
            continue
        tokens = text.split()
        if 2 <= len(tokens) <= 4 and len(text) <= 40 and all(_NAME_TOKEN.match(t) for t in tokens):
            if text.isupper():
                text = " ".join(t.capitalize() for t in tokens)
            return text
    return None


def _parse_span(match: re.Match[str], as_of: date) -> DateSpan | None:
    def month(prefix: str) -> int | None:
        mon = match.group(f"{prefix}mon")
        num = match.group(f"{prefix}num")
        if mon:
            return _MONTHS[mon[:3].lower()]
        if num and 1 <= int(num) <= 12:
            return int(num)
        return None

    start_year = int(match.group("syear"))
    start_month = month("s")
    if match.group("present"):
        end_year, end_month, present = as_of.year, as_of.month, True
        precision = start_month is not None
    else:
        end_year = int(match.group("eyear"))
        end_month = month("e")
        present = False
        precision = start_month is not None and end_month is not None
    if not precision:
        start_month = start_month or 1
        end_month = 1 if not present else end_month
    return DateSpan(start_year, start_month or 1, end_year, end_month or 1, precision, present, match.group(0))


def analyze_resume(text: str, as_of: date | None = None) -> ResumeAnalysis:
    as_of = as_of or date.today()
    lines = _split_lines(text)

    section = "unknown"
    found: set[str] = set()
    for line in lines:
        heading = _heading_section(line.text)
        if heading:
            section = heading
            line.is_heading = True
            found.add(heading)
        line.section = section
        if re.match(r"^(?:technical\s+)?skills\s*:", line.text, re.IGNORECASE):
            line.section = "skills"
        if _INJECTION_RE.search(line.text):
            line.is_injection = True

    roles: list[Role] = []
    issues: list[DateIssue] = []
    eligible_sections = {"experience"} if "experience" in found else {"experience", "unknown", "summary"}
    for line in lines:
        if line.is_heading or line.is_injection or line.section not in eligible_sections:
            continue
        match = _RANGE_RE.search(line.text)
        if not match:
            continue
        span = _parse_span(match, as_of)
        if span is None:
            continue
        if span.end_index < span.start_index:
            issues.append(DateIssue(line, f"End date precedes start date in '{span.raw}'."))
            continue
        if span.start_year * 12 + span.start_month - 1 > as_of.year * 12 + as_of.month - 1:
            issues.append(DateIssue(line, f"Start date in '{span.raw}' is in the future."))
            continue
        if not span.is_present and span.end_year * 12 + span.end_month - 1 > as_of.year * 12 + as_of.month:
            issues.append(DateIssue(line, f"End date in '{span.raw}' is in the future."))
        if span.months > 50 * 12:
            continue
        title = (line.text[: match.start()] + " " + line.text[match.end():]).strip(" |,;—–-()")
        title = " ".join(title.split())
        roles.append(Role(header=line, span=span, title=title))

    # Attach block lines: from each role header (or its title line above) to the next role.
    role_line_idx = {r.header.index for r in roles}
    for pos, role in enumerate(roles):
        start_idx = role.header.index
        prev = lines[start_idx - 1] if start_idx > 0 else None
        if len(role.title) < 4 and prev and prev.text and not prev.is_heading and prev.section == role.header.section:
            role.title = prev.clean
            start_idx = prev.index
        next_header = roles[pos + 1].header.index if pos + 1 < len(roles) else len(lines)
        if pos + 1 < len(roles) and len(roles[pos + 1].title) < 4:
            next_header -= 1  # the next role's title sits on the line above its dates
        block = [
            ln for ln in lines[start_idx:next_header]
            if ln.text and not ln.is_heading and not ln.is_injection
            and (ln.section == role.header.section or ln.index in role_line_idx)
        ]
        role.block = block
        role.title = role.title or "Untitled role"

    return ResumeAnalysis(
        text=text,
        lines=lines,
        sections_found=found,
        name=_detect_name(lines),
        roles=roles,
        date_issues=issues,
        injection_lines=[ln for ln in lines if ln.is_injection],
        as_of=as_of,
    )
