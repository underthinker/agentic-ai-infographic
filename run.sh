#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
python -m venv .venv 2>/dev/null || true
source .venv/bin/activate
pip install -q -r requirements.txt
[ -f data/agentic.db ] || python -m backend.seed
exec uvicorn backend.app:app --host 127.0.0.1 --port 8787 --reload
