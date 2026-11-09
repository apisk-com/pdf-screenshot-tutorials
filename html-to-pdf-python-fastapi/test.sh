#!/usr/bin/env bash
# CI entry point (GitHub Actions, ubuntu-24.04): install Pango, run the tests,
# measure one render, run the service, then build and test the Docker image.
set -euo pipefail
cd "$(dirname "$0")"

echo "== System packages: Pango and HarfBuzz for WeasyPrint"
sudo apt-get update -qq
sudo apt-get install -y -qq libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 libharfbuzz0b
dpkg-query -W -f='${Package} ${Version}\n' libpango-1.0-0 libharfbuzz0b

echo "== Python packages"
python -m venv .venv
.venv/bin/pip install -q -r requirements-dev.txt
.venv/bin/python --version
.venv/bin/python -c 'import weasyprint; print("WeasyPrint", weasyprint.__version__)'

echo "== Tests"
.venv/bin/python -m pytest -q

echo "== Prototype measurements (temporary)"
.venv/bin/python _proto.py inproc
.venv/bin/python _proto.py preload
.venv/bin/python _proto.py warm 2>&1

echo "== One render: time and memory (GitHub runner $(nproc) CPUs)"
.venv/bin/python bench.py

echo "== Service smoke test"
mkdir -p out
.venv/bin/uvicorn app.main:app --port 8000 &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
curl -sf --retry 30 --retry-connrefused --retry-delay 1 -o /dev/null http://127.0.0.1:8000/health
curl -sf -D - -H 'Content-Type: application/json' -d @examples/invoice.json \
  -o out/invoice.pdf http://127.0.0.1:8000/invoices/pdf
head -c 5 out/invoice.pdf | grep -q '%PDF-'
echo "invoice.pdf: $(wc -c < out/invoice.pdf) bytes"
echo "== PDF (temporary, base64 of gzip)"
echo "PDFSTART"; gzip -c out/invoice.pdf | base64 -w0; echo; echo "PDFEND"
kill "$server"
wait "$server" 2>/dev/null || true
trap - EXIT

echo "== Docker image"
image=html-to-pdf-python-fastapi
container=html-to-pdf-python-fastapi-test
docker build -q -t "$image" .
docker image ls "$image" --format 'Image size: {{.Size}}'
docker run --rm "$image" python --version

cleanup() {
  docker logs "$container" 2>&1 | tail -n 30 || true
  docker rm -f "$container" > /dev/null 2>&1 || true
}
trap cleanup EXIT
docker run -d --name "$container" --init --read-only --tmpfs /tmp --memory 1g \
  -p 8001:8000 "$image"
curl -sf --retry 60 --retry-connrefused --retry-delay 1 -o /dev/null http://127.0.0.1:8001/health

status=$(curl -s -o out/docker.pdf -w '%{http_code}' -H 'Content-Type: application/json' \
  -d @examples/invoice.json http://127.0.0.1:8001/invoices/pdf)
if [ "$status" != 200 ] || [ "$(head -c 5 out/docker.pdf)" != '%PDF-' ]; then
  echo "Docker smoke test failed: status $status" >&2
  exit 1
fi
echo "Docker invoice.pdf: $(wc -c < out/docker.pdf) bytes"

# A file URL in the HTML must not end up in the PDF.
curl -sf -H 'Content-Type: application/json' -o out/attach.pdf http://127.0.0.1:8001/pdf \
  -d '{"html": "<link rel=\"attachment\" href=\"file:///etc/passwd\"><p>Hi</p>"}'
.venv/bin/python -c 'import sys; from pypdf import PdfReader; a = PdfReader(sys.argv[1]).attachments; print("attachments:", a); sys.exit(1 if a else 0)' out/attach.pdf
docker stats --no-stream --format 'Container memory after 2 renders: {{.MemUsage}}' "$container"

echo "== All checks passed"
