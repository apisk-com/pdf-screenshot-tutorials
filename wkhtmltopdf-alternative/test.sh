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
node diff-pdfs.mjs out/wkhtmltopdf.pdf out/weasyprint.pdf out/diff-weasyprint || true
node diff-pdfs.mjs out/chrome.pdf out/weasyprint.pdf out/diff-chrome-weasyprint || true

echo "== Measurements of wkhtmltopdf behavior"
# x/y position of a word on page 1, from pdftotext -bbox.
word() { pdftotext -bbox -f 1 -l 1 "$1" - | grep -m1 ">$2<" | sed -E "s/.*$3=\"([0-9.]+)\".*/\1/" || true; }

wkhtmltopdf -q -T 0 -B 0 -L 0 -R 0 test/fixtures/plain.html out/wk-shrink.pdf
wkhtmltopdf -q -T 0 -B 0 -L 0 -R 0 --disable-smart-shrinking test/fixtures/plain.html out/wk-noshrink.pdf
for f in out/wk-shrink.pdf out/wk-noshrink.pdf; do
  width=$(echo "$(word "$f" RIGHTMARK xMax) - $(word "$f" LEFTMARK xMin)" | bc)
  echo "$f: 400px ruler is $width pt wide (Chrome at scale 1: 300 pt)"
done

wkhtmltopdf -q test/fixtures/modern-css.html out/wk-modern.pdf
echo "flex: FLEXA y=$(word out/wk-modern.pdf FLEXA yMin), FLEXC y=$(word out/wk-modern.pdf FLEXC yMin)"
echo "grid: GRIDA y=$(word out/wk-modern.pdf GRIDA yMin), GRIDC y=$(word out/wk-modern.pdf GRIDC yMin)"

wkhtmltopdf -q -L 10mm test/fixtures/css-margin.html out/wk-css-margin.pdf
echo "css-margin.html with -L 10mm: TOPLEFT x=$(word out/wk-css-margin.pdf TOPLEFT xMin) pt (10mm = 28.3 pt, 30mm = 85 pt)"

wkhtmltopdf -q test/fixtures/plain.html out/wk-default.pdf
echo "default media type: $(pdftotext out/wk-default.pdf - | grep -oE 'SCREENTEXT|PRINTTEXT' | tr '\n' ' ')"
echo "default page: $(pdfinfo out/wk-default.pdf | grep 'Page size')"
echo "default margins: TOPLEFT x=$(word out/wk-default.pdf TOPLEFT xMin) y=$(word out/wk-default.pdf TOPLEFT yMin)"

wkhtmltopdf -q test/fixtures/outside-font.html out/wk-outside-font.pdf || echo "outside-font.html: wkhtmltopdf failed"
echo "outside-font.html fonts (local file access off by default): $(pdffonts out/wk-outside-font.pdf | tail -n +3 | awk '{print $1}' | tr '\n' ' ')"

wkhtmltopdf -q --javascript-delay 2000 test/fixtures/delayed.html out/wk-delayed.pdf
echo "delayed.html with --javascript-delay 2000: $(pdftotext out/wk-delayed.pdf - | grep -oE 'LOADING|CHARTREADY')"

# Temporary: print the comparison images, so that they can be used in the article.
if [ "${GITHUB_ACTIONS:-}" = true ]; then
  for f in out/diff-chrome/page-1.png out/diff-weasyprint/page-1.png out/diff-chrome-weasyprint/page-1.png; do
    echo "::group::base64 $f"
    echo "BEGIN-BASE64 $f"
    base64 -w0 "$f"
    echo
    echo "END-BASE64 $f"
    echo "::endgroup::"
  done
fi

echo "== All checks passed"
