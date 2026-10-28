#!/usr/bin/env bash
# Run every automated check: backend tests with coverage, frontend unit tests, type check, lint,
# dependency audit and production build.
# Pass --e2e to also run the Playwright end-to-end test (starts both servers itself).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Backend tests (pytest, line + branch coverage, fails under 90%)"
( cd "$ROOT/backend" && .venv/bin/python -m pytest --cov )

echo "== Frontend unit tests (Vitest, with coverage)"
( cd "$ROOT/frontend" && npm run test:coverage )

echo "== Frontend type check"
( cd "$ROOT/frontend" && npx tsc --noEmit )

echo "== Frontend lint"
( cd "$ROOT/frontend" && npm run lint )

echo "== Frontend dependency audit"
( cd "$ROOT/frontend" && npm audit --audit-level=high )

echo "== Frontend production build"
( cd "$ROOT/frontend" && npm run build >/dev/null && echo "build ok" )

if [ "${1:-}" = "--e2e" ]; then
  echo "== End-to-end (Playwright)"
  ( cd "$ROOT/frontend" && npm run test:e2e )
fi

echo "✓ All checks passed"
