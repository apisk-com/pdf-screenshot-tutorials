#!/usr/bin/env bash
# CI entry point: install everything, run the tests, then a curl smoke test.
set -euo pipefail
cd "$(dirname "$0")"

# Chrome needs a color emoji font to print emoji. The GitHub runner has one;
# slim Docker images do not.
sudo apt-get update
sudo apt-get install -y --no-install-recommends fonts-noto-color-emoji

# npm ci also downloads the Chrome version that this Puppeteer version needs.
npm ci
npm test

# Start the server and convert the two example files with curl.
mkdir -p out
PORT=3100 node src/server.js &
server_pid=$!
trap 'kill "$server_pid"' EXIT

for _ in $(seq 1 30); do
  if curl -sf http://localhost:3100/health > /dev/null; then break; fi
  sleep 1
done

curl -sf -X POST http://localhost:3100/markdown \
  -H 'Content-Type: text/markdown' \
  --data-binary @examples/release-notes.md \
  -o out/release-notes.pdf
head -c 5 out/release-notes.pdf | grep -q '%PDF-'

curl -sf -X POST 'http://localhost:3100/markdown?breakBefore=h2' \
  -H 'Content-Type: text/markdown' \
  --data-binary @examples/model-answer.md \
  -o out/model-answer.pdf
head -c 5 out/model-answer.pdf | grep -q '%PDF-'

echo "Smoke test passed: out/release-notes.pdf and out/model-answer.pdf"
