#!/usr/bin/env bash
# Start the FastAPI backend (port 8000) and the Next.js frontend (port 3000) together.
# Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"

if [ ! -x "$ROOT/backend/.venv/bin/uvicorn" ] || [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "Dependencies are missing. Run ./scripts/setup.sh first." >&2
  exit 1
fi

if ! grep -Eq '^ADMIN_(EMAIL|PASSWORD)=.+' "$ROOT/backend/.env" 2>/dev/null; then
  echo "Note: no ADMIN_EMAIL/ADMIN_PASSWORD in backend/.env. Re-run ./scripts/setup.sh to create a local" >&2
  echo "administrator, or sign in with an account created earlier." >&2
fi

cleanup() {
  trap - INT TERM EXIT
  echo; echo "Stopping TalentLens…"
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

echo "→ Backend  http://localhost:${BACKEND_PORT}  (API docs: /docs)"
( cd "$ROOT/backend" && exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" --reload --reload-dir app ) &

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
if ! curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
  echo "Backend did not become healthy on port ${BACKEND_PORT}. Check the log above." >&2
  exit 1
fi

echo "→ Frontend http://localhost:${FRONTEND_PORT}"
( cd "$ROOT/frontend" && NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:${BACKEND_PORT}}" exec npm run dev -- --port "$FRONTEND_PORT" ) &

wait
