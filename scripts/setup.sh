#!/usr/bin/env bash
# One-time setup: Python virtualenv + backend deps, frontend deps, env files.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3}"

echo "→ Backend: creating virtual environment (backend/.venv)"
cd "$ROOT/backend"
if [ ! -d .venv ]; then
  if command -v uv >/dev/null 2>&1; then uv venv .venv --python "${PYTHON_VERSION:-3.13}"; else "$PYTHON" -m venv .venv; fi
fi
if command -v uv >/dev/null 2>&1; then
  uv pip install --python .venv/bin/python -r requirements.txt
else
  .venv/bin/python -m pip install --upgrade pip >/dev/null
  .venv/bin/python -m pip install -r requirements.txt
fi
[ -f .env ] || cp .env.example .env

echo "→ Frontend: installing npm packages"
cd "$ROOT/frontend"
npm install
[ -f .env.local ] || cp .env.example .env.local

echo "✓ Setup complete. Start everything with: ./scripts/dev.sh"
