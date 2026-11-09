# Markdown to PDF API with Node.js

A small HTTP service that converts Markdown to PDF. It turns the Markdown into
HTML with markdown-it, colors code blocks with highlight.js, adds a print
stylesheet and prints the page with headless Chrome through Puppeteer. Raw HTML
in the Markdown is printed as text, and the render step makes no network
requests. Read the full tutorial:
[Markdown to PDF with Node.js: Build a Conversion API](https://apisk.com/blog/markdown-to-pdf-api/).

## Requirements

- Node.js 22.12 or later (Puppeteer 25 needs it)
- Disk space for the browsers that Puppeteer downloads on `npm ci`
  (Chrome and Chrome Headless Shell, about 570 MB on an Apple Silicon Mac)
- On Linux: a color emoji font, for example `fonts-noto-color-emoji`

## Install, run and test

```bash
npm ci
```

```bash
npm start
```

```bash
npm test
```

The service listens on port 3000. To use another port, set `PORT`.

## Example request

Send a Markdown file as the request body:

```bash
curl -X POST http://localhost:3000/markdown \
  -H 'Content-Type: text/markdown' \
  --data-binary @examples/release-notes.md \
  -o release-notes.pdf
```

Send JSON with options:

```bash
curl -X POST http://localhost:3000/markdown \
  -H 'Content-Type: application/json' \
  -d '{"markdown": "# Hello\n\nFirst page.", "format": "Letter", "breakBefore": "h2"}' \
  -o hello.pdf
```

| Option | Values | Default |
|---|---|---|
| `format` | `A4`, `Letter`, `Legal` | `A4` |
| `breakBefore` | `none`, `h1`, `h2` | `none` |

For a `text/markdown` body, put the options in the query string, for example
`/markdown?format=Letter&breakBefore=h1`. A paragraph that contains only
`\newpage` starts a new page.

## Tests

The tests start the service and Chrome, convert Markdown, and make sure that
the output is a PDF with the correct number of pages. They also make sure that
bad input gets status 400, 413 or 415, and that the render step sends no
network requests.

`test.sh` is the script that GitHub Actions runs on Ubuntu 24.04. It installs
the emoji font, runs the tests and converts the two files in `examples/` with
curl.

## Files

| File | Purpose |
|---|---|
| `src/markdown.js` | Markdown to a complete HTML document |
| `src/print.css` | Print stylesheet |
| `src/render.js` | One shared Chrome, one page per request, PDF output |
| `src/app.js` | Express app with `POST /markdown` and `GET /health` |
| `src/server.js` | Starts Chrome and the HTTP server |
| `test/api.test.js` | Tests with `node --test` |
