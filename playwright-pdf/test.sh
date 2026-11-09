#!/usr/bin/env bash
# CI entry point: install everything, run the tests, then run each example once.
set -euo pipefail
cd "$(dirname "$0")"

echo "== Node.js"
(
  cd node
  npm ci
  # Chromium makes the PDFs. Firefox is only for the test that shows the error.
  npx playwright install --with-deps chromium firefox
  npm test
  node make-pdf.js ../report.html out/report.pdf
  head -c 5 out/report.pdf | grep -q '%PDF-'
)

echo "== Python"
(
  cd python
  python -m venv .venv
  .venv/bin/pip install -r requirements.txt
  .venv/bin/python -m playwright install --with-deps chromium
  .venv/bin/python -m pytest -q
  .venv/bin/python make_pdf.py ../report.html out/report.pdf
  head -c 5 out/report.pdf | grep -q '%PDF-'

  # Smoke test of the FastAPI service with curl.
  .venv/bin/uvicorn app:app --port 8000 &
  server=$!
  trap 'kill "$server" 2>/dev/null || true' EXIT
  curl -sf --retry 30 --retry-connrefused --retry-delay 1 -o /dev/null http://127.0.0.1:8000/docs
  jq -Rs '{html: .}' ../report.html \
    | curl -sf -H 'Content-Type: application/json' -d @- -o out/report-api.pdf http://127.0.0.1:8000/pdf
  head -c 5 out/report-api.pdf | grep -q '%PDF-'
)

echo "All checks passed."
