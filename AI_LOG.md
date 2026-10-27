# AI usage log

This project was built in a single session by **Claude Opus 5.5 (Claude Code CLI)**, working autonomously from one detailed brief. This log records what was actually prompted, decided, observed and fixed. Every failure listed under “Observed problems” really happened in this session; nothing here is hypothetical unless explicitly marked.

## Prompt

One prompt: a ~25-section brief titled *“Build a complete, production-style AI resume screening platform”* (TalentLens). It specified the product vision, stack (Next.js/TypeScript/Tailwind + FastAPI/SQLite/PyMuPDF/python-docx), screens, demo vs. live AI modes, parsing edge cases, scoring weights (40/25/20/15) and thresholds (80/65), evidence verification, three-level duplicate detection, fairness/privacy rules, a test matrix, repository layout, documentation, Git hygiene, and a definition of done. It instructed the agent to work autonomously and not stop at a plan.

## Process

1. Inspected the environment: empty directory, no Git; Python 3.13, Node 24/npm 11, `uv`, Google Chrome available.
2. Loaded the bundled Claude API reference before writing the Anthropic provider, and checked the installed `anthropic` 2.3.0 signatures (`messages.create(output_config=…)`, beta `fallbacks`, typed exceptions) instead of relying on memory.
3. Built the backend bottom-up (config → models → parsing → duplicates → analysis → scoring → evidence → providers → pipeline → API), smoke-testing each layer against generated sample resumes, then wrote the test suite.
4. Built the frontend (design tokens → primitives → shell → screens), keeping `tsc`/ESLint clean as it went.
5. Ran both servers and drove the full workflow in real Chrome with a Playwright script, reading every screenshot; fixed what it found; then committed a Playwright E2E test.

## Key design decisions

| Decision | Why |
|---|---|
| Providers return **per-criterion** assessments only; a separate deterministic engine computes the overall score | Keeps scoring testable, provider-independent and explainable; the model can't “decide” a total. |
| **Evidence verification** layer locates every quote in the text; unverified quotes are rejected and can downgrade a criterion to *ambiguous* | Structured output being valid JSON is not proof it's true. |
| Missing evidence: *not found* is scored (low) but worded as “not established”; *ambiguous/not assessable* are excluded with weights renormalised; **evidence completeness** shown; < 60% → *Insufficient evidence*, unranked | Avoids treating absent evidence as proof of absence, while staying honest that the score reflects documented evidence. |
| Append-only `evaluations` and `recruiter_reviews` | Overrides can never mutate the original assessment; full audit trail for free. |
| Override = decision outside the set consistent with the AI band; reason required for overrides, rejections and decisions without an assessment — enforced by the API | Human-in-the-loop with accountability, not just UI validation. |
| Demo provider is rule-based and labelled as such everywhere, runs on real extracted text, and its output still passes through verification + scoring | Lets the whole product be evaluated with no API key without faking AI. |
| Original files are not stored; parsing in memory | Smaller privacy footprint; extracted text is enough to reopen results and verify evidence. |
| Durations always from the app's own date parser (overlaps merged once) | The brief forbids inferring years from unreliable information. |
| Single background worker + persisted statuses + polling; crash recovery marks stuck jobs *interrupted* | Proportionate reliability without a job queue. |
| Live provider: SDK retries off, own bounded retry loop | Explicit, testable behaviour for 429/timeouts/invalid output. |
| Hand-written shadcn-style components on Radix instead of the shadcn CLI | Fewer moving parts with Next 16 / Tailwind 4; full control over the visual system. |

## Observed problems, diagnosis and fixes

### Tooling

1. **`create-next-app` install step failed** — `npm error code EALLOWSCRIPTS: --allow-scripts is not allowed in project-scoped installs` (npm 11). The scaffold files were written; ran `npm install` directly. The one package with an install script (`unrs-resolver`, an ESLint resolver) is declined in `package.json#allowScripts`. *Verified by:* lint and build pass.
2. **Next 16 template enables `cacheComponents`**, which requires Suspense around request-time client hooks. Since this UI is client-rendered against FastAPI, disabled it and still wrapped the `useSearchParams` page in `<Suspense>`. *Verified by:* `next build` succeeds.

### Backend (found by smoke tests and unit tests)

