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
# Every endpoint requires sign-in. Unless an administrator is already configured, create the
# public demo login documented in the README (local use only: production refuses it).
# Set RANDOM_ADMIN_PASSWORD=1 to generate a private random password instead.
if ! grep -Eq '^ADMIN_PASSWORD=.{12,}' .env; then
  ADMIN_PASSWORD_VALUE="5zAFCJZhXDi4Suo1hp-n8K8b"
  if [ "${RANDOM_ADMIN_PASSWORD:-0}" = "1" ]; then
    ADMIN_PASSWORD_VALUE="$("$PYTHON" -c 'import secrets; print(secrets.token_urlsafe(18))')"
  fi
  sed -i.bak -e '/^ADMIN_EMAIL=/d' -e '/^ADMIN_PASSWORD=/d' .env && rm -f .env.bak
  printf '\nADMIN_EMAIL=admin@talentlens.local\nADMIN_PASSWORD=%s\n' "$ADMIN_PASSWORD_VALUE" >> .env
  echo "  Created a local administrator:  admin@talentlens.local / $ADMIN_PASSWORD_VALUE"
  echo "  (saved in backend/.env — for local use only; production refuses the demo password)"
fi

echo "→ Frontend: installing npm packages"
cd "$ROOT/frontend"
npm install
[ -f .env.local ] || cp .env.example .env.local

echo "✓ Setup complete. Start everything with: ./scripts/dev.sh"
