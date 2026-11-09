#!/usr/bin/env bash
# The old command: render an HTML file with wkhtmltopdf 0.12.6.
# Usage: ./render-wkhtmltopdf.sh document/invoice.html out/wkhtmltopdf.pdf
set -euo pipefail

wkhtmltopdf \
  --page-size A4 \
  --margin-top 20mm --margin-bottom 20mm \
  --margin-left 15mm --margin-right 15mm \
  --print-media-type \
  --enable-local-file-access \
  --header-html document/header.html \
  --header-spacing 5 \
  --footer-center "Page [page] of [topage]" \
  --footer-font-size 8 \
  --footer-spacing 5 \
  "$1" "$2"
