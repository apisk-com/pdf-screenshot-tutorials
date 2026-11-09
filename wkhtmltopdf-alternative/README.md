# Replace wkhtmltopdf with Chrome or WeasyPrint

This folder holds the code for the tutorial
[Replace wkhtmltopdf: Migrate to Chrome or WeasyPrint](https://apisk.com/blog/wkhtmltopdf-alternative/).
It renders one invoice with the old wkhtmltopdf command, with headless Chrome
(Puppeteer) and with WeasyPrint. Then it compares the old PDF and a new PDF
page by page and writes an image of the differences.

## Requirements

- Node.js 22.12 or later
- Python 3.12 or later (for WeasyPrint)
- poppler-utils: `pdftoppm`, `pdftotext`, `pdfinfo` and `pdffonts`
- Pango 1.44 or later (for WeasyPrint)
- wkhtmltopdf 0.12.6, only to render the old PDF

## Files

| File | Purpose |
|---|---|
| `render-wkhtmltopdf.sh` | The old command, with the flags that the tutorial maps |
| `render-chrome.mjs` | Renders an HTML file with Puppeteer and `page.pdf()` |
| `render_weasyprint.py` | Renders an HTML file with WeasyPrint; loads files from one folder only |
| `diff-pdfs.mjs` | Compares two PDFs page by page with `pdftoppm` and pixelmatch |
| `document/` | The sample invoice: HTML, layout CSS, `@page` rules, header for wkhtmltopdf, fonts |
| `test/` | Node tests (`node --test`) and HTML fixtures |
| `tests/` | Python tests (`pytest`) |
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

Render the old PDF (needs wkhtmltopdf):

```bash
./render-wkhtmltopdf.sh document/invoice.html out/wkhtmltopdf.pdf
```

Render the new PDFs:

```bash
node render-chrome.mjs document/invoice.html out/chrome.pdf
```

```bash
python render_weasyprint.py document/invoice.html out/weasyprint.pdf
```

Compare the old PDF and a new PDF. The script writes one image for each page
(old, new, changed pixels in red) and prints the share of changed pixels. The
exit code is 1 when the page count is different or a page changed more than
the limit (default 1%).

```bash
node diff-pdfs.mjs out/wkhtmltopdf.pdf out/chrome.pdf out/diff
```

## Test

```bash
npm test
```

```bash
pytest
```

`test.sh` installs the system packages with `sudo apt-get`, so run it only on a
CI machine or a disposable Ubuntu 24.04 machine. It installs the last upstream
wkhtmltopdf build (0.12.6.1, patched Qt), runs the Node and Python tests,
renders the invoice with the three engines and runs the visual diff. It also
makes sure that wkhtmltopdf still shows the defaults that the tutorial
describes: smart shrinking to 0.8, screen media, no flexbox or grid, no WOFF2
fonts and no `@page` margin boxes.

## License

The code is MIT (see the root `LICENSE`). The Inter font files in
`document/fonts/` use the SIL Open Font License 1.1 (`document/fonts/OFL.txt`).
