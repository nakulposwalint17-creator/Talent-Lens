# Submission guide

How each submission requirement is met, and where to look.

| # | Requirement | Where |
|---|---|---|
| 1 | Git repository | This repository |
| 2 | README covering setup, how scoring works, what's done, what's missing, known bugs | [`README.md`](README.md) — sections *Quick start / Installation / Starting the application*, *Scoring: formula, weights, thresholds*, *Missing-evidence policy*, *Implemented features*, *Missing features*, *Known bugs*, *Limitations and assumptions* |
| 3 | Tests covering scoring, duplicate detection and unreadable files | `backend/tests/` — 191 passing tests (95.4% line / 86.4% branch coverage), `frontend/**/*.test.ts(x)` — 74 unit/component tests, plus 2 browser end-to-end tests (details below) |

## Running the tests

```bash
./scripts/setup.sh                    # once
cd backend && .venv/bin/python -m pytest --cov
cd frontend && npm test
# or everything (tests + coverage, type check, lint, audit, build, end-to-end):
./scripts/verify.sh --e2e
```

No API key is needed; all fixtures are generated inside the tests.

## Tests for the three required areas

**Scoring** — `backend/tests/test_scoring.py`
- `test_exact_weighted_calculation` — 0.40·80 + 0.25·60 + 0.20·50 + 0.15·40 = 63.0, with per-criterion contributions
- `test_minimum_and_maximum_scores`, `test_recommendation_thresholds`, `test_threshold_uses_rounded_score_consistently`
- `test_invalid_criterion_scores_rejected` (negative, >100, NaN, ±infinity), `test_invalid_weights_rejected`, `test_malformed_inputs_raise`
- `test_ambiguous_criterion_excluded_and_weights_renormalised`, `test_not_found_is_scored_not_excluded`, `test_low_completeness_yields_insufficient_evidence`, `test_no_assessable_criteria_gives_no_score`
- `test_deterministic_repeated_calculation`, `test_custom_weights_are_applied`

**Duplicate detection** — `backend/tests/test_duplicates.py`, plus API tests
- `test_identical_file_hash`, `test_identical_normalised_text_with_whitespace_and_case_differences`
- `test_same_text_in_pdf_and_docx_is_exact_text_duplicate`
- `test_near_duplicate_threshold_behaviour`, `test_different_candidates_with_similar_names_are_not_duplicates`
- `test_empty_and_malformed_inputs`, `test_ranking_exclusion_rules_are_reversible`
- `test_api.py::test_duplicates_are_persisted_and_reversible`
- `test_api.py::test_concurrent_uploads_still_detect_duplicates` — regression test for a real race found in browser testing (confirmed to fail without the fix)

**Unreadable files** — `backend/tests/test_parsing.py`, plus API tests
- `test_corrupted_pdf`, `test_corrupted_docx`, `test_zip_that_is_not_a_docx`, `test_pdf_extension_with_non_pdf_content`
- `test_empty_file`, `test_empty_docx_and_blank_pdf`, `test_image_only_pdf_requires_ocr`, `test_password_protected_pdf`
- `test_unsupported_formats` (.txt, .png, legacy .doc), `test_oversized_upload`
- `test_api.py::test_mixed_batch_upload_isolates_failures` — one batch with valid, corrupt, scanned, encrypted, unsupported and empty files; each gets its own status and the valid ones are unaffected
- `test_api.py::test_evaluation_ranking_and_failed_files_never_scored` — unreadable files are never ranked or given a zero score

## Security tests

**Authentication** — `backend/tests/test_auth.py`: scrypt hashing, sign-in/out, identical errors for wrong password and unknown email, tokens stored only as digests, expired/invalid/malformed tokens, deactivation and password resets revoking sessions, bootstrap admin created once and never overwritten, legacy-database migration.

**Access control** — `backend/tests/test_access_control.py`: every route in the OpenAPI schema returns 401 without credentials; a recruiter gets 404 on all 11 session/candidate operations for another recruiter's data; listings and dashboard are scoped per user; admin-only user management; the last administrator can't be removed; the audit trail records the actor.

**HTTP hardening and rate limits** — `backend/tests/test_security.py`: security headers on success and error responses; production mode (no docs, HSTS, wildcard CORS and the public demo password refused); body-size caps including streamed bodies; per-IP, per-user and sign-in limits with `Retry-After`; account lockout; forged `X-Forwarded-For` can't evade limits; CORS on 429 responses.

**Prompt injection** — `backend/tests/test_prompt_safety.py`: delimiter breakout (`</resume>`), random fence ids, instruction-line redaction, Unicode tag smuggling, white/covered/microscopic/transparent/invisible PDF text, hidden/white/tiny DOCX runs (while keeping white text on dark banners and shaded cells), application-raised flags when the model stays silent, hiring directives in model output, and the rule-based baseline divergence check.

**Frontend** — Vitest tests for the API client (bearer header, sign-out on 401, authenticated CSV download, uploads), token storage, open-redirect protection, the auth gate and the sign-in page; Playwright `access control` test in a real browser.

## Running the application

```bash
./scripts/setup.sh
./scripts/dev.sh      # http://localhost:3000 (API docs: http://localhost:8000/docs)
```

Sign in with the demo login: **`admin@talentlens.local`** / **`5zAFCJZhXDi4Suo1hp-n8K8b`** (created by `setup.sh`; for local use only, since production refuses this password). Demo mode works without any API key. Synthetic sample resumes and edge-case files are in `samples/`.
