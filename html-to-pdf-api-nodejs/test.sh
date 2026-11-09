#!/usr/bin/env bash
# CI entry point: unit and API tests, then a Docker build and a smoke test.
set -euo pipefail
cd "$(dirname "$0")"

npm ci
npm test

image=html-to-pdf-api-nodejs
container=html-to-pdf-api-nodejs-test
docker build -t "$image" .

cleanup() {
  docker logs "$container" 2>&1 | tail -n 50 || true
  docker rm -f "$container" > /dev/null 2>&1 || true
}
trap cleanup EXIT

# --init stops Chrome child processes. SYS_ADMIN lets Chrome start its sandbox.
docker run -d --name "$container" --init --cap-add=SYS_ADMIN -p 3000:3000 "$image"

for _ in $(seq 1 60); do
  if curl -fsS http://localhost:3000/health > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

mkdir -p out
status=$(curl -sS -o out/smoke.pdf -w '%{http_code}' -X POST http://localhost:3000/pdf \
  -H 'Content-Type: application/json' -d @examples/invoice.json)
if [ "$status" != 200 ] || [ "$(head -c 5 out/smoke.pdf)" != '%PDF-' ]; then
  echo "Smoke test failed: status $status" >&2
  exit 1
fi

status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/pdf \
  -H 'Content-Type: application/json' -d '{"url":"file:///etc/passwd"}')
if [ "$status" != 400 ]; then
  echo "Expected status 400 for a file URL, got $status" >&2
  exit 1
fi

echo "Docker smoke test passed: $(wc -c < out/smoke.pdf) bytes"
