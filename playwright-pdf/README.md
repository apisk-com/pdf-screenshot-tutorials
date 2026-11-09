# Generate PDFs with Playwright in Node.js and Python

This folder shows how to make PDF files from HTML with Playwright `page.pdf()`. It has a Node.js script, the same
script in Python (sync API), and a small FastAPI service with `POST /pdf` (async API). The tutorial explains each
option and the problems that you can get:
[Generate PDFs with Playwright in Node.js and Python](https://apisk.com/blog/playwright-pdf/).

## Files

| File | What it does |
|---|---|
| `report.html` | Sample document: a table, a page break, print CSS and a script that fills the table |
| `node/pdf.js` | `htmlToPdf()`: one HTML string to one PDF buffer |
| `node/make-pdf.js` | Command-line script for Node.js |
| `node/test/pdf.test.js` | Tests (`node --test`) |
| `python/make_pdf.py` | The same script with the Playwright sync API |
| `python/app.py` | FastAPI service with the Playwright async API |
| `python/tests/test_pdf.py` | Tests (`pytest`) |
| `test.sh` | The script that GitHub Actions runs |

## Requirements

- Node.js 22 or later
- Python 3.12 or later
- Playwright 1.65.0 for Node.js and Playwright 1.64.1 for Python (the latest Python release on 9 November 2026)

Playwright makes PDFs only with Chromium. Firefox and WebKit do not support `page.pdf()`.

## Node.js

Install the packages and Chromium:

```bash
cd node
npm ci
npx playwright install chromium
```

Make a PDF of the sample report:

```bash
node make-pdf.js ../report.html out/report.pdf
```

To use the screen CSS instead of the print CSS, add `screen` as the third argument.

Run the tests (one test needs Firefox: `npx playwright install firefox`):

```bash
npm test
```

## Python

Make a virtual environment and install the packages and Chromium:

```bash
cd python
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m playwright install chromium
```

Make a PDF with the sync API:

```bash
.venv/bin/python make_pdf.py ../report.html out/report.pdf
```

Start the service:

```bash
.venv/bin/uvicorn app:app --port 8000
```

Send the sample report to the service from a second terminal:

```bash
jq -Rs '{html: .}' ../report.html | curl -s -H 'Content-Type: application/json' -d @- -o report.pdf http://127.0.0.1:8000/pdf
```

The request body is JSON: `html` (required, at most 2,000,000 characters), `media` (`print` or `screen`), `format`
(`A4`, `Letter` or `Legal`) and `landscape` (`true` or `false`). The service blocks all network requests from the
HTML. If you add a URL input, you must also add protection against SSRF (server-side request forgery).

Run the tests:

```bash
.venv/bin/python -m pytest -q
```

## Linux and CI

On Linux, add `--with-deps` to `playwright install` to install the system libraries. `test.sh` does this and runs
all the tests and examples.
