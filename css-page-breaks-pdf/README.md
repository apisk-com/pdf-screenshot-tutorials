# CSS page breaks for HTML to PDF

This folder holds the code for the tutorial
[CSS Page Breaks for HTML to PDF: Tables, Rows, Headings](https://apisk.com/blog/css-page-breaks-pdf/).
It has one small HTML test document for each page break rule. The tests
render each document in Chrome (Puppeteer), in Chromium (Playwright) and in
WeasyPrint, without and with the rule. Then they read the text of each PDF
page and make sure that each marker word is on the expected page.

## Requirements

- Node.js 22.12 or later
- Python 3.12 or later and Pango 1.44 or later (for WeasyPrint)
- poppler-utils: `pdftotext` and `pdfinfo` (the Node tests use them)

## Files

| File | Purpose |
|---|---|
| `print.css` | The page break rules for your own documents |
| `report.html` | A sample report with a split row, a lonely heading and a repeated total |
| `render.mjs` | Renders an HTML file with Puppeteer or Playwright, with an optional extra stylesheet |
| `render_weasyprint.py` | Renders an HTML file with WeasyPrint, with an optional extra stylesheet |
| `pages.mjs` | Reads the text and the size of each PDF page with poppler |
| `cases/*.html` | The test documents: A5 pages, 20px lines, marker words such as `R04TOP` |
| `cases/cases.json` | For each case: the document, the fix and the expected pages in each engine |
| `test/chrome.test.mjs` | Node tests for Puppeteer and Playwright (`node --test`) |
| `tests/test_weasyprint.py` | Python tests for WeasyPrint (`pytest`, reads the PDF with pypdf) |
| `test.sh` | The CI script for GitHub Actions on Ubuntu 24.04 |

## Install

```bash
npm ci
```

```bash
python -m venv .venv
```

```bash
. .venv/bin/activate
```

```bash
pip install -r requirements.txt
```

## Run

Render the sample report without the page break rules:

```bash
node render.mjs report.html out/before.pdf
```

Render it with `print.css`:

```bash
node render.mjs report.html out/after.pdf print.css
```

Add `--playwright` to use Playwright instead of Puppeteer. The WeasyPrint
script takes the same arguments:

```bash
python render_weasyprint.py report.html out/after-weasyprint.pdf print.css
```

## Test

```bash
npm test
```

```bash
pytest
```

Each entry in `cases/cases.json` names a test document, a fix (CSS that the
test adds at the end of `<head>`) and the pages on which each marker word
appears, without and with the fix. The key `chrome` is for Puppeteer and
Playwright, the key `weasyprint` is for WeasyPrint.

`test.sh` installs the system packages with `sudo apt-get`, so run it only on a
CI machine or a disposable Ubuntu 24.04 machine.

## License

MIT. See the root `LICENSE`.
