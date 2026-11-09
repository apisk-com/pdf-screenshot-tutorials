#!/usr/bin/env bash
# CI entry point: unit and API tests, then a Docker build and a smoke test.
set -euo pipefail
cd "$(dirname "$0")"

npm ci
# The service needs only the headless shell build of Chromium.
npx playwright install --with-deps --only-shell chromium
npm test

image=screenshot-api-nodejs
container=screenshot-api-nodejs-test
docker build -t "$image" .
docker image ls "$image"
echo "Node.js in the image: $(docker run --rm "$image" node --version)"

# Temporary check: what happens without SYS_ADMIN?
docker run --rm "$image" node -e "
  import('playwright')
    .then(({ chromium }) => chromium.launch({ chromiumSandbox: true }))
    .then((b) => { console.log('SANDBOX CHECK: started'); return b.close(); })
    .catch((e) => console.log('SANDBOX CHECK: failed:', e.message.split('\n').slice(0, 14).join(' | ')));
" || true

# A local test page. The container uses the host network, so it can open it.
PORT=8080 node test/test-page-server.js &
pages_pid=$!
out=$(mktemp -d)

cleanup() {
  docker logs "$container" 2>&1 | tail -n 50 || true
  docker rm -f "$container" > /dev/null 2>&1 || true
  kill "$pages_pid" 2> /dev/null || true
  rm -rf "$out"
}
trap cleanup EXIT

# --init stops Chromium child processes. SYS_ADMIN lets Chromium start its sandbox.
docker run -d --name "$container" --init --cap-add=SYS_ADMIN --network host \
  -e API_KEY=ci-key "$image"

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3000/health > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

shot='http://127.0.0.1:3000/screenshot?url=http://127.0.0.1:8080/'

status=$(curl -sS -o /dev/null -w '%{http_code}' "$shot")
if [ "$status" != 401 ]; then
  echo "Expected status 401 without an API key, got $status" >&2
  exit 1
fi

curl -fsS -H 'Authorization: Bearer ci-key' -o "$out/shot.png" "$shot&width=1200&height=630"
file "$out/shot.png"
file "$out/shot.png" | grep -q 'PNG image data, 1200 x 630'

curl -fsS -H 'Authorization: Bearer ci-key' -o "$out/shot.webp" "$shot&format=webp"
file "$out/shot.webp"
file "$out/shot.webp" | grep -q 'Web/P image'

echo "Docker smoke test passed."