3. **Pydantic serializer warnings** (`Expected enum … input_value='required_skills'`) — the default weights dict used `str` keys and defaults aren't validated. Keyed it by `CriterionKey`. *Verified:* warning gone in the API smoke run.
4. **Plural mismatch** — focus term “API” didn't match “APIs”, so a clearly relevant role was missed. Added optional plural suffixes to term patterns. *Verified:* the role became relevant in the smoke run.
5. **Relevance over-counting** — a frontend engineer got 5.5 “relevant” years because one bullet said “REST APIs”, matching both the focus term *API* and the skill *REST APIs*. Changed the rule (title names a focus/required term, **or** ≥ 2 distinct terms in the description) and count **non-overlapping match spans** so one phrase can't count twice. *Verified:* Jonas → 0 relevant years; Mei's analyst years no longer counted, backend years still counted.
6. **Freelance work under-credited** — Sam's “SELECTED WORK” heading wasn't recognised, so all work lines were treated as summary text (skills only “partial”). Added freelance/consulting/selected-work headings — this mattered for the brief's requirement not to penalise unconventional careers. *Verified:* Sam's required-skills evidence became “demonstrated”.
7. **Near-empty resume ranked at 0.0** — a 191-character file was ranked last with a numeric score. Added a policy: under 300 characters → *Insufficient evidence*, never ranked. *Verified:* moved to *Not ranked*.
8. **Near-duplicate threshold too tight** — measured Jaccard 0.856 for an edited copy vs. a 0.85 default. Lowered to 0.80 and documented the measurements (unrelated resumes ≈ 0.04).
9. **Corrupt PDF reported as “empty”** — PyMuPDF repaired the garbage file to zero pages. Zero pages now maps to `corrupted_file`.
10. **Synthetic scanned PDF was 1.4 MB** — the image stream wasn't compressed; saved with `deflate=True` (11 KB).
11. **Upload response bug caught before running** — code assigned an ad-hoc attribute on a Pydantic v2 model (would raise). Rewritten to collect `(filename, id, error)` tuples.
12. **Two test failures on the first full run (106/108)** — both test bugs: (a) `make_pdf()` embeds a fresh timestamp, so two calls weren't byte-identical (test now reuses bytes); (b) a fixture resume was under the new 300-character minimum, so it was correctly unranked (fixture made realistic). *Verified:* 108/108.

### Frontend (found by type check, lint and browser QA)

13. **React Compiler lint errors** — `useMemo` sorter “could not preserve memoization”, `watch()` incompatible-library warning, and later `set-state-in-effect` in the data hook. Moved the comparator to module scope, switched to `useWatch`, and removed an unused `refreshing` state that was set synchronously.
14. **Concurrent uploads bypassed duplicate detection (real bug, found in Chrome).** The upload panel sends 3 files in parallel; each request read existing candidates before the others committed, so `amara-okafor.pdf` and its DOCX copy were both “unique” and both ranked. Fix: parse concurrently, but serialise *re-read + dedupe + insert + commit* per session with a lock. Regression test added — and when first written it **passed even without the lock** (window too narrow), so it proved nothing; it now widens the window deterministically and was confirmed to fail 3/3 without the lock and pass with it. *Verified in Chrome:* the DOCX copy is now `exact_text` / not evaluated.
15. **Progress banner froze (“1 of 8 complete”) after auto-evaluate.** The DB showed all 8 evaluations finished within ~40 ms; the hook only polled from its initial-load loop, so a `refresh()` that started evaluation never resumed polling. Polling is now driven by the latest data. *Verified:* banner clears and results appear without manual refresh.
16. **Escape didn't close the candidate drawer on first press.** Radix auto-focused the first button (“Next candidate”), which opened its tooltip; Escape closed the tooltip instead. The drawer now focuses its own container on open. *Verified:* QA script's “wait for drawer detached” passes.
17. **Visual issues from screenshots:** long “Lower evidence-based match” badge overflowing into the Flags column (short labels + tooltip in tables), near-duplicate badge squeezing out the filename (wrap), chart threshold labels clipped (more margin; chart hidden on phones where labels collided), badges rendering in the serif heading font (`font-sans` on badges), the same quote shown twice when two skills share a line (dedupe), role header lines preferred over descriptive bullets as evidence (bullets first), truncated weight legends (single column), a purely decorative legend on the methodology page (removed), and the Next dev indicator overlapping the API status (disabled).

### Final verification (this session)

- `pytest`: 109 passed. `tsc --noEmit`: clean. ESLint: 0 problems. `next build`: success.
- Playwright E2E in Chrome: 1 passed (full acceptance workflow, zero console errors).
- Manual QA script: 23 screenshots across all screens at 1440 px and 390 px; 0 console errors; 0 px horizontal overflow on mobile.
- `./scripts/dev.sh` started both servers; health, app and `/docs` returned 200.

## Second pass — product design and frontend overhaul

Prompt: a second brief (“principal product designer + frontend engineer master directive”) asking to audit the working app and turn the UI into a polished, editorial SaaS experience without breaking backend behaviour or faking data.

**Audit findings that drove the work:** the shortlist lacked key-evidence context, review-status and duplicate filters, visible sort direction, active-filter chips and row-level actions; scores used rings rather than a compact treatment; the candidate panel didn't separate the original assessment from the recruiter decision as layers and had no dedicated missing-evidence section; upload status stopped at “text extracted”; the methodology page was a wall of cards and didn't explain how decisions/overrides work; there was no screening context in the sidebar and no “last updated” anywhere.

