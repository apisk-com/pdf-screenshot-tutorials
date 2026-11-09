#!/usr/bin/env bash
# CI entry point (exploration run): build the images, break each one on
# purpose, print the errors and the fixes.
set -euo pipefail
cd "$(dirname "$0")"
here=$PWD

df -h / | tail -1
docker version --format 'Docker {{.Server.Version}}'

if ! command -v pdffonts > /dev/null; then
  sudo apt-get install -y -qq poppler-utils > /dev/null
fi

# 1. Tests outside Docker.
(cd playwright && npm ci && npx playwright install --with-deps --only-shell chromium && npm test)
(cd puppeteer && npm ci && npm test)

# 2. Build the images.
build() { # tag folder dockerfile
  local start=$SECONDS
  docker build -q -t "$1" -f "$2/$3" "$2" > /dev/null
  echo "built $1 in $((SECONDS - start)) s"
}
# Builds a copy of a Dockerfile with one part removed (sed expression).
build_without() { # tag folder dockerfile sed-expression
  local start=$SECONDS
  sed "$4" "$2/$3" | docker build -q -t "$1" -f - "$2" > /dev/null
  echo "built $1 in $((SECONDS - start)) s (sed: $4)"
}

docker pull -q node:22-bookworm-slim > /dev/null
docker pull -q mcr.microsoft.com/playwright:v1.65.0-noble > /dev/null
docker pull -q ghcr.io/puppeteer/puppeteer:25.16.0 > /dev/null

build pw-official playwright Dockerfile
build pw-slim playwright Dockerfile.slim
build pptr-official puppeteer Dockerfile
build pptr-slim puppeteer Dockerfile.slim
build_without pw-slim-nodeps playwright Dockerfile.slim 's/install --with-deps/install/'
build_without pptr-slim-nodeps puppeteer Dockerfile.slim 's/ --install-deps//'
build_without pptr-slim-nofonts puppeteer Dockerfile.slim 's/ fonts-noto-cjk fonts-noto-color-emoji//'

docker image ls --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}'
df -h / | tail -1

for image in pw-official pw-slim pptr-official pptr-slim pptr-slim-nofonts; do
  echo "== $image"
  docker run --rm --entrypoint sh "$image" -c 'node --version; id; ls /usr/share/fonts/truetype /usr/share/fonts/opentype 2>/dev/null | tr "\n" " "; echo; command -v tini fc-list pidof ps || true'
done

# 3. Run cases.
port=3100
cleanup() {
  docker ps -aq | xargs -r docker rm -f > /dev/null 2>&1 || true
  sudo sysctl -q -w kernel.apparmor_restrict_unprivileged_userns=0 || true
}
trap cleanup EXIT

# Starts a container and waits until /health answers or the container stops.
# Prints the result and the first lines of the log.
run_case() { # label image [docker run options...]
  local label=$1 image=$2
  shift 2
  port=$((port + 1))
  local name="case-$port"
  docker run -d --name "$name" -p "$port:3000" "$@" "$image" > /dev/null
  local result=timeout
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:$port/health" > "/tmp/$name.json" 2> /dev/null; then
      result="healthy $(cat "/tmp/$name.json")"
      break
    fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]; then
      result="exited with code $(docker inspect -f '{{.State.ExitCode}}' "$name")"
      break
    fi
    sleep 1
  done
  echo "---- CASE $label: $image $*"
  echo "     result: $result"
  docker logs "$name" 2>&1 | head -n 40 | sed 's/^/     | /'
  CASE_NAME=$name
  CASE_PORT=$port
}

save_png() { # port label
  curl -fsS -o "/tmp/$2.png" "http://127.0.0.1:$1/check.png"
  curl -fsS -o "/tmp/$2.pdf" "http://127.0.0.1:$1/check.pdf"
  file "/tmp/$2.png"
  pdffonts "/tmp/$2.pdf" || true
  echo "=====BEGIN $2.png"
  base64 -w 100 "/tmp/$2.png"
  echo "=====END $2.png"
}

seccomp=$(mktemp)
curl -fsSL -o "$seccomp" https://raw.githubusercontent.com/microsoft/playwright/v1.65.0/utils/docker/seccomp_profile.json

