#!/usr/bin/env bash
# CI entry point (GitHub Actions, ubuntu-24.04). Installs everything, runs the
# Node and Python tests, renders the invoice with wkhtmltopdf, Chrome and
# WeasyPrint, and compares the old PDF with the new ones.
set -euo pipefail
cd "$(dirname "$0")"

echo "== System packages: poppler (pdftoppm, pdftotext) and Pango for WeasyPrint"
sudo apt-get update -qq
sudo apt-get install -y -qq poppler-utils libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 libharfbuzz0b

echo "== wkhtmltopdf: the last upstream build (0.12.6.1, patched Qt)"
deb_url=https://github.com/wkhtmltopdf/packaging/releases/download/0.12.6.1-3/wkhtmltox_0.12.6.1-3.jammy_amd64.deb
curl -fsSL -o /tmp/wkhtmltox.deb "$deb_url"
sudo apt-get install -y -qq /tmp/wkhtmltox.deb
wkhtmltopdf --version

echo "== Node.js packages and Chrome for Puppeteer"
npm ci

echo "== Python packages"
python -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt

echo "== Tests"
npm test
pytest -q

echo "== Render the invoice with the three engines"
rm -rf out && mkdir -p out
./render-wkhtmltopdf.sh document/invoice.html out/wkhtmltopdf.pdf
node render-chrome.mjs document/invoice.html out/chrome.pdf
node render-chrome.mjs document/invoice.html out/chrome-0.8.pdf 0.8
python render_weasyprint.py document/invoice.html out/weasyprint.pdf
for f in out/*.pdf; do
  head -c 5 "$f" | grep -q '%PDF-' || { echo "Not a PDF: $f"; exit 1; }
  echo "$f: $(pdfinfo "$f" | grep -E '^(Pages|Page size)' | tr -s ' ' | tr '\n' ' ')"
  pdffonts "$f" | tail -n +3 | awk '{print "  font: " $1}'
done

echo "== Visual diff: old (wkhtmltopdf) and new PDFs"
# A migration diff is not 0%, so print the result and do not fail here.
# The exit codes of diff-pdfs.mjs are tested in test/diff.test.mjs.
node diff-pdfs.mjs out/wkhtmltopdf.pdf out/chrome.pdf out/diff-chrome || true
node diff-pdfs.mjs out/wkhtmltopdf.pdf out/chrome-0.8.pdf out/diff-chrome-0.8 || true
node diff-pdfs.mjs out/wkhtmltopdf.pdf out/weasyprint.pdf out/diff-weasyprint || true
node diff-pdfs.mjs out/chrome.pdf out/weasyprint.pdf out/diff-chrome-weasyprint || true

echo "== wkhtmltopdf behavior that the tutorial describes"
# x or y position (in points) of a word on page 1, from pdftotext -bbox.
word() { pdftotext -bbox -f 1 -l 1 "$1" - | grep -m1 ">$2<" | sed -E "s/.*$3=\"([0-9.]+)\".*/\1/" || true; }
# expect <description> <actual> <expected>: stop with an error when they differ.
expect() {
  if [ "$2" = "$3" ]; then echo "ok: $1 ($2)"; else echo "FAILED: $1: got '$2', expected '$3'"; exit 1; fi
}
ruler() { echo "$(word "$1" RIGHTMARK xMax) - $(word "$1" LEFTMARK xMin)" | bc | xargs printf '%.0f'; }

wkhtmltopdf -q -T 0 -B 0 -L 0 -R 0 test/fixtures/plain.html out/wk-shrink.pdf
wkhtmltopdf -q -T 0 -B 0 -L 0 -R 0 --disable-smart-shrinking test/fixtures/plain.html out/wk-noshrink.pdf
expect "smart shrinking: a 400px box in pt" "$(ruler out/wk-shrink.pdf)" 240
expect "--disable-smart-shrinking: a 400px box in pt" "$(ruler out/wk-noshrink.pdf)" 300

wkhtmltopdf -q test/fixtures/modern-css.html out/wk-modern.pdf
expect "flex items on one line" "$([ "$(word out/wk-modern.pdf FLEXA yMin)" = "$(word out/wk-modern.pdf FLEXC yMin)" ] && echo yes || echo no)" no
expect "grid items on one line" "$([ "$(word out/wk-modern.pdf GRIDA yMin)" = "$(word out/wk-modern.pdf GRIDC yMin)" ] && echo yes || echo no)" no
expect "@page margin box text printed" "$(pdftotext out/wk-modern.pdf - | grep -c MARGINBOXTEXT || true)" 0

wkhtmltopdf -q -L 10mm test/fixtures/css-margin.html out/wk-css-margin.pdf
expect "CSS @page margin 30mm and -L 10mm: left edge under 40 pt" "$(echo "$(word out/wk-css-margin.pdf TOPLEFT xMin) < 40" | bc)" 1

wkhtmltopdf -q test/fixtures/plain.html out/wk-default.pdf
expect "default media type" "$(pdftotext out/wk-default.pdf - | grep -oE 'SCREENTEXT|PRINTTEXT')" SCREENTEXT

wkhtmltopdf -q --enable-local-file-access test/fixtures/outside-font.html out/wk-woff2.pdf
expect "a WOFF2-only web font is used" "$(pdffonts out/wk-woff2.pdf | grep -c Inter || true)" 0
expect "the WOFF fallback of the invoice is used" "$(pdffonts out/wkhtmltopdf.pdf | grep -c Inter-Regular)" 1

wkhtmltopdf -q test/fixtures/delayed.html out/wk-nodelay.pdf
wkhtmltopdf -q --javascript-delay 2000 test/fixtures/delayed.html out/wk-delayed.pdf
expect "default JavaScript delay (200 ms)" "$(pdftotext out/wk-nodelay.pdf - | grep -oE 'LOADING|CHARTREADY')" LOADING
expect "--javascript-delay 2000" "$(pdftotext out/wk-delayed.pdf - | grep -oE 'LOADING|CHARTREADY')" CHARTREADY

echo "== The Ubuntu package of wkhtmltopdf (unpatched Qt) and the footer flags"
# Information only. Last step, because apt can replace the upstream package.
if sudo apt-get install -y -qq wkhtmltopdf > /dev/null 2>&1; then
  export QT_QPA_PLATFORM=offscreen
  /usr/bin/wkhtmltopdf --version || true
  /usr/bin/wkhtmltopdf --log-level warn --footer-center "Page [page] of [topage]" \
    test/fixtures/long.html out/ubuntu-footer.pdf 2>&1 | tr '\r' '\n' | grep -v '^\s*$' || true
  if [ -f out/ubuntu-footer.pdf ]; then
    echo "body text lines: $(pdftotext out/ubuntu-footer.pdf - | grep -c 'Block 1' || true)"
    echo "footer text lines: $(pdftotext out/ubuntu-footer.pdf - | grep -c 'Page 1 of' || true)"
  fi
else
  echo "apt could not install the Ubuntu package"
fi

echo "== All checks passed"
