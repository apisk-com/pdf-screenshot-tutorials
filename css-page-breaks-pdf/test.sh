#!/usr/bin/env bash
# CI entry point (GitHub Actions, ubuntu-24.04). Installs Chrome, Chromium,
# WeasyPrint and poppler. Renders every test document in the three engines
# and checks on which page each marker word lands.
set -euo pipefail
cd "$(dirname "$0")"

echo "== System packages: poppler, Pango for WeasyPrint, Liberation fonts"
sudo apt-get update -qq
sudo apt-get install -y -qq poppler-utils fonts-liberation \
  libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 libharfbuzz0b

echo "== Node.js packages, Chrome for Puppeteer, Chromium for Playwright"
npm ci
npx playwright install --with-deps chromium

echo "== Python packages"
python -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt

echo "== Versions"
node --input-type=module -e "
  import puppeteer from 'puppeteer';
  import { chromium } from 'playwright';
  const a = await puppeteer.launch(); console.log('Puppeteer:', await a.version()); await a.close();
  const b = await chromium.launch(); console.log('Playwright: Chromium', b.version()); await b.close();"
python -c "import weasyprint; print('WeasyPrint', weasyprint.__version__)"
pdftotext -v 2>&1 | head -1

echo "== Tests"
npm test
pytest -q

echo "== Render the report without and with print.css"
rm -rf out
node render.mjs report.html out/chrome-before.pdf
node render.mjs report.html out/chrome-after.pdf print.css
node render.mjs report.html out/playwright-after.pdf print.css --playwright
python render_weasyprint.py report.html out/weasyprint-before.pdf
python render_weasyprint.py report.html out/weasyprint-after.pdf print.css
for f in out/*.pdf; do
  head -c 5 "$f" | grep -q '%PDF-' || { echo "Not a PDF: $f"; exit 1; }
  echo "$f: $(pdfinfo "$f" | grep '^Pages' | tr -s ' ')"
done

echo "== All checks passed"