for image in pw-official pw-slim pptr-official pptr-slim; do
  run_case "works" "$image" --cap-add=SYS_ADMIN
  save_png "$CASE_PORT" "$image"
done
run_case "fonts missing" pptr-slim-nofonts --cap-add=SYS_ADMIN
save_png "$CASE_PORT" pptr-slim-nofonts

run_case "libraries missing" pw-slim-nodeps --cap-add=SYS_ADMIN
run_case "libraries missing" pptr-slim-nodeps --cap-add=SYS_ADMIN

for image in pw-official pptr-slim; do
  run_case "root user" "$image" --cap-add=SYS_ADMIN --user root
  run_case "no SYS_ADMIN" "$image"
  run_case "seccomp profile" "$image" --security-opt "seccomp=$seccomp"
  run_case "no sandbox" "$image" -e CHROMIUM_SANDBOX=false
done
run_case "no SYS_ADMIN" pptr-official
run_case "no SYS_ADMIN" pw-slim

# AppArmor on Ubuntu 23.10+ hosts.
sudo sysctl -q -w kernel.apparmor_restrict_unprivileged_userns=1
run_case "apparmor restrict=1, SYS_ADMIN" pw-official --cap-add=SYS_ADMIN
run_case "apparmor restrict=1, seccomp" pw-official --security-opt "seccomp=$seccomp"
run_case "apparmor restrict=1, SYS_ADMIN" pptr-slim --cap-add=SYS_ADMIN
run_case "apparmor restrict=1, apparmor unconfined" pptr-slim --cap-add=SYS_ADMIN --security-opt apparmor=unconfined
sudo sysctl -q -w kernel.apparmor_restrict_unprivileged_userns=0

# Health check status and restart after a browser crash.
run_case "restart" pw-slim --cap-add=SYS_ADMIN --restart=on-failure --health-interval=2s
for _ in $(seq 1 20); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$CASE_NAME")" = healthy ] && break
  sleep 1
done
echo "health status: $(docker inspect -f '{{.State.Health.Status}}' "$CASE_NAME")"
docker top "$CASE_NAME" -eo pid,ppid,comm
docker top "$CASE_NAME" -eo pid,comm | awk '/chrom|headless/ {print $1}' | xargs -r sudo kill -9
sleep 5
echo "restart count: $(docker inspect -f '{{.RestartCount}}' "$CASE_NAME")"
docker logs "$CASE_NAME" 2>&1 | tail -n 8
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$CASE_PORT/health" && break
  sleep 1
done
echo
start=$SECONDS
docker stop "$CASE_NAME" > /dev/null
echo "docker stop took $((SECONDS - start)) s, exit code $(docker inspect -f '{{.State.ExitCode}}' "$CASE_NAME")"

# Zombies.
for image in pw-official pptr-slim; do
  echo "---- zombies $image: node is PID 1"
  docker run --rm --cap-add=SYS_ADMIN -v "$here/probes:/app/probes:ro" --entrypoint node "$image" probes/zombies.mjs || true
  echo "---- zombies $image: tini"
  docker run --rm --cap-add=SYS_ADMIN -v "$here/probes:/app/probes:ro" "$image" node probes/zombies.mjs || true
  echo "---- zombies $image: --init"
  docker run --rm --init --cap-add=SYS_ADMIN -v "$here/probes:/app/probes:ro" --entrypoint node "$image" probes/zombies.mjs || true
done

# /dev/shm.
for image in pw-official pptr-slim; do
  for opts in "" "--shm-size=1g" "--ipc=host"; do
    for mode in default use-dev-shm; do
      echo "---- shm $image [$opts] $mode"
      # shellcheck disable=SC2086
      docker run --rm --cap-add=SYS_ADMIN $opts -v "$here/probes:/app/probes:ro" "$image" node probes/shm.mjs "$mode" 2>&1 | head -n 12 || true
    done
  done
  echo "---- shm $image memory 512m default"
  docker run --rm --cap-add=SYS_ADMIN --memory=512m --memory-swap=512m -v "$here/probes:/app/probes:ro" "$image" node probes/shm.mjs default 2>&1 | head -n 12 || true
done

df -h / | tail -1
echo "Exploration finished."
