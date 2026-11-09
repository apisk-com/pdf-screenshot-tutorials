# HTML to PDF API with Node.js and Puppeteer

A small HTTP service that converts HTML, a Handlebars template or a web page URL
to PDF. It uses Express 5 and one shared headless Chrome that Puppeteer
controls. Each request gets its own browser page, and the service streams the
PDF back. The tutorial explains each file:
[Build an HTML to PDF API with Node.js and Puppeteer](https://apisk.com/blog/html-to-pdf-api-nodejs/).

## Requirements

- Node.js 22.12 or later (Puppeteer 25 needs it).
- macOS, Linux or Windows. `npm ci` downloads Chrome for Puppeteer.
- On Linux, the `unzip` command. Puppeteer uses it to unpack Chrome.
- Docker, only if you want to run the container.

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

The service listens on port 3000. Set `PORT` to use a different port.

## Example request

```bash
curl -X POST http://localhost:3000/pdf -H "Content-Type: application/json" -d @examples/invoice.json -o invoice.pdf
```

Send exactly one source in the JSON body:

| Field | Type | What it does |
|---|---|---|
| `html` | string | Renders this HTML. |
| `template` and `data` | string and object | Fills the template in `templates/` with `data`. Handlebars escapes the values. |
| `url` | string | Opens this `http` or `https` page and prints it. |

`options` is optional:

| Option | Default | Values |
|---|---|---|
| `format` | `A4` | `A3`, `A4`, `A5`, `Letter`, `Legal`, `Tabloid` |
| `landscape` | `false` | `true` or `false` |
| `printBackground` | `true` | `true` or `false` |
| `preferCSSPageSize` | `false` | `true` uses the CSS `@page` size |
| `margin` | `15mm` on each side | `top`, `right`, `bottom`, `left` as `mm`, `cm`, `in` or `px` |

## Limits

| Limit | Value | Environment variable |
|---|---|---|
| Request body | 1 MB (status 413) | none, see `src/app.js` |
| Time to load and print | 20,000 ms for each step (status 504) | `RENDER_TIMEOUT_MS` |
| Pages open at the same time | 4 (status 503) | `MAX_OPEN_PAGES` |

The `url` source and the `html` source can make the server open addresses in
your own network (SSRF, server-side request forgery). Do not expose this
service to the internet before you add SSRF protection.

## Docker

```bash
docker build -t html-to-pdf-api-nodejs .
```

```bash
docker run --rm --init --cap-add=SYS_ADMIN -p 3000:3000 html-to-pdf-api-nodejs
```

`--init` stops the Chrome child processes. `--cap-add=SYS_ADMIN` lets Chrome
start its sandbox inside the container.

## Files

- `src/server.js` starts Chrome and the HTTP server.
- `src/app.js` has the routes, the body limit and the error responses.
- `src/validate.js` turns the request body into a render job.
- `src/templates.js` and `templates/invoice.hbs` hold the invoice template.
- `src/render.js` opens a page, loads the content and streams the PDF.
- `test/api.test.js` starts the service and checks the PDFs and the errors.
- `test.sh` is the CI entry point. It also builds and tests the Docker image.
