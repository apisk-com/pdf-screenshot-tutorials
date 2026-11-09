# Website screenshot API with Node.js and Playwright

A small HTTP service that takes a screenshot of a web page from its URL and
returns a PNG, JPEG or WebP image. It uses Express 5 and one shared Chromium
browser from Playwright, with a new browser context for each request. It can
also save the image in Amazon S3 or Cloudflare R2. The tutorial explains each
file: [Build a Website Screenshot API with Node.js and Playwright](https://apisk.com/blog/screenshot-api-nodejs/).

## Requirements

- Node.js 22 or later
- Chromium for Playwright 1.65 (the install step downloads it)
- Docker, only for the container

## Install

```bash
npm ci
```

```bash
npx playwright install --only-shell chromium
```

On Linux, add `--with-deps` to the second command to install the system libraries.

## Run

```bash
API_KEY=change-me npm start
```

The service listens on port 3000. Set `PORT` to use a different port. If
`API_KEY` is not set, the service accepts requests without a key.

## Example request

Start the local test page in a second terminal:

```bash
npm run test-page
```

Then get a 1200 x 630 WebP screenshot of it:

```bash
curl -H "Authorization: Bearer change-me" -o preview.webp "http://localhost:3000/screenshot?url=http://127.0.0.1:8080/&width=1200&height=630&format=webp"
```

## Parameters of GET /screenshot

| Parameter | Values | Default |
|---|---|---|
| `url` | An `http://` or `https://` URL, at most 2048 characters | required |
| `width` | Viewport width in CSS pixels, 320 to 1920 | 1280 |
| `height` | Viewport height in CSS pixels, 240 to 1920 | 800 |
| `scale` | Device scale factor, 0.25 to 3 | 1 |
| `format` | `png`, `jpeg` or `webp` | `png` |
| `quality` | 1 to 100, only for `jpeg` and `webp` | 80 |
| `fullPage` | `true` or `false`; the image stops at 10000 CSS pixels | `false` |
| `store` | `true` saves the image in S3 and returns JSON | `false` |

Answers: 200 with the image, 201 with `{ "bucket", "key" }` for `store=true`,
400 for bad input, 401 for a missing or wrong key, 502 when the page does not
load, 503 when too many screenshots run, 504 when the page is too slow.

The service accepts only `http:` and `https:` URLs, but it does not block
private network addresses. Before you open it to other people, add SSRF
protection (SSRF: server-side request forgery).

## Environment variables

| Variable | Use |
|---|---|
| `PORT` | HTTP port, default 3000 |
| `API_KEY` | Key that clients send as `Authorization: Bearer <key>` |
| `RENDER_TIMEOUT_MS` | Time limit for page load and for the screenshot, default 15000 |
| `MAX_OPEN_CONTEXTS` | Screenshots at the same time, default 4; more get status 503 |
| `CHROMIUM_SANDBOX` | `false` turns off the Chromium sandbox; use it only for pages you trust |
| `S3_BUCKET` | Turns on `store=true` and names the bucket |
| `S3_REGION` | Bucket region; default `auto` for Cloudflare R2 |
| `S3_ENDPOINT` | For R2: `https://<account id>.r2.cloudflarestorage.com` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Storage credentials |

## Test

```bash
npm test
```

The tests start Chromium, a local test page server and the service, and
check real images. `test.sh` is the CI script: it also builds the Docker
image and sends requests to the container.

## Docker

```bash
docker build -t screenshot-api-nodejs .
```

```bash
docker run --init --cap-add=SYS_ADMIN -p 3000:3000 -e API_KEY=change-me screenshot-api-nodejs
```

`--init` stops the Chromium child processes. `--cap-add=SYS_ADMIN` lets
Chromium start its sandbox as the non-root user `pwuser`.
