# TalentLens — AI Recruitment Intelligence

> **See the evidence. Find the right fit.**

TalentLens turns a job description and a batch of resumes into an explainable, evidence-backed shortlist. Recruiters confirm job-related criteria, upload PDF/DOCX resumes, and review a ranked list where every score can be traced to weighted criteria and to quotes that have been verified against the resume text. Recruiter decisions are recorded separately, with a reason for every override, and never modify the original assessment.

**TalentLens is a decision-support tool. It does not make hiring decisions.**

It runs fully in **demo mode** without any API key (a transparent, rule-based evaluator — clearly labelled, never presented as AI), and optionally in **live AI mode** using the Anthropic API.

---

## Contents

1. [Quick start](#quick-start)
2. [Features](#features)
3. [Screenshots](#screenshots)
4. [Architecture](#architecture)
5. [Technology stack](#technology-stack)
6. [Prerequisites](#prerequisites)
7. [Installation](#installation)
8. [Environment configuration](#environment-configuration)
9. [Starting the application](#starting-the-application)
10. [Demo mode](#demo-mode)
11. [Live AI mode](#live-ai-mode)
12. [Supported files and size limits](#supported-files-and-size-limits)
13. [Scoring: formula, weights, thresholds](#scoring-formula-weights-thresholds)
14. [Missing-evidence policy](#missing-evidence-policy)
15. [Evidence verification](#evidence-verification)
16. [Duplicate detection](#duplicate-detection)
17. [Failure handling](#failure-handling)
18. [Recruiter overrides and audit history](#recruiter-overrides-and-audit-history)
19. [Database and file storage](#database-and-file-storage)
20. [Testing](#testing)
21. [API documentation](#api-documentation)
22. [Implemented features](#implemented-features)
23. [Missing features](#missing-features)
24. [Known bugs](#known-bugs)
25. [Limitations and assumptions](#limitations-and-assumptions)
26. [Privacy and responsible use](#privacy-and-responsible-use)
27. [Troubleshooting](#troubleshooting)
28. [Demo recording plan (3–5 minutes)](#demo-recording-plan-35-minutes)

---

## Quick start

```bash
./scripts/setup.sh   # Python venv + backend deps, npm install, copies .env examples
./scripts/dev.sh     # backend on :8000, frontend on :3000 (Ctrl+C stops both)
```

Open **http://localhost:3000**. Click **New screening → Use sample job → Extract criteria**, confirm, then drag in the files from `samples/resumes/` (and, to see failure handling, `samples/edge-cases/`).

---

## Features

- **Job setup** — enter criteria manually or extract them from a pasted job description. Extracted fields are marked *“Extracted · review”* until edited, and nothing is scored until the recruiter ticks an explicit confirmation. Per-screening scoring weights (must total 100%).
- **Batch upload** — drag-and-drop or file picker, multiple files, client-side type/size checks, real per-file upload progress (then an indeterminate state while the server extracts text — no invented percentages), live per-file status through *Ready → Uploading → Extracting text → Extracted → Evaluating → Complete* (or *Duplicate detected / Needs review / Failed*), a four-stage batch summary built from real counts, retry for failed uploads, removal before upload, bounded parallel uploads (3).
- **Robust parsing** — PDF (PyMuPDF) and DOCX (python-docx, including tables), detected by *content* not extension; corrupt, empty, password-protected, scanned/image-only, legacy `.doc`, unsupported and oversized files each get a specific, readable status. One bad file never affects the others.
- **Three-level duplicate detection** — identical file hash, identical normalised-text hash (same resume as PDF and DOCX), and near-duplicate similarity. Reviewable and reversible; nothing is merged.
- **Deterministic, explainable scoring** — four weighted criteria, an explicit missing-evidence policy, evidence-completeness indicator, recommendation bands. The overall score is always computed by application code, never by a model.
- **Verified evidence** — every quote shown as evidence is located in the extracted text; unverifiable quotes are shown struck-through as *rejected* and can't support a score. “Show in resume” highlights the passage in the full text (with page number for PDFs).
- **Ranked shortlist** — search; a Filters menu (recommendation, review status, processing status, duplicates) plus a one-click *Needs review* toggle; removable active-filter chips with a result count; sortable column headers that show the active field and direction (score, candidate name, relevant experience) and a sort menu; compact score meters with threshold ticks; a *key evidence* column (required skills shown in described work, plus how many were not found); evidence completeness; AI recommendation and recruiter review in separate columns; a per-row *Review* action and a ⋯ menu (record a decision in a dialog, retry a failed evaluation, mark *not a duplicate*); a score-distribution chart. Unreadable files, failed evaluations, duplicates and insufficient evidence are listed separately as **Not ranked** with the reason — never as zero scores.
- **Candidate evidence panel** — two clearly separated layers (*Original assessment* · read-only, and *Recruiter decision*); the score arithmetic; evidence grouped by criterion with job skill terms underlined inside verified quotes; required/preferred skills; a *Missing or ambiguous evidence* section in neutral language; potential concerns requiring verification; experience timeline; qualification checks; duplicate review; full resume text with highlights; prev/next navigation.
- **Recruiter decisions** — Advance / Hold / Reject / Needs review; reason required for overrides, rejections and decisions without an AI assessment. Append-only audit trail.
- **Re-evaluation** — retry failed evaluations; edit criteria later (existing evaluations are kept and marked stale, then can be re-evaluated, preserving history).
- **Screening history**, **CSV export** (all / ranked / advanced; formula-injection safe), **Overview dashboard** with metrics computed from persisted data, **Methodology page** showing the live configuration.
- **Light and calm dark themes** — Light / Dark / System switch in the sidebar (and in the command menu), remembered per browser, applied before first paint so there is no flash.
- **Command menu (⌘K / Ctrl+K)** — jump to any page, saved screening, or candidate in the current screening; full keyboard navigation.
- **Clear mode labelling** — a persistent *DEMO MODE* / *LIVE AI MODE* card in the sidebar and on the methodology page.

---

## Design system

The interface uses a small token-based system defined in `frontend/app/globals.css` (colours, radii, shadows, motion durations/easing, z-index layers, container width) plus typography utilities (`type-display`, `type-title`, `type-section`, `type-eyebrow`, `type-body`, `type-meta`, `type-metric`, `type-name`). Colours needed in JavaScript (charts, SVG) live in `frontend/lib/tokens.ts`. The default palette is warm and light (with a calm slate-navy dark theme defined by the same tokens), with indigo as the single product accent, teal for positive evidence, amber for review states and red only for genuine failures. Geist is used for interface text and Instrument Serif for page titles and the headline score; both load through `next/font` with system fallbacks.

Reusable components live in `frontend/components/ui` (button with `disabledReason` tooltips, inputs, checkbox, search field, select, segmented control, tabs, collapsible, tooltip, dialog, drawer, dropdown with radio items, progress, skeleton) and `frontend/components/shared` (score meter, breakdown bar, completeness meter, avatar, animated metric, status badges, empty/error states).

Motion is short and functional (≈120–240 ms, ease-out): drawer and dialog entrances, collapsible sections, short list staggers on first render, number tweens when real data changes, an indeterminate bar for server processing. `prefers-reduced-motion` disables animations and staggers.

## Screenshots

Screenshots are not committed. To capture your own:

1. Start the app (`./scripts/dev.sh`) and run through the [demo recording plan](#demo-recording-plan-35-minutes).
2. Capture: Overview, New screening (criteria review), Upload (mixed batch), Shortlist, Candidate drawer (Assessment and Decision & audit tabs), Methodology.
3. Save them to `docs/screenshots/` and reference them here, e.g. `![Shortlist](docs/screenshots/shortlist.png)`.

---

## Architecture

```
┌──────────────────────────────┐        JSON / multipart        ┌──────────────────────────────────────────────┐
│  Next.js 16 (App Router, TS) │  ───────────────────────────▶  │  FastAPI                                      │
│  localhost:3000              │  ◀───────────────────────────  │  localhost:8000                               │
│                              │     polling for progress       │                                              │
│  app/        routes          │                                │  api/          thin routers, error mapping   │
│  features/   screen modules  │                                │  services/     business logic                 │
│  components/ UI primitives   │                                │    resume_parser  → file validation/extract   │
│  lib/api.ts  typed client    │                                │    duplicates     → hash + shingle Jaccard    │
└──────────────────────────────┘                                │    resume_analysis→ sections, dates, names    │
                                                                │    providers/     → demo | anthropic          │
                                                                │    evidence       → quote verification        │
                                                                │    scoring        → deterministic engine      │
                                                                │    evaluation     → pipeline + bg worker      │
                                                                │  repositories/ queries                       │
                                                                │  models/       SQLAlchemy (SQLite)           │
                                                                └──────────────────────────────────────────────┘
```

**Evaluation pipeline** (same for both providers):

`extracted text → structural analysis (dates, sections) → provider assessment (structured, Pydantic-validated) → evidence verification against the text → deterministic scoring → review flags → persisted (append-only)`

- Evaluations run on a single background worker thread; statuses (`queued → running → completed/failed`) are persisted and the UI polls while work is in progress.
- On startup, any evaluation left `queued`/`running` by a crash is marked *failed: interrupted* so it can be retried.
- Uploads are parsed concurrently, but duplicate detection + insert is serialised per session.

---

## Technology stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16.4 (App Router), React 19, TypeScript (strict), Tailwind CSS 4, Radix UI primitives (shadcn-style components written in-repo), Lucide icons, Recharts, React Hook Form + Zod, Sonner toasts |
| Backend | Python 3.13, FastAPI, Pydantic 2, SQLAlchemy 2, SQLite, PyMuPDF, python-docx |
| AI (optional) | Anthropic Python SDK 2.x (`claude-opus-5-5` by default), structured outputs |
| Testing | pytest + FastAPI TestClient (httpx), Playwright (Chrome) |

---

## Prerequisites

- **Python 3.11+** (developed on 3.13). `uv` is used automatically if installed, otherwise `venv` + `pip`.
- **Node.js 20+** and npm (developed on Node 24 / npm 11).
- For the E2E test: Google Chrome installed, or run `npx playwright install chromium` and set `PLAYWRIGHT_CHANNEL=""`.

No API key is needed for demo mode.

---

## Installation

```bash
./scripts/setup.sh
```

Or manually:

```bash
# Backend
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env

# Frontend
cd ../frontend
npm install
cp .env.example .env.local
```

---

## Environment configuration

`backend/.env` (see `backend/.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `AI_PROVIDER` | `demo` | `demo` or `anthropic` |
| `ANTHROPIC_API_KEY` | — | Required only for live mode. Never committed or logged. |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model for live extraction/evaluation |
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
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Allowed frontend origins |

`frontend/.env.local`: `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:8000`).

A root `.env.example` summarises both.

---

## Starting the application

One command (starts both, waits for the backend health check, Ctrl+C stops both):

```bash
./scripts/dev.sh
```

Two terminals, if you prefer:

```bash
# Terminal 1 — backend
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

- App: **http://localhost:3000**
- API docs (Swagger): **http://localhost:8000/docs**, ReDoc: **/redoc**
- Health: **http://localhost:8000/api/health**

Production-style frontend: `cd frontend && npm run build && npm start`.

---

## Demo mode

Demo mode (the default) is a complete, real workflow — it is **not** an AI model and is labelled as such everywhere (sidebar card, assessment header “Rule-based assessment”, methodology page, CSV `provider` column).

It uses the real uploaded files: real parsing, real hashing and duplicate detection, real persistence. The rule-based evaluator then:

- marks a skill **demonstrated** when it appears in an experience/project line, **partial** when it only appears in a skills/summary list, **not found** otherwise (synonyms like PostgreSQL⇄Postgres; specific tools count toward general skills, e.g. GitHub Actions → CI/CD, never the reverse);
- computes **relevant experience** from parsed date ranges (overlaps counted once; a role is relevant if its title names a focus area/required skill, or its description mentions at least two distinct ones);
- scores **projects/demonstrated work** from lines that combine an action verb with a job-relevant skill (+0.5 when the outcome is quantified; 5 points = full marks);
- surfaces **qualification checks**, **embedded instructions**, **date inconsistencies** and **very short text** for human review.

Every quote it cites is a verbatim excerpt, and still goes through the same evidence verification and scoring engine as live mode. Requirement extraction in demo mode uses headings (*Requirements* / *Nice to have*), a built-in vocabulary of 83 technical skills, and year patterns, and always reports its uncertainty.

### Synthetic sample data

`samples/` contains invented people and a fictional job description (see `samples/README.md`). Regenerate with `backend/.venv/bin/python samples/generate_samples.py`. With the sample job’s extracted criteria, demo mode currently produces (rounded): Amara Okafor 97 (strong), Daniel Reyes 76 (potential; plus a flagged near-duplicate copy), Mei Lin Chen 72 (potential — career changer; analyst years correctly not counted as backend experience), Sam Patel 56 (freelancer, no dates → experience excluded, 75% evidence completeness), Riley Morgan 49 (embedded instructions flagged and ignored), Jonas Weber ~10 (frontend profile; impossible date range flagged).

---

## Live AI mode

> A Claude.ai subscription does **not** provide API credentials for a separately running application. Live mode needs an Anthropic API key and is billed per use through the Anthropic API.

```bash
# backend/.env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

Restart the backend; the sidebar switches to **LIVE AI MODE** with the model name. If `AI_PROVIDER=anthropic` but no key is set, the app stays in demo mode and shows a warning.

How the live provider behaves:

- Requests JSON with `output_config.format` (strict JSON schema derived from the Pydantic models), then **independently validates** the response with Pydantic — malformed JSON, missing fields, invalid enum values and out-of-range numbers are rejected.
- Resume text is wrapped in `<resume>` tags as untrusted data; the system prompt tells the model to ignore embedded instructions, report them as a concern, assess only job-related evidence, avoid protected characteristics and prestige proxies, and never compute the overall score.
- Employment durations come from the application’s own date parser, not the model.
- Bounded retries for timeouts, connection errors, 429 (honouring `retry-after`), 5xx and invalid output; immediate failure for auth/permission/model/bad-request errors; `refusal` and truncated responses handled explicitly. SDK-level retries are disabled so behaviour is explicit and tested.
- Any failure becomes **“Unable to evaluate”** with the reason — never a low score — and can be retried. Saved results load without any API call.

⚠️ **Live mode has not been exercised against the real Anthropic API in this build** (no key was available). It is covered by 13 tests that mock the client (success, invalid JSON, missing fields, invalid values, timeouts, rate limits with `retry-after`, retry exhaustion, connection failure, 5xx, auth errors, refusal, truncation, fallback toggle).

---

## Supported files and size limits

| | |
|---|---|
| Formats | **PDF** and **DOCX**, detected from file content (magic bytes / OOXML structure). A valid PDF named `.docx` is processed as PDF with a warning. |
| Size | **10 MB per file** (`MAX_UPLOAD_MB`), 25 files per request, first 30 PDF pages read |
| Rejected with a clear status | empty files, corrupt PDF/DOCX, password-protected PDFs, legacy `.doc`, other formats, oversized files, DOCX archives that expand beyond 60 MB |
| Scanned PDFs | **OCR is not supported.** Image-only PDFs are marked *Needs OCR / manual review* and are not scored. |

---

## Scoring: formula, weights, thresholds

```
overall = Σ (criterion score × normalised weight)   over assessable criteria
        = 0.40 × Required skills + 0.25 × Relevant experience
        + 0.20 × Relevant projects + 0.15 × Preferred qualifications   (when all are assessable)
```

| Criterion | Default weight |
|---|---:|
| Required skills | 40% |
| Relevant experience | 25% |
| Relevant projects and demonstrated work | 20% |
| Preferred qualifications | 15% |

- Weights are **configurable per screening** (must total exactly 100%, each 0–100, finite). They are product defaults, not universal hiring standards — different roles warrant different weights.
- Each criterion score is 0–100; NaN, infinity, out-of-range values, duplicate/missing criteria and invalid weights are rejected.
- The overall score is rounded half-up to one decimal, and the recommendation band is computed from that same rounded value (so “80.0” is never shown as “Potential”).
- Scoring version: `tl-score-2026.10-v1`, stored with every evaluation.

| Recommendation | Rule (defaults) |
|---|---|
| Strong match | 80 – 100 |
| Potential match | 65 – 79.9 |
| Lower evidence-based match | below 65 |
| Insufficient evidence | < 60% of criteria weight assessable, or < 300 characters of resume text |

A score never rejects anyone automatically. *Insufficient evidence* candidates are shown for human review and not ranked.

Required **qualifications** (e.g. degrees) and **additional criteria** are surfaced as verification checks with evidence; they do not change the score, but a required qualification not established by the resume raises a review flag.

---

## Missing-evidence policy

- Each criterion is **demonstrated**, **partially demonstrated**, **not found in the resume**, **ambiguous**, or **not assessable**.
- *Not found* means “not established by the resume” — it is scored (low) from the available evidence, and the UI never says the candidate *lacks* the skill.
- *Ambiguous* / *not assessable* criteria are **excluded** and the remaining weights renormalised. **Evidence completeness** = assessed weight ÷ applicable weight, shown on every candidate.
- Below 60% completeness the recommendation becomes *Insufficient evidence*.
- Criteria the *job* doesn’t use (e.g. no preferred skills) are not applicable and don’t reduce completeness.
- Employment gaps, career changes and nontraditional education are never flagged as negatives.

---

## Evidence verification

`backend/app/services/evidence.py`

- Each quote labelled `exact_quote` is searched for in the extracted text (case-, whitespace- and typographic-punctuation-insensitive; `…` splits a quote into fragments that must appear in order). Matches record character offsets and, for PDFs, the page number derived from recorded page offsets.
- The quote displayed is the resume’s own text at those offsets, not the provider’s copy.
- Unmatched quotes are kept for audit as **rejected** (struck through, red) and never count as evidence. Paraphrases are labelled as such and are not “verified”.
- If a criterion’s positive status rests only on unverifiable quotes, it is downgraded to *ambiguous* (excluded from scoring) and flagged for review.
- Lines that look like instructions to an AI system are detected, excluded from evidence, and reported as a concern.

---

## Duplicate detection

| Level | Method |
|---|---|
| Exact file | SHA-256 of the uploaded bytes |
| Exact text | SHA-256 of extracted text after Unicode NFKC, case-folding, punctuation/bullet removal and whitespace collapsing — catches the same resume uploaded as PDF and DOCX |
| Near duplicate | Jaccard similarity of word 3-shingles ≥ `NEAR_DUPLICATE_THRESHOLD` (0.80) |

- The threshold is an **initial hypothesis**: on the samples, an edited copy (new email/phone, one bullet reworded) scored 0.86 and unrelated resumes ~0.04. Short resumes are more sensitive to small edits, which is why 0.80 rather than 0.90 was chosen. It has not been validated on real data.
- The later upload points to the earlier one. Exact duplicates are excluded from ranking and not evaluated (saving cost); near duplicates are evaluated and flagged.
- Recruiters can **confirm**, mark **not a duplicate**, or **reset** — all reversible, logged, and nothing is merged or deleted. Unique-candidate metrics exclude confirmed/exact duplicates.

---

## Failure handling

| Situation | What the user sees |
|---|---|
| Backend down | “The backend isn't reachable” with start commands and Retry; sidebar shows *API unreachable* |
| Corrupt / empty / encrypted / unsupported / oversized file | Per-file status with a plain-language reason; other files continue |
| Scanned PDF | *Needs OCR / manual review*; not scored |
| Upload network error | Per-file error with **Retry** |
| Provider timeout / rate limit / invalid output / outage | *Unable to evaluate* + reason, **Retry**; never a score; other candidates unaffected |
| Server restarted mid-evaluation | Marked *failed: interrupted*, retryable |
| Validation errors | Field-level messages (frontend) and structured `422 {"error": {code, message, details}}` (API) |
| Database errors | `503 persistence_error` without internals; stack traces only in server logs |

---

## Recruiter overrides and audit history

- Decisions are **append-only** rows (`recruiter_reviews`), each storing the decision, reason, notes, timestamp, and a snapshot of the AI recommendation/score and evaluation ID it was made against.
- **Override** = a decision outside the set consistent with the AI band (strong → advance; potential → advance/hold; lower → hold/reject; insufficient → needs review). Overrides, rejections, and decisions on unassessed resumes **require a reason** (enforced by the API, not just the UI).
- Evaluations are also append-only: retries and re-evaluations add attempts; history is shown in the drawer’s audit trail.
- A session-level activity log records uploads, evaluation runs, criteria changes, duplicate reviews and decisions.

---

## Database and file storage

- SQLite at `backend/data/talentlens.db` (git-ignored), created automatically on startup (`create_all`, WAL mode, foreign keys on). There are no migrations: if the schema changes, delete the database file.
- Tables: `screening_sessions`, `candidates`, `evaluations`, `recruiter_reviews`, `audit_events`.
- **Original files are not stored.** Uploads are parsed in memory; the extracted text, hashes, page offsets and parse metadata are persisted. No temporary files are written by the parser, and nothing uploaded is served back.
- **Deleting a screening** (with confirmation) removes its candidates, evaluations, decisions and events. To wipe everything, stop the backend and delete `backend/data/`.

---

## Testing

```bash
./scripts/verify.sh          # backend tests, type check, lint, production build
./scripts/verify.sh --e2e    # …plus the Playwright end-to-end test
```

Individually:

```bash
cd backend && .venv/bin/python -m pytest          # 109 tests
cd frontend && npx tsc --noEmit && npm run lint && npm run build
cd frontend && npm run test:e2e                    # starts its own servers on :8100/:3100
```

Results at time of writing (all run locally):

| Check | Result |
|---|---|
| Backend pytest | **109 passed** (scoring 17 · parsing 16 · evidence & analysis 18 · duplicates 9 · live provider (mocked) 13 · API & persistence 19 test functions; some parametrised) |
| TypeScript (`tsc --noEmit`, strict) | passes |
| ESLint (Next.js + React Compiler rules) | 0 problems |
| `next build` | succeeds |
| Playwright E2E (Chrome) | **1 passed** — criteria extraction → confirmation → mixed upload (incl. corrupt, scanned, unsupported, duplicates) → shortlist → filter menu + chip + clear → sortable headers in both directions → quick decision from the row menu → evidence → override with reason → navigate away and reopen → CSV export, with zero console errors |

Tests never need an API key. Fixtures are generated synthetically inside the tests. Persistence across a **process restart** is covered by `test_results_and_decisions_survive_restart` (two app instances on the same database).

---

## API documentation

Interactive docs at **http://localhost:8000/docs**. Errors use `{"error": {"code", "message", "details"}}`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Service, database and provider status |
| GET | `/api/config` | Scoring config, provider, limits, policies |
| GET | `/api/dashboard` | Metrics + recent sessions |
| POST | `/api/requirements/extract` | Propose criteria from a job description (not saved) |
| POST | `/api/sessions` | Create a session with confirmed criteria (+ optional weights) |
| GET | `/api/sessions` | List sessions |
| GET | `/api/sessions/{id}` | Session + candidates |
| PUT | `/api/sessions/{id}/requirements` | Update criteria (bumps version; old evaluations kept, marked stale) |
| DELETE | `/api/sessions/{id}` | Delete a session and its data |
| POST | `/api/sessions/{id}/resumes` | Upload 1–25 files (multipart `files`), per-file results |
| POST | `/api/sessions/{id}/evaluate` | Queue evaluation (`scope`: pending/failed/stale/all, or `candidate_ids`) → 202 |
| GET | `/api/sessions/{id}/export.csv?filter=all\|ranked\|advanced` | CSV export |
| GET | `/api/sessions/{id}/events` | Activity log |
| GET | `/api/candidates/{id}` | Full assessment, evidence, text, history |
| POST | `/api/candidates/{id}/evaluate` | Retry / re-run one candidate → 202 |
| POST | `/api/candidates/{id}/decisions` | Record a decision |
| GET | `/api/candidates/{id}/decisions` | Decision history |
| PUT | `/api/candidates/{id}/duplicate-resolution` | Confirm / dismiss / reset a duplicate |

---

## Accessibility

Semantic landmarks and heading order, labelled form controls, visible focus rings, a skip link, Radix primitives for dialogs/menus/tabs/tooltips (focus trapping, Escape, keyboard navigation), the candidate panel focuses itself on open, statuses always combine icon + text (never colour alone), disabled actions explain why in a tooltip, charts carry text labels, and reduced-motion is honoured. No formal audit (e.g. screen-reader testing with assistive technology) has been performed.

## Implemented features

All P0 items and the P1 items listed under [Features](#features): job setup with extraction and confirmation, PDF/DOCX parsing with edge cases, isolated batch upload, three-level duplicate detection, deterministic scoring with missing-evidence policy, evidence verification, ranked shortlist with search/filter/sort, evidence drawer, recruiter overrides with reasons, audit trail, screening history, persistence across restarts, CSV export, demo mode, optional live Anthropic provider, synthetic samples, scripts, backend tests and a browser E2E test.

## Missing features

- OCR for scanned PDFs.
- Authentication, user accounts, multi-user attribution of decisions, and encryption at rest.
- Retaining/viewing the original uploaded files (only extracted text is kept).
- Database migrations (schema is created with `create_all`).
- Multi-process/distributed evaluation (single in-process worker by design).
- Global (non per-screening) settings editing in the UI — the Methodology page is read-only; provider/limits are environment variables.
- Dark mode.
- Bulk decisions (decisions are recorded one candidate at a time, from the row menu or the evidence panel).
- An optional free-text “hiring context” field during job setup (the backend has no field for it).

## Known bugs

None known at the time of writing that break the core workflow. Known rough edges:

- Duplicate-detection serialisation uses an in-process lock; running the backend with multiple worker processes could reintroduce the concurrent-upload race.
- Name detection is heuristic; some resumes show the filename instead of a name.

## Limitations and assumptions

- The demo evaluator is keyword/section/date based: it can miss skills phrased differently, can't judge quality or transferable experience, and only recognises common English section headings.
- Experience is measured only from parseable date ranges in the experience section; year-only ranges are counted conservatively (Jan→Jan).
- Requirement extraction in demo mode only recognises skills in its built-in vocabulary.
- Thresholds, weights and the near-duplicate threshold are untested product defaults.
- Live mode is implemented and unit-tested with mocks but not exercised against the real API here.
- Designed for local, single-user use.

## Privacy and responsible use

- Assesses only job-related criteria. Prompts and heuristics never use age, gender, ethnicity, religion, disability, sexual orientation, marital status, appearance or names; prestige of schools/employers is not a signal; gaps and career changes are not penalised.
- Potential issues are phrased as *“potential inconsistency requiring verification”*, never as accusations.
- Resume content is treated as untrusted data; embedded instructions are ignored and flagged.
- API keys come from environment variables only, are never logged or returned; `.env` files are git-ignored. Raw resume text is not logged.
- Data stays local (demo mode makes no external calls). In live mode, resume text and criteria are sent to the Anthropic API.
- No claims of bias auditing, legal compliance, security certification, authentication or encryption are made — none are implemented. Human review remains central: the tool recommends, people decide.
- Use synthetic data for demonstrations.

## Troubleshooting

| Problem | Fix |
|---|---|
| “The backend isn't reachable” | Start it: `./scripts/dev.sh` or `cd backend && .venv/bin/uvicorn app.main:app --port 8000`. Check `http://localhost:8000/api/health`. |
| CORS errors in the browser console | Frontend origin must be in `CORS_ORIGINS` (default covers `localhost:3000` and `127.0.0.1:3000`). |
| Frontend calls the wrong API | Set `NEXT_PUBLIC_API_BASE_URL` in `frontend/.env.local` and restart `npm run dev`. |
| Port already in use | `BACKEND_PORT=8001 FRONTEND_PORT=3001 ./scripts/dev.sh` (also add the new origin to `CORS_ORIGINS`). |
| Sidebar says Demo mode with a warning after setting `AI_PROVIDER=anthropic` | `ANTHROPIC_API_KEY` is missing or empty in `backend/.env`; restart the backend. |
| Live evaluations fail with `auth_failed` / `model_not_found` | Check the key and that `ANTHROPIC_MODEL` is available to it. |
| Schema errors after pulling changes | Stop the backend and delete `backend/data/talentlens.db`. |
| `npm install` warns about install scripts | npm 11 policy for `unrs-resolver` (an ESLint resolver); it is declined in `package.json` and not needed. |
| E2E can't find Chrome | `npx playwright install chromium` then `PLAYWRIGHT_CHANNEL= npm run test:e2e`. |

---

## Demo recording plan (3–5 minutes)

1. **(0:00) Overview** — product promise, *DEMO MODE* label, empty-state metrics. Mention: decision support, not decision maker.
2. **(0:30) New screening** — *Use sample job* → *Extract criteria*; point out “Extracted · review” badges and extraction notes; remove one preferred skill; open *Customize* weights; try to submit without confirming (validation); confirm.
3. **(1:15) Upload** — drag in all of `samples/resumes/` plus `corrupted-resume.pdf`, `scanned-image-only.pdf`, `password-protected.pdf`, `notes.txt`. Show the client-side rejection, per-file progress, server results (damaged, needs OCR, password-protected, duplicate of Amara, possible duplicate of Daniel).
4. **(2:00) Shortlist** — score distribution against thresholds; ranked vs. *Not ranked* with reasons; filter *Needs review*; sort by experience.
5. **(2:30) Candidate drawer (Amara)** — breakdown arithmetic; verified quotes → *Show in resume*; skills demonstrated vs. listed; experience timeline. Then **Riley**: embedded instructions flagged and ignored. Then **Sam**: experience excluded, 75% evidence completeness.
6. **(3:30) Override** — Decision & audit → *Hold* on Amara → override warning → reason required → record; show audit trail and that the AI assessment is unchanged.
7. **(4:00) Persistence & export** — go to History, reopen the screening (decision still there); Export CSV; optionally restart `./scripts/dev.sh` and reopen.
8. **(4:30) Methodology** — weights, missing-evidence policy, duplicate method, limitations. Close with `./scripts/verify.sh` output.

---

Licensed under the [MIT License](LICENSE).
