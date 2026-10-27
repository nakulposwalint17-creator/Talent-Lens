#!/usr/bin/env bash
# Run every automated check: backend tests, frontend type check, lint and production build.
# Pass --e2e to also run the Playwright end-to-end test (starts both servers itself).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Backend tests (pytest)"
( cd "$ROOT/backend" && .venv/bin/python -m pytest )

echo "== Frontend type check"
( cd "$ROOT/frontend" && npx tsc --noEmit )

echo "== Frontend lint"
( cd "$ROOT/frontend" && npm run lint )

echo "== Frontend production build"
( cd "$ROOT/frontend" && npm run build >/dev/null && echo "build ok" )

if [ "${1:-}" = "--e2e" ]; then
  echo "== End-to-end (Playwright)"
  ( cd "$ROOT/frontend" && npm run test:e2e )
fi

echo "✓ All checks passed"