**Changes:** warmer token palette and typography/motion/z-index tokens; new primitives (checkbox, search field, collapsible, avatar, animated metric, compact score meter, `disabledReason` tooltips); rebuilt shell, overview, job setup, upload, shortlist, candidate panel, history and methodology. Two small backend additions to support the UI: `key_skills`/`missing_skills` on each evaluation summary and `last_activity_at` on each session (covered by updated API tests). The decision form was extracted so the drawer and the new quick-decision dialog share one implementation.

**Problems actually observed in this pass and fixed**

1. **Port cleanup nearly hit the wrong processes.** `lsof -ti tcp:PORT` also returns *clients*; the PIDs included the user's Chrome and VS Code network helpers. The kill failed on quoting before doing harm. It also revealed that the earlier `dev.sh` smoke test had left servers running (an earlier cleanup command had silently failed), which is why the E2E web servers wouldn't start. From then on only `-sTCP:LISTEN` processes were stopped, after printing what they were.
2. **Filters menu unreachable (found by the E2E test).** With 22 options and `max-h: 70vh`, items rendered outside the viewport. Now capped at Radix's `--radix-dropdown-menu-content-available-height` with collision padding.
3. **Invalid HTML / hydration risks caught in review before running:** a `<p>` nested in the page header's `<p>`; a tooltip-wrapped disabled button used as a Radix `asChild` dropdown trigger; and reading `sessionStorage` in a `useState` initialiser (server/client first-render mismatch). Fixed with a `<span>`, a separate disabled branch, and `useSyncExternalStore` with a server snapshot.
4. **Mobile drawer overflowed horizontally** (seen in a 390 px screenshot; the automated check only measured the page, not the drawer). The breakdown table's `min-width` made its grid track size to min-content; fixed with `grid-cols-1` and `min-w-0` children, then measured 0 px overflow inside each drawer tab.
5. **Misleading sort indicator:** the Score header showed ↑ while the list was high→low (it shared the rank sort key). The header now shows the inverted direction.
6. **Visual issues from screenshots:** long recommendation badges colliding with the next column (short labels + full label on hover), truncated “evidence assessed” text, an orphaned “+n” chip, the scoring version wrapping mid-token, three stacked toasts for one upload (now one summary), a truncated “need review” count on the overview, “— relevant” for undated experience, and a clipped drawer tab label on phones.
7. **QA script bug, not an app bug:** after renaming the nav item to “Screen candidates”, the script's link selector matched `/screenings/new`; fixed in the script.

**Verification for this pass:** pytest 109 passed; `tsc` clean; ESLint 0 problems; `next build` succeeded; Playwright E2E passed (now also covering the filter menu and chips, sortable headers in both directions and the quick-decision dialog); a scripted Chrome walkthrough produced screenshots at 1440, 1280, 820 and 390 px with 0 console errors and 0 px page overflow; reduced-motion emulation reduced animation duration to ~0.

## Third pass — themes, command menu, finish

Prompt: “make the UI/UX more visually professional, appealing, aesthetic, cool and calm for the eyes, impressive, interactive, attractive.”

**Changes:** a calm dark theme plus Light / Dark / System (all colours moved to semantic tokens, JS/SVG/chart colours resolve to CSS variables; a pre-paint script prevents a theme flash); a ⌘K command menu that searches pages, saved screenings and the open screening's candidates; a soft ambient light behind page headers and the candidate panel header; a refined primary button; an animated active indicator in the sidebar; hover accent bars on clickable rows; short page-enter transitions; a local-time greeting on the overview.

**Observed and fixed:** the candidate-panel header wash initially painted over its own text (absolute element above static content — fixed with `isolate` and a negative z-index); drawer tab labels showed a doubled gap because an `&nbsp;` span became its own flex item; the command input drew the global focus rectangle inside the palette. Care taken with the user's data: the running app was using the user's real database (containing one screening they created), so QA created its own screening and deleted only that one by ID; the app was paused for the E2E run and restarted afterwards.

**Verification:** pytest 109 passed; `tsc` clean; ESLint 0 problems; `next build` succeeded; Playwright E2E passed; scripted Chrome walkthrough in both themes — 0 console errors, 0 px mobile overflow, theme switches live, command menu opens a candidate.

## Not verified / remaining limitations

- **Live Anthropic mode was not called against the real API** (no key available). It is covered only by mocked-client tests. Prompts and schema handling may need adjustment on first real use.
- The near-duplicate threshold, scoring weights and bands are untested against real hiring data.
- Demo evaluation is heuristic (see README “Limitations”).
- The duplicate lock is per process; multiple backend workers would need a database-level guard.
- Accessibility was checked through semantics, keyboard paths exercised in Playwright and visual review — not with a screen reader or a formal audit.
