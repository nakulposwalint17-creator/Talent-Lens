<div align="center">

<img src="frontend/app/icon.svg" alt="TalentLens logo" width="84" height="84" />

# TalentLens

### See the evidence. Find the right fit.

AI-assisted resume screening that **shows its work**: every score traces back to weighted criteria<br/>
and to quotes verified against the resume. Recruiters decide; the tool explains.

<br/>

![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.162-009688?logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Tests](https://img.shields.io/badge/tests-191%20backend%20%C2%B7%2074%20frontend%20%C2%B7%202%20E2E-2ea44f)
![Coverage](https://img.shields.io/badge/coverage-95%25%20lines%20%C2%B7%2086%25%20branches-2ea44f)
![License](https://img.shields.io/badge/license-MIT-blue)

**[Quick start](#quick-start)** · **[Features](#features)** · **[How it works](#how-it-works)** · **[Scoring](#scoring-formula-weights-thresholds)** · **[Security](#security-and-access-control)** · **[Testing](#testing)** · **[API](#api-documentation)**

</div>

<br/>

> [!IMPORTANT]
> **TalentLens is a decision-support tool. It does not make hiring decisions.**
> It runs fully in **demo mode** without any API key (a transparent, rule-based evaluator, clearly labelled and never presented as AI), and optionally in **live AI mode** using the Anthropic API.

---

## Quick start

```bash
./scripts/setup.sh   # Python venv + backend deps, npm install, .env files, demo admin account
./scripts/dev.sh     # backend on :8000, frontend on :3000 (Ctrl+C stops both)
```

Then open **http://localhost:3000** and sign in:

<table>
  <tr><th align="left">🔐 Demo login</th><th align="left"></th></tr>
  <tr><td><b>Email</b></td><td><code>admin@talentlens.local</code></td></tr>
  <tr><td><b>Password</b></td><td><code>5zAFCJZhXDi4Suo1hp-n8K8b</code></td></tr>
  <tr><td><b>Role</b></td><td>Administrator (sees every screening, can manage accounts)</td></tr>
</table>

> [!NOTE]
> This is a **public demo account for local use only**. `setup.sh` creates it, and it is stored in `backend/.env` (git-ignored). The app **refuses to start in production** with this password, so a deployment must set its own `ADMIN_PASSWORD`. For a private local password instead, run `RANDOM_ADMIN_PASSWORD=1 ./scripts/setup.sh` on a fresh `.env`.

**Try it in two minutes:** **New screening → Use sample job → Extract criteria**, tick the confirmation, then drag in the files from `samples/resumes/` (add `samples/edge-cases/` to see failure handling).

---

## Contents

<details>
<summary><b>Show all sections</b></summary>

1. [Quick start](#quick-start)
2. [Features](#features)
3. [How it works](#how-it-works)
4. [Design system](#design-system)
5. [Screenshots](#screenshots)
6. [Architecture](#architecture)
7. [Technology stack](#technology-stack)
8. [Prerequisites](#prerequisites)
9. [Installation](#installation)
10. [Environment configuration](#environment-configuration)
11. [Starting the application](#starting-the-application)
12. [Demo mode](#demo-mode)
13. [Live AI mode](#live-ai-mode)
14. [Supported files and size limits](#supported-files-and-size-limits)
15. [Scoring: formula, weights, thresholds](#scoring-formula-weights-thresholds)
16. [Missing-evidence policy](#missing-evidence-policy)
17. [Evidence verification](#evidence-verification)
18. [Duplicate detection](#duplicate-detection)
19. [Failure handling](#failure-handling)
20. [Recruiter overrides and audit history](#recruiter-overrides-and-audit-history)
21. [Security and access control](#security-and-access-control)
22. [Database and file storage](#database-and-file-storage)
23. [Testing](#testing)
24. [API documentation](#api-documentation)
25. [Accessibility](#accessibility)
26. [Implemented features](#implemented-features)
27. [Missing features](#missing-features)
28. [Known bugs](#known-bugs)
29. [Limitations and assumptions](#limitations-and-assumptions)
30. [Privacy and responsible use](#privacy-and-responsible-use)
31. [Troubleshooting](#troubleshooting)
32. [Demo recording plan (3–5 minutes)](#demo-recording-plan-35-minutes)

</details>

---

## Features

<table>
<tr>
<td width="50%" valign="top">

### 📋 Confirmed, job-related criteria
Enter criteria manually or extract them from a pasted job description. Extracted fields stay marked *“Extracted · review”*, and nothing is scored until the recruiter explicitly confirms. Weights are set per screening.

</td>
<td width="50%" valign="top">

### 📄 Robust batch upload
Drag in a mixed batch of PDF and DOCX files, detected by **content** rather than extension. Corrupt, empty, password-protected, scanned, legacy `.doc` and oversized files each get a clear status, and one bad file never affects the others.

</td>
</tr>
<tr>
<td valign="top">

### 🎯 Explainable, deterministic scoring
Four weighted criteria, an explicit missing-evidence policy and evidence completeness. The **overall score is always computed by application code**, never by a model.

</td>
<td valign="top">

### 🔍 Verified evidence
Every quote is located in the resume text. Quotes that can't be found are shown **struck through as rejected** and can't support a score. *Show in resume* highlights the passage.

</td>
</tr>
<tr>
<td valign="top">

### 👯 Three-level duplicate detection
Identical file, identical text (the same resume as PDF and DOCX) and near duplicates. Every duplicate is reviewable and reversible; nothing is merged.

</td>
<td valign="top">

### ✅ Recruiter decisions with an audit trail
Advance, Hold, Reject or Needs review. Overrides need a reason, the AI assessment is never modified, and every action records **who** did it.

</td>
</tr>
<tr>
<td valign="top">

### 🔐 Accounts and access control
Sign-in is required everywhere. Recruiters see only their own screenings, and admins see everything. Rate-limited sign-in with account lockout. [More →](#security-and-access-control)

</td>
<td valign="top">

### 🛡️ Prompt-injection defences
Hidden and invisible text is removed, instruction-like lines are withheld from the model, delimiters can't be forged, and model output is checked against the evidence and a rule-based baseline. [More →](#security-and-access-control)

</td>
</tr>
</table>

<details>
<summary><b>Full feature list</b></summary>

- **Job setup**: enter criteria manually or extract them from a pasted job description. Extracted fields are marked *“Extracted · review”* until edited, and nothing is scored until the recruiter ticks an explicit confirmation. Per-screening scoring weights must total 100%.
- **Batch upload**:
  - Drag-and-drop or file picker, multiple files, client-side type and size checks, removal before upload, and bounded parallel uploads (3).
  - Real per-file upload progress, then an indeterminate state while the server extracts text, with no invented percentages.
  - Live per-file status through *Ready → Uploading → Extracting text → Extracted → Evaluating → Complete*, or *Duplicate detected / Needs review / Failed*. Failed uploads can be retried.
  - A four-stage batch summary built from real counts.
- **Robust parsing**: PDF (PyMuPDF) and DOCX (python-docx, including tables), detected by *content* rather than extension. Corrupt, empty, password-protected, scanned or image-only, legacy `.doc`, unsupported and oversized files each get a specific, readable status. One bad file never affects the others.
- **Three-level duplicate detection**: identical file hash, identical normalised-text hash (the same resume as PDF and DOCX), and near-duplicate similarity. Reviewable and reversible; nothing is merged.
- **Deterministic, explainable scoring**: four weighted criteria, an explicit missing-evidence policy, an evidence-completeness indicator and recommendation bands. The overall score is always computed by application code, never by a model.
- **Verified evidence**: every quote shown as evidence is located in the extracted text. Unverifiable quotes are shown struck through as *rejected* and can't support a score. *Show in resume* highlights the passage in the full text, with the page number for PDFs.
- **Ranked shortlist**:
  - Search, a Filters menu (recommendation, review status, processing status, duplicates) and a one-click *Needs review* toggle. Active filters show as removable chips with a result count.
  - Sortable column headers that show the active field and direction (score, candidate name, relevant experience), plus a sort menu.
  - Compact score meters with threshold ticks, a *key evidence* column (required skills shown in described work, plus how many were not found), evidence completeness, and the AI recommendation and recruiter review in separate columns.
  - A per-row *Review* action and a ⋯ menu: record a decision in a dialog, retry a failed evaluation, or mark *not a duplicate*.
  - A score-distribution chart.
  - Unreadable files, failed evaluations, duplicates and insufficient evidence are listed separately as **Not ranked** with the reason, never as zero scores.
- **Candidate evidence panel**:
  - Two clearly separated layers: *Original assessment* (read-only) and *Recruiter decision*.
  - The score arithmetic, and evidence grouped by criterion with job skill terms underlined inside verified quotes.
  - Required and preferred skills, a *Missing or ambiguous evidence* section in neutral language, and potential concerns requiring verification.
  - The experience timeline, qualification checks, duplicate review, the full resume text with highlights, and previous/next navigation.
- **Recruiter decisions**: Advance, Hold, Reject or Needs review. A reason is required for overrides, rejections and decisions without an AI assessment. The audit trail is append-only.
- **Re-evaluation**: retry failed evaluations, or edit criteria later. Existing evaluations are kept and marked stale, then can be re-evaluated, preserving history.
- **Screening history**, **CSV export** (all, ranked or advanced; safe against formula injection), an **Overview dashboard** with metrics computed from persisted data, and a **Methodology page** showing the live configuration.
- **Light and calm dark themes**: a Light / Dark / System switch in the sidebar and the command menu, remembered per browser and applied before first paint, so there is no flash.
- **Command menu (⌘K / Ctrl+K)**: jump to any page, saved screening, or candidate in the current screening, with full keyboard navigation.
- **Accounts and access control**: sign-in is required everywhere. Recruiters see only their own screenings; administrators see all of them and manage accounts. Sign-in is rate limited with account lockout, and every decision and event records who made it. See [Security and access control](#security-and-access-control).
- **Prompt-injection defences**: hidden and invisible text is removed before evaluation, instruction-like lines are withheld from the model, untrusted text is fenced with unguessable delimiters, and the model's output is checked against the evidence and a deterministic baseline.
- **Clear mode labelling**: a persistent *DEMO MODE* / *LIVE AI MODE* card in the sidebar and on the methodology page.

</details>

---

## How it works

```mermaid
flowchart LR
    A["📋 Job description"] --> B["Criteria<br/>(extracted, then<br/>confirmed by recruiter)"]
    C["📄 PDF / DOCX resumes"] --> D["Parse & sanitise<br/>hidden text removed"]
    D --> E["Duplicate check<br/>file · text · near"]
    B --> F
    E --> F["Assessment<br/>rule-based demo<br/>or live AI"]
    F --> G["Evidence verification<br/>every quote located<br/>in the resume"]
    G --> H["Deterministic score<br/>+ review flags"]
    H --> I["🏆 Ranked shortlist"]
    I --> J["👤 Recruiter decision<br/>(append-only audit)"]
```

The same pipeline runs for both providers: extracted text → structural analysis (dates, sections) → provider assessment (structured and Pydantic-validated) → evidence verification against the text → deterministic scoring → review flags → persisted (append-only).

---

## Design system

The interface uses a small token-based system defined in `frontend/app/globals.css`: colours, radii, shadows, motion durations and easing, z-index layers and container width. It also has typography utilities (`type-display`, `type-title`, `type-section`, `type-eyebrow`, `type-body`, `type-meta`, `type-metric`, `type-name`). Colours needed in JavaScript (charts, SVG) live in `frontend/lib/tokens.ts`.

- **Palette**: warm and light by default, with a calm slate-navy dark theme defined by the same tokens. Indigo is the single product accent, teal marks positive evidence, amber marks review states, and red is used only for genuine failures.
- **Type**: Geist for interface text and Instrument Serif for page titles and the headline score, both loaded through `next/font` with system fallbacks.
- **Components**:
  - `frontend/components/ui`: button with `disabledReason` tooltips, inputs, checkbox, search field, select, segmented control, tabs, collapsible, tooltip, dialog, drawer, dropdown with radio items, progress, skeleton.
  - `frontend/components/shared`: score meter, breakdown bar, completeness meter, avatar, animated metric, status badges, empty and error states.
- **Motion**: short and functional (≈120–240 ms, ease-out). It covers drawer and dialog entrances, collapsible sections, short list staggers on first render, number tweens when real data changes, and an indeterminate bar for server processing. `prefers-reduced-motion` disables animations and staggers.

## Screenshots

Screenshots are not committed. To capture your own:

1. Start the app (`./scripts/dev.sh`) and run through the [demo recording plan](#demo-recording-plan-35-minutes).
2. Capture: Sign in, Overview, New screening (criteria review), Upload (mixed batch), Shortlist, Candidate drawer (Assessment and Decision & audit tabs), Methodology.
3. Save them to `docs/screenshots/` and reference them here, e.g. `![Shortlist](docs/screenshots/shortlist.png)`.

---

## Architecture

```mermaid
flowchart LR
    subgraph FE["Next.js 16 · localhost:3000"]
        direction TB
        R["app/ — routes"]
        F["features/ — screen modules"]
        U["components/ — UI primitives"]
        L["lib/api.ts — typed client<br/>+ bearer token"]
    end
    subgraph BE["FastAPI · localhost:8000"]
        direction TB
        M["middleware — headers,<br/>body limits, rate limits"]
        API["api/ — auth + ownership checks"]
        S["services/ — parser · duplicates ·<br/>analysis · providers · evidence ·<br/>scoring · evaluation worker"]
        DB[("SQLite / Postgres")]
        M --> API --> S --> DB
    end
    FE -->|"JSON / multipart<br/>Authorization: Bearer"| BE
    BE -.->|"polling for progress"| FE
    S -->|"live mode only"| AN["Anthropic API"]
```

<details>
<summary><b>Backend module map</b></summary>

```
backend/app/
  api/            thin routers: auth, sessions, candidates, system; error mapping
  core/           config, database, security (hashing, tokens), middleware, rate limiter
  services/
    resume_parser   → file validation, text extraction, hidden-text removal
    prompt_safety   → injection patterns, invisible characters, delimiters, output checks
    duplicates      → hash + shingle Jaccard
    resume_analysis → sections, dates, names
    providers/      → demo | anthropic
    evidence        → quote verification
    scoring         → deterministic engine
    evaluation      → pipeline + background worker
    auth            → accounts and login sessions
  repositories/   queries
  models/         SQLAlchemy models
```

</details>

- Evaluations run on a single background worker thread. Statuses (`queued → running → completed/failed`) are persisted, and the UI polls while work is in progress.
- On startup, any evaluation left `queued` or `running` by a crash is marked *failed: interrupted* so it can be retried.
- Uploads are parsed concurrently, but duplicate detection and insertion are serialised per session.

---

## Technology stack

| Layer | Choice |
|---|---|
| **Frontend** | Next.js 16.4 (App Router), React 19, TypeScript (strict), Tailwind CSS 4, Radix UI primitives (shadcn-style components written in-repo), Lucide icons, Recharts, React Hook Form + Zod, Sonner toasts |
| **Backend** | Python 3.13, FastAPI, Pydantic 2, SQLAlchemy 2, SQLite (or Postgres), PyMuPDF, python-docx |
| **AI (optional)** | Anthropic Python SDK 2.x (`claude-opus-5-5` by default), structured outputs |
| **Testing** | pytest + pytest-cov (line + branch) + FastAPI TestClient (httpx); Vitest + Testing Library (jsdom); Playwright (Chrome) |

---

## Prerequisites

- **Python 3.11+** (developed on 3.13). `uv` is used automatically if installed, otherwise `venv` + `pip`.
- **Node.js 22+** and npm (developed on Node 24 / npm 11).
- For the E2E test: Google Chrome, or run `npx playwright install chromium` and set `PLAYWRIGHT_CHANNEL=""`.

No API key is needed for demo mode.

---

## Installation

```bash
./scripts/setup.sh
```

<details>
<summary><b>Manual installation</b></summary>

```bash
# Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
# then set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env (12+ characters)

# Frontend
cd ../frontend
npm install
cp .env.example .env.local
```

</details>

---

## Environment configuration

`backend/.env` (see `backend/.env.example`). `frontend/.env.local` takes `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8000`). A root `.env.example` summarises both.

<details>
<summary><b>All backend variables</b></summary>

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `demo` | `demo` or `anthropic` |
| `ANTHROPIC_API_KEY` | — | Required only for live mode. Never committed or logged. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model for live extraction and evaluation |
| `ANTHROPIC_EFFORT` | `medium` | `low` … `max` |
| `ANTHROPIC_TIMEOUT_SECONDS` | `90` | Per-request timeout |
| `ANTHROPIC_MAX_ATTEMPTS` | `3` | Bounded retries (exponential backoff + jitter, honours `retry-after`) |
| `ANTHROPIC_SERVER_FALLBACKS` | `true` | Server-side refusal fallbacks (beta) on supported models |
| `DATA_DIR` | `backend/data` | Where the SQLite database lives |
| `DATABASE_URL` | — | Override the database URL; `postgres://…` URLs use Postgres (used in the Render deployment) |
| `MAX_UPLOAD_MB` | `10` | Per-file limit |
| `MAX_FILES_PER_REQUEST` | `25` | Per upload request |
| `MAX_PDF_PAGES` | `30` | Pages read per PDF |
| `NEAR_DUPLICATE_THRESHOLD` | `0.80` | Shingle-Jaccard threshold |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Allowed frontend origins (`*` is refused in production) |
| `ENVIRONMENT` | `development` | `production` disables API docs, adds HSTS and refuses unsafe settings |
| `ENABLE_API_DOCS` | on in development | Force `/docs` on or off |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | First administrator, created on startup if missing (password ≥ 12 characters; the demo password is refused in production) |
| `AUTH_TOKEN_TTL_HOURS` | `12` | Sign-in session lifetime |
| `RATE_LIMIT_ENABLED` | `true` | Master switch for all rate limits |
| `RATE_LIMIT_PER_MINUTE` | `300` | `/api` requests per client IP |
| `RATE_LIMIT_EXPENSIVE_PER_MINUTE` | `30` | Uploads, extraction and evaluation runs per user |
| `LOGIN_ATTEMPTS_PER_IP` / `LOGIN_FAILURES_PER_ACCOUNT` | `20` / `5` | Per 15 minutes |
| `TRUSTED_PROXY_HOPS` | `0` | Proxies that append `X-Forwarded-For` (1 on Render) |

</details>

---

## Starting the application

One command starts both, waits for the backend health check, and stops both on Ctrl+C:

```bash
./scripts/dev.sh
```

<details>
<summary><b>Two terminals instead</b></summary>

```bash
# Terminal 1 — backend
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

</details>

| | URL |
|---|---|
| App | **http://localhost:3000** (sign-in page: `/login`) |
| API docs | **http://localhost:8000/docs** (Swagger), **/redoc**; development only |
| Health | **http://localhost:8000/api/health** |

Production-style frontend: `cd frontend && npm run build && npm start`.

---

## Demo mode

Demo mode (the default) is a complete, real workflow. It is **not** an AI model, and it is labelled as such everywhere: the sidebar card, the assessment header (*“Rule-based assessment”*), the methodology page and the CSV `provider` column.

It uses the real uploaded files, with real parsing, hashing, duplicate detection and persistence. The rule-based evaluator then:

- marks a skill **demonstrated** when it appears in an experience or project line, **partial** when it only appears in a skills or summary list, and **not found** otherwise. Synonyms count (PostgreSQL⇄Postgres), and specific tools count toward general skills (GitHub Actions → CI/CD), never the reverse;
- computes **relevant experience** from parsed date ranges. Overlapping roles are counted once. A role is relevant if its title names a focus area or required skill, or its description mentions at least two distinct ones;
- scores **projects and demonstrated work** from lines that combine an action verb with a job-relevant skill. A line earns +0.5 when its outcome is quantified, and 5 points is full marks;
- surfaces **qualification checks**, **embedded instructions**, **date inconsistencies** and **very short text** for human review.

Every quote it cites is a verbatim excerpt, and still goes through the same evidence verification and scoring engine as live mode. Requirement extraction in demo mode uses headings (*Requirements* / *Nice to have*), a built-in vocabulary of 83 technical skills, and year patterns. It always reports its uncertainty.

### Synthetic sample data

`samples/` contains invented people and a fictional job description (see `samples/README.md`). Regenerate them with `backend/.venv/bin/python samples/generate_samples.py`.

With the sample job's extracted criteria, demo mode currently produces (rounded):

| Candidate | Score | What it shows |
|---|---:|---|
| Amara Okafor | 97 | Strong match |
| Daniel Reyes | 76 | Potential match; plus a flagged near-duplicate copy |
| Mei Lin Chen | 72 | Career changer; analyst years correctly not counted as backend experience |
| Sam Patel | 56 | Freelancer with no dates: experience excluded, 75% evidence completeness |
| Riley Morgan | 49 | Embedded instructions flagged and ignored |
| Jonas Weber | ~10 | Frontend profile; impossible date range flagged |

---

## Live AI mode

> [!NOTE]
> A Claude.ai subscription does **not** provide API credentials for a separately running application. Live mode needs an Anthropic API key and is billed per use through the Anthropic API.

```bash
# backend/.env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

Restart the backend and the sidebar switches to **LIVE AI MODE** with the model name. If `AI_PROVIDER=anthropic` is set but no key is, the app stays in demo mode and shows a warning.

How the live provider behaves:

- It requests JSON with `output_config.format` (a strict JSON schema derived from the Pydantic models), then **independently validates** the response with Pydantic. Malformed JSON, missing fields, invalid enum values and out-of-range numbers are rejected.
- Resume text is sent as untrusted data inside a block with a random per-request tag, after hidden text, invisible characters and instruction-like lines have been removed.
- The system prompt tells the model to:
  - ignore embedded instructions and report them as a concern;
  - assess only job-related evidence;
  - avoid protected characteristics and prestige proxies;
  - never compute the overall score.

  Its output is then checked independently. See [prompt-injection and LLM-output defences](#security-and-access-control).
- Employment durations come from the application's own date parser, not the model.
- Retries are bounded: timeouts, connection errors, 429 (honouring `retry-after`), 5xx and invalid output are retried. Auth, permission, model and bad-request errors fail immediately. `refusal` and truncated responses are handled explicitly. SDK-level retries are disabled, so the behaviour is explicit and tested.
- Any failure becomes **“Unable to evaluate”** with the reason (never a low score) and can be retried. Saved results load without any API call.

> [!WARNING]
> **Live mode has not been exercised against the real Anthropic API in this build** (no key was available). It is covered by 13 tests that mock the client: success, invalid JSON, missing fields, invalid values, timeouts, rate limits with `retry-after`, retry exhaustion, connection failure, 5xx, auth errors, refusal, truncation and the fallback toggle.

---

## Supported files and size limits

| | |
|---|---|
| **Formats** | **PDF** and **DOCX**, detected from file content (magic bytes / OOXML structure). A valid PDF named `.docx` is processed as PDF with a warning. |
| **Size** | **10 MB per file** (`MAX_UPLOAD_MB`), 25 files per request; the first 30 PDF pages are read |
| **Rejected with a clear status** | Empty files, corrupt PDF/DOCX, password-protected PDFs, legacy `.doc`, other formats, oversized files, DOCX archives that expand beyond 60 MB |
| **Scanned PDFs** | **OCR is not supported.** Image-only PDFs are marked *Needs OCR / manual review* and are not scored. |
| **Hidden content** | White, covered, microscopic, transparent or hidden-formatted text and invisible Unicode characters are removed before evaluation and flagged |

---

## Scoring: formula, weights, thresholds

```
overall = Σ (criterion score × normalised weight)   over assessable criteria
        = 0.40 × Required skills + 0.25 × Relevant experience
        + 0.20 × Relevant projects + 0.15 × Preferred qualifications   (when all are assessable)
```

<table>
<tr>
<td valign="top">

| Criterion | Default weight |
|---|---:|
| Required skills | **40%** |
| Relevant experience | **25%** |
| Projects and demonstrated work | **20%** |
| Preferred qualifications | **15%** |

</td>
<td valign="top">

| Recommendation | Rule (defaults) |
|---|---|
| 🟢 Strong match | 80 – 100 |
| 🔵 Potential match | 65 – 79.9 |
| ⚪ Lower evidence-based match | below 65 |
| 🟡 Insufficient evidence | < 60% of criteria weight assessable, or < 300 characters of resume text |

</td>
</tr>
</table>

- Weights are **configurable per screening**: they must total exactly 100%, and each must be a finite value from 0 to 100. They are product defaults, not universal hiring standards; different roles warrant different weights.
- Each criterion score is 0–100. NaN, infinity, out-of-range values, duplicate or missing criteria, and invalid weights are rejected.
- The overall score is rounded half-up to one decimal, and the recommendation band is computed from that same rounded value, so “80.0” is never shown as “Potential”.
- The scoring version, `tl-score-2026.10-v1`, is stored with every evaluation.
- A score never rejects anyone automatically. *Insufficient evidence* candidates are shown for human review and are not ranked.
- Required **qualifications** (such as degrees) and **additional criteria** are surfaced as verification checks with evidence. They do not change the score, but a required qualification the resume doesn't establish raises a review flag.

---

## Missing-evidence policy

- Each criterion is **demonstrated**, **partially demonstrated**, **not found in the resume**, **ambiguous**, or **not assessable**.
- *Not found* means “not established by the resume”. It is scored (low) from the available evidence, and the UI never says the candidate *lacks* the skill.
- *Ambiguous* and *not assessable* criteria are **excluded**, and the remaining weights are renormalised. **Evidence completeness** (assessed weight ÷ applicable weight) is shown on every candidate.
- Below 60% completeness, the recommendation becomes *Insufficient evidence*.
- Criteria the *job* doesn't use (such as having no preferred skills) are not applicable and don't reduce completeness.
- Employment gaps, career changes and nontraditional education are never flagged as negatives.

---

## Evidence verification

`backend/app/services/evidence.py`

- Each quote labelled `exact_quote` is searched for in the extracted text. Matching ignores case, whitespace and typographic punctuation, and `…` splits a quote into fragments that must appear in order. Matches record character offsets and, for PDFs, the page number derived from the recorded page offsets.
- The quote displayed is the resume's own text at those offsets, not the provider's copy.
- Unmatched quotes are kept for audit as **rejected** (struck through, red) and never count as evidence. Paraphrases are labelled as such and are not “verified”.
- If a criterion's positive status rests only on unverifiable quotes, it is downgraded to *ambiguous* (excluded from scoring) and flagged for review.
- Lines that look like instructions to an AI system are detected, excluded from evidence, and reported as a concern.

---

## Duplicate detection

| Level | Method |
|---|---|
| **Exact file** | SHA-256 of the uploaded bytes |
| **Exact text** | SHA-256 of the extracted text after Unicode NFKC, case-folding, punctuation and bullet removal, and whitespace collapsing. This catches the same resume uploaded as PDF and DOCX. |
| **Near duplicate** | Jaccard similarity of word 3-shingles ≥ `NEAR_DUPLICATE_THRESHOLD` (0.80) |

- The threshold is an **initial hypothesis**. On the samples, an edited copy (new email and phone, one bullet reworded) scored 0.86 and unrelated resumes about 0.04. Short resumes are more sensitive to small edits, which is why 0.80 was chosen rather than 0.90. It has not been validated on real data.
- The later upload points to the earlier one. Exact duplicates are excluded from ranking and not evaluated, which saves cost; near duplicates are evaluated and flagged.
- Recruiters can **confirm**, mark **not a duplicate**, or **reset**. All of these are reversible and logged, and nothing is merged or deleted. Unique-candidate metrics exclude confirmed and exact duplicates.

---

## Failure handling

| Situation | What the user sees |
|---|---|
| Backend down | “The backend isn't reachable” with start commands and Retry; the sidebar shows *API unreachable* |
| Corrupt, empty, encrypted, unsupported or oversized file | A per-file status with a plain-language reason; other files continue |
| Scanned PDF | *Needs OCR / manual review*; not scored |
| Upload network error | A per-file error with **Retry** |
| Provider timeout, rate limit, invalid output or outage | *Unable to evaluate* with the reason and **Retry**; never a score, and other candidates are unaffected |
| Server restarted mid-evaluation | Marked *failed: interrupted*, retryable |
| Session expired or revoked | Signed out and returned to the sign-in page, then back to the same page afterwards |
| Too many requests | `429` with `Retry-After`; the sign-in page explains how long to wait |
| Validation errors | Field-level messages (frontend) and a structured `422 {"error": {code, message, details}}` (API) |
| Database errors | `503 persistence_error` without internals; stack traces only in server logs |

---

## Recruiter overrides and audit history

- Decisions are **append-only** rows (`recruiter_reviews`). Each stores the decision, reason, notes, timestamp, **who recorded it**, and a snapshot of the AI recommendation, score and evaluation ID it was made against.
- An **override** is a decision outside the set consistent with the AI band:

  | AI band | Consistent decisions |
  |---|---|
  | Strong match | Advance |
  | Potential match | Advance or Hold |
  | Lower match | Hold or Reject |
  | Insufficient evidence | Needs review |

  Overrides, rejections, and decisions on unassessed resumes **require a reason**. The API enforces this, not just the UI.
- Evaluations are also append-only: retries and re-evaluations add attempts, and the history is shown in the drawer's audit trail.
- A session-level activity log records uploads, evaluation runs, criteria changes, duplicate reviews and decisions, each with the **actor**.

---

## Security and access control

TalentLens holds personal data (resumes), so every endpoint except `GET /api/health` and `POST /api/auth/login` requires a signed-in account. A test enumerates every route in the OpenAPI schema and asserts that each one returns `401` without credentials, so a new endpoint can't ship unprotected by accident.

```mermaid
flowchart LR
    U["Browser"] -->|"email + password"| L["/api/auth/login<br/>rate limited · lockout"]
    L -->|"bearer token<br/>(stored as SHA-256 digest)"| U
    U -->|"Authorization: Bearer"| G{"Signed in?"}
    G -- no --> X["401 → sign-in page"]
    G -- yes --> O{"Owns the screening,<br/>or admin?"}
    O -- no --> N["404 — indistinguishable<br/>from 'doesn't exist'"]
    O -- yes --> OK["✅ Request served"]
```

### Accounts and sessions

- **Two roles.** **Recruiters** see and act on only the screenings they created. **Administrators** see all screenings and manage accounts through `/api/users`: create, change role, deactivate, or reset a password. At least one active administrator must always remain.
- **The first administrator** comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` on startup. `./scripts/setup.sh` writes the [demo login](#quick-start) for local use; production refuses that password. An existing account is never overwritten by these variables.
- **Passwords** use scrypt with a per-user salt and must be at least 12 characters. Sign-in takes the same time whether or not the email exists, and returns the same error either way.
- **Sessions** use 256-bit random bearer tokens, stored server-side **only as SHA-256 digests**.
  - Tokens expire after `AUTH_TOKEN_TTL_HOURS` (default 12).
  - Signing out revokes the token.
  - Deactivating a user, or resetting their password, revokes all of their sessions.
  - Changing your own password signs out your other sessions.
- **In the browser**, the token is kept in `sessionStorage` (cleared when the tab closes) and sent in the `Authorization` header.
  - It is not a cookie, so cross-site requests can't act on the user's behalf.
  - A rejected token signs the user out and returns them to the sign-in page, then back to where they were.
  - Only same-app paths are followed after sign-in, so there are no open redirects.

### Object-level authorisation

- Every screening and candidate lookup checks ownership. Another user's screening returns `404`, exactly like one that doesn't exist, so IDs can't be probed. Tests cover all 11 session and candidate operations across two recruiters.
- The audit trail records who acted: `actor` on activity events, and `recorded_by` on recruiter decisions.

### Rate limiting

Limits are held in memory, per process, and return `429` with `Retry-After`.

| Limit | Default | Key |
|---|---|---|
| All `/api` requests | 300 / minute | client IP |
| Uploads, criteria extraction, evaluation runs | 30 / minute | user |
| Sign-in attempts | 20 / 15 minutes | client IP |
| Failed sign-ins before lockout | 5 / 15 minutes | account (even the right password is refused while locked) |

Behind a proxy, set `TRUSTED_PROXY_HOPS` to the number of proxies (1 on Render). Only the `X-Forwarded-For` entry appended by your own proxy is used, so a forged header can't dodge the limits.

### HTTP hardening

- **Request bodies are capped before parsing**: 1 MB for JSON, and the file count × size limit for uploads. Bodies streamed without `Content-Length` are counted as they arrive.
- **API response headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a `default-src 'none'` CSP, `Cache-Control: no-store` (because responses contain personal data) and, in production, HSTS.
- **Frontend headers**: the Next.js app sends a CSP that limits network access to itself and the API origin, plus frame, referrer and permissions policies.
- **CORS** allows only the configured origins and the `Authorization` header. Credentials (cookies) are disabled.
- **`ENVIRONMENT=production`** turns off `/docs`, `/redoc` and `/openapi.json` (re-enable them with `ENABLE_API_DOCS=true`) and enables HSTS. It refuses to start with wildcard CORS, a weak bootstrap password, or the public demo password.
- **The Render blueprint** sets production mode, prompts for the admin credentials (never committed), and trusts exactly one proxy hop.

### Prompt-injection and LLM-output defences

Resumes are untrusted input, written by the people being assessed. The system prompt tells the model to treat them as data, but the application doesn't rely on that alone. These layers are deterministic and tested:

| # | Layer | What it stops |
|:-:|---|---|
| 1 | **Hidden text is removed before storage.** Each PDF page is rendered once and every text span is checked for visible contrast. PDF text that is white-on-white, covered by a shape, microscopic (< 3 pt), transparent or in invisible render mode is redacted in memory. DOCX runs with hidden formatting, near-white colour on an unshaded background, or a tiny font are dropped. Light text on dark banners and shaded cells is kept. | Instructions a human reviewer can't see |
| 2 | **Invisible characters are stripped.** Unicode tag characters are removed and flagged, and zero-width spaces and bidi overrides are removed. Joiners that are meaningful in some scripts are kept. | “ASCII smuggling” and Trojan-source tricks |
| 3 | **Instruction-like lines are withheld from the model.** Known injection patterns (“ignore previous instructions”, `System:` / `[INST]`, fake delimiter tags, “note to the AI…”) are replaced with a placeholder. The app raises its own flag, whether or not the model reports it. | Direct prompt injection |
| 4 | **No delimiter breakout.** Untrusted text is fenced in a tag with a random per-request id (`<resume_3f9c…>`), and tag-like sequences inside it are neutralised. The same applies to job descriptions sent for extraction. | `</resume>`-style escapes |
| 5 | **The model's output is untrusted too.** Its free text is scanned for hiring directives and instruction-like content (*AI output policy* flag). Every quote must be found in the resume, and unsupported judgements are downgraded. The score and recommendation are computed by the application. | A model that was swayed anyway |
| 6 | **Baseline divergence check.** For live AI, the deterministic rule-based score is computed for the same resume. A live score 30+ points above it is flagged. | Inflated scores, with a signal that doesn't depend on the model |

---

## Database and file storage

- **SQLite** lives at `backend/data/talentlens.db` (git-ignored) and is created automatically on startup (`create_all`, WAL mode, foreign keys on).
  - Columns added in later versions are applied automatically by small additive migrations at startup, so existing databases keep working.
  - Screenings created before accounts existed are assigned to the bootstrap administrator.
- **Tables**: `users`, `auth_tokens`, `screening_sessions`, `candidates`, `evaluations`, `recruiter_reviews`, `audit_events`.
- **Original files are not stored.** Uploads are parsed in memory; only the extracted text, hashes, page offsets and parse metadata are persisted. The parser writes no temporary files, and nothing uploaded is served back.
- **Deleting a screening** (with confirmation) removes its candidates, evaluations, decisions and events. To wipe everything, stop the backend and delete `backend/data/`.

---

## Testing

```bash
./scripts/verify.sh          # backend tests + coverage, frontend unit tests + coverage, type check, lint, audit, build
./scripts/verify.sh --e2e    # …plus the Playwright end-to-end tests
```

<details>
<summary><b>Run the suites individually</b></summary>

```bash
cd backend && .venv/bin/python -m pytest --cov     # 191 tests, line + branch coverage (fails under 90%)
cd frontend && npm test                             # 74 unit/component tests (Vitest); npm run test:coverage
cd frontend && npx tsc --noEmit && npm run lint && npm run build
cd frontend && npm run test:e2e                     # starts its own servers on :8100/:3100
```

The E2E run uses its own build directory (`.next-e2e`), its own throwaway database and its own admin account, so it works while `npm run dev` is running.

</details>

Results at time of writing (all run locally):

| Check | Result |
|---|---|
| **Backend pytest** | ✅ **191 passed**: scoring 17 · parsing 16 · evidence & analysis 18 · duplicates 9 · live provider (mocked) 13 · API & persistence 19 · API edge cases 9 · authentication 14 · access control 9 · HTTP security & rate limits 21 · prompt injection 22 (counted as test functions; some are parametrised) |
| **Backend coverage** | ✅ **95.4% lines, 86.4% branches** (`pytest --cov`, branch mode) |
| **Frontend unit/component (Vitest)** | ✅ **74 passed** (details below) |
| **TypeScript** (`tsc --noEmit`, strict) | ✅ passes |
| **ESLint** (Next.js + React Compiler rules) | ✅ 0 problems |
| **`npm audit`** | ✅ 0 vulnerabilities |
| **Playwright E2E (Chrome)** | ✅ **2 passed** (details below) |

**Vitest** covers the API client (auth header, sign-out on 401, errors, authenticated CSV download, uploads), the token store, safe redirects, the auth gate, the sign-in page, shortlist filters and sorting, job-setup validation, and formatting. Coverage of the tested modules is about 94% of lines and 95% of branches. Most UI components are covered by the E2E tests rather than unit tests.

**Playwright** runs two tests:
1. **Access control**: sign-in is required, a wrong password is rejected, a deep link is preserved through sign-in, and sign-out works.
2. **The full workflow**, with zero console errors: sign-in → criteria extraction → confirmation → mixed upload (including corrupt, scanned, unsupported and duplicate files) → shortlist → filters → sortable headers → quick decision → evidence → override with reason → navigate away and reopen → authenticated CSV export.

Tests never need an API key, and fixtures are generated synthetically inside the tests. Persistence across a **process restart** is covered by `test_results_and_decisions_survive_restart`, which runs two app instances on the same database.

---

## API documentation

Interactive docs are at **http://localhost:8000/docs** (development only). Errors use `{"error": {"code", "message", "details"}}`. Every endpoint except health and login needs `Authorization: Bearer <token>`.

```bash
# Get a token with the demo login, then call the API
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"admin@talentlens.local","password":"5zAFCJZhXDi4Suo1hp-n8K8b"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/sessions
```

<details>
<summary><b>All endpoints</b></summary>

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Service, database and provider status (public) |
| POST | `/api/auth/login` | Email + password → bearer token (public, rate limited) |
| POST | `/api/auth/logout` | Revoke the current token |
| GET | `/api/auth/me` | The signed-in account |
| POST | `/api/auth/password` | Change your password |
| GET / POST | `/api/users` | List or create accounts (admin) |
| PATCH | `/api/users/{id}` | Change role, active status, name or password (admin) |
| GET | `/api/config` | Scoring config, provider, limits, policies |
| GET | `/api/dashboard` | Metrics + recent sessions |
| POST | `/api/requirements/extract` | Propose criteria from a job description (not saved) |
| POST | `/api/sessions` | Create a session with confirmed criteria (+ optional weights) |
| GET | `/api/sessions` | List sessions |
| GET | `/api/sessions/{id}` | Session + candidates |
| PUT | `/api/sessions/{id}/requirements` | Update criteria (bumps the version; old evaluations are kept and marked stale) |
| DELETE | `/api/sessions/{id}` | Delete a session and its data |
| POST | `/api/sessions/{id}/resumes` | Upload 1–25 files (multipart `files`), with per-file results |
| POST | `/api/sessions/{id}/evaluate` | Queue evaluation (`scope`: pending/failed/stale/all, or `candidate_ids`) → 202 |
| GET | `/api/sessions/{id}/export.csv?filter=all\|ranked\|advanced` | CSV export |
| GET | `/api/sessions/{id}/events` | Activity log |
| GET | `/api/candidates/{id}` | Full assessment, evidence, text, history |
| POST | `/api/candidates/{id}/evaluate` | Retry or re-run one candidate → 202 |
| POST | `/api/candidates/{id}/decisions` | Record a decision |
| GET | `/api/candidates/{id}/decisions` | Decision history |
| PUT | `/api/candidates/{id}/duplicate-resolution` | Confirm, dismiss or reset a duplicate |

</details>

---

## Accessibility

- **Structure and controls**: semantic landmarks and heading order, labelled form controls, visible focus rings and a skip link.
- **Keyboard**: Radix primitives for dialogs, menus, tabs and tooltips (focus trapping, Escape, keyboard navigation), and the candidate panel focuses itself on open.
- **Not colour alone**: statuses always combine an icon with text, and charts carry text labels.
- **Feedback and motion**: disabled actions explain why in a tooltip, and reduced-motion is honoured.

No formal audit, such as screen-reader testing with assistive technology, has been performed.

## Implemented features

All P0 items and the P1 items listed under [Features](#features), including:

- job setup with extraction and confirmation;
- PDF/DOCX parsing with edge cases, and isolated batch upload;
- three-level duplicate detection;
- deterministic scoring with a missing-evidence policy, and evidence verification;
- a ranked shortlist with search, filter and sort, and the evidence drawer;
- recruiter overrides with reasons, and the audit trail;
- screening history, persistence across restarts and CSV export;
- demo mode and the optional live Anthropic provider;
- accounts with role-based and per-recruiter access control, rate limiting and HTTP hardening;
- prompt-injection defences;
- synthetic samples, scripts, backend and frontend unit tests, and browser E2E tests.

## Missing features

- OCR for scanned PDFs.
- A user-management screen: accounts are managed through the admin API (`/api/users`) or the bootstrap variables.
- Single sign-on, multi-factor authentication and password reset by email.
- Encryption at rest (use an encrypted disk or a managed database).
- Retaining or viewing the original uploaded files (only extracted text is kept).
- A full migration framework (only additive column migrations run at startup).
- Multi-process or distributed evaluation (a single in-process worker, by design).
- Global (not per-screening) settings editing in the UI. The Methodology page is read-only; provider and limits are environment variables.
- Bulk decisions (decisions are recorded one candidate at a time, from the row menu or the evidence panel).
- An optional free-text “hiring context” field during job setup (the backend has no field for it).

## Known bugs

None known at the time of writing that break the core workflow. Known rough edges:

- Duplicate-detection serialisation and rate limiting are in-process. Running the backend with multiple worker processes could reintroduce the concurrent-upload race and would give each process its own limits; a shared store such as Redis would be needed.
- Name detection is heuristic, so some resumes show the filename instead of a name.

## Limitations and assumptions

- The demo evaluator is keyword, section and date based. It can miss skills phrased differently, can't judge quality or transferable experience, and only recognises common English section headings.
- Experience is measured only from parseable date ranges in the experience section. Year-only ranges are counted conservatively (Jan→Jan).
- Requirement extraction in demo mode only recognises skills in its built-in vocabulary.
- Thresholds, weights and the near-duplicate threshold are untested product defaults.
- Live mode is implemented and unit-tested with mocks, but not exercised against the real API here.
- The app is multi-user with per-recruiter isolation, but designed for a single backend process.
- Hidden-text detection assumes text is read on the page as rendered. Text behind a photo, and styles inherited from DOCX style definitions, are not analysed.
- Instruction-line redaction is pattern-based. It reduces risk but can't catch every phrasing, which is why the output checks exist.

## Privacy and responsible use

- TalentLens assesses only job-related criteria. Prompts and heuristics never use age, gender, ethnicity, religion, disability, sexual orientation, marital status, appearance or names. The prestige of schools or employers is not a signal, and gaps and career changes are not penalised.
- Potential issues are phrased as *“potential inconsistency requiring verification”*, never as accusations.
- Resume content is treated as untrusted data; embedded instructions are ignored and flagged.
- API keys come from environment variables only and are never logged or returned. `.env` files are git-ignored, and raw resume text is not logged.
- Data stays local: demo mode makes no external calls. In live mode, resume text and criteria are sent to the Anthropic API.
- No claims of bias auditing, legal compliance, security certification or encryption at rest are made. Authentication, per-recruiter access control and rate limiting are implemented (see [Security and access control](#security-and-access-control)), but the application has not had an external security review.
- Human review remains central: the tool recommends, and people decide.
- Use synthetic data for demonstrations.

## Troubleshooting

| Problem | Fix |
|---|---|
| Sign-in says the email or password is incorrect | Use the [demo login](#quick-start), or the `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `backend/.env`. If those are empty, re-run `./scripts/setup.sh`. The bootstrap account is created once; changing the variables later doesn't change its password. |
| “Too many sign-in attempts” | The account is locked for up to 15 minutes after 5 failed attempts. Wait, or restart the backend in local development (limits are held in memory). |
| `Address already in use` from `dev.sh` | An earlier `dev.sh` is still running. Press Ctrl+C in its terminal, or find it with `lsof -ti tcp:8000 -sTCP:LISTEN` / `lsof -ti tcp:3000 -sTCP:LISTEN` and stop it. |
| “The backend isn't reachable” | Start it with `./scripts/dev.sh`, or `cd backend && .venv/bin/uvicorn app.main:app --port 8000`. Check `http://localhost:8000/api/health`. |
| CORS errors in the browser console | The frontend origin must be in `CORS_ORIGINS` (the default covers `localhost:3000` and `127.0.0.1:3000`). |
| Frontend calls the wrong API | Set `NEXT_PUBLIC_API_BASE_URL` in `frontend/.env.local` and restart `npm run dev`. |
| Need different ports | `BACKEND_PORT=8001 FRONTEND_PORT=3001 ./scripts/dev.sh` (also add the new origin to `CORS_ORIGINS`). |
| Sidebar says Demo mode with a warning after setting `AI_PROVIDER=anthropic` | `ANTHROPIC_API_KEY` is missing or empty in `backend/.env`; set it and restart the backend. |
| Live evaluations fail with `auth_failed` / `model_not_found` | Check the key, and that `ANTHROPIC_MODEL` is available to it. |
| Schema errors after pulling changes | New columns are added automatically at startup. If errors persist, stop the backend and delete `backend/data/talentlens.db`. |
| `npm install` warns about install scripts | This is npm 11's policy for `unrs-resolver` (an ESLint resolver) and `fsevents` (an optional macOS file watcher). Neither is needed. |
| E2E can't find Chrome | Run `npx playwright install chromium`, then `PLAYWRIGHT_CHANNEL= npm run test:e2e`. |

---

## Demo recording plan (3–5 minutes)

<details>
<summary><b>Show the plan</b></summary>

1. **(0:00) Sign in & overview.** Sign in with the demo login, showing a wrong password being rejected. Then cover the product promise, the *DEMO MODE* label and the empty-state metrics. Mention: decision support, not decision maker.
2. **(0:30) New screening.**
   - *Use sample job* → *Extract criteria*, and point out the “Extracted · review” badges and extraction notes.
   - Remove one preferred skill, and open *Customize* weights.
   - Try to submit without confirming (validation), then confirm.
3. **(1:15) Upload.**
   - Drag in all of `samples/resumes/` plus `corrupted-resume.pdf`, `scanned-image-only.pdf`, `password-protected.pdf` and `notes.txt`.
   - Show the client-side rejection and per-file progress.
   - Show the server results: damaged, needs OCR, password-protected, duplicate of Amara, possible duplicate of Daniel.
4. **(2:00) Shortlist.** The score distribution against the thresholds; ranked vs. *Not ranked* with reasons; filter by *Needs review*; sort by experience.
5. **(2:30) Candidate drawer.**
   - **Amara**: the breakdown arithmetic, verified quotes → *Show in resume*, skills demonstrated vs. listed, and the experience timeline.
   - **Riley**: embedded instructions flagged, withheld from the AI and ignored.
   - **Sam**: experience excluded, 75% evidence completeness.
6. **(3:30) Override.** Decision & audit → *Hold* on Amara → override warning → reason required → record. Show the audit trail, including who recorded the decision, and that the AI assessment is unchanged.
7. **(4:00) Persistence & export.** Go to History and reopen the screening (the decision is still there), then export the CSV. Optionally restart `./scripts/dev.sh` and reopen.
8. **(4:30) Methodology.** Weights, missing-evidence policy, duplicate method and limitations. Close with the `./scripts/verify.sh` output.

</details>

---

<div align="center">

<sub>Built as decision support: the tool recommends, people decide.<br/>Licensed under the <a href="LICENSE">MIT License</a>.</sub>

</div>
