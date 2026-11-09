// Starts the service with a real Chromium and checks real images.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { imageSize } from 'image-size';
import { startTestPageServer } from './test-page-server.js';

// Short limits, so that the timeout and busy tests run fast. Set them before the import.
process.env.RENDER_TIMEOUT_MS = '2000';
process.env.MAX_OPEN_CONTEXTS = '1';
const { createApp } = await import('../src/app.js');
const { closeBrowser } = await import('../src/render.js');

const API_KEY = 'test-key';
let api; // the screenshot service
let pages; // local test pages, so the tests do not need the internet
let apiUrl;
let pagesUrl;

before(async () => {
  // A stand-in for S3. storage.test.js tests the real upload code.
  const storage = {
    save: async (image, contentType, extension) => ({ bucket: 'test', key: `screenshots/1.${extension}` }),
  };
  api = await listen(createApp({ apiKey: API_KEY, storage }));
  apiUrl = `http://127.0.0.1:${api.address().port}`;
  pages = await startTestPageServer();
  pagesUrl = `http://127.0.0.1:${pages.address().port}`;
});

after(async () => {
  for (const server of [api, pages]) {
    server.closeAllConnections();
    server.close();
  }
  await closeBrowser();
});

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function shoot(params, key = API_KEY) {
  return fetch(`${apiUrl}/screenshot?${new URLSearchParams(params)}`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
}

async function readImage(response, contentType) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), contentType);
  return Buffer.from(await response.arrayBuffer());
}

function sizeOf(image) {
  const { width, height } = imageSize(image);
  return [width, height];
}

test('returns a PNG of the viewport', async () => {
  const png = await readImage(await shoot({ url: `${pagesUrl}/` }), 'image/png');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.deepEqual(sizeOf(png), [1280, 800]);
});

test('returns a JPEG; scale multiplies the pixel size', async () => {
  const response = await shoot({ url: `${pagesUrl}/`, width: 800, height: 600, scale: 2, format: 'jpeg' });
  const jpeg = await readImage(response, 'image/jpeg');
  assert.equal(jpeg.subarray(0, 3).toString('hex'), 'ffd8ff');
  assert.deepEqual(sizeOf(jpeg), [1600, 1200]);
});

test('returns a WebP thumbnail with a scale below 1', async () => {
  const response = await shoot({ url: `${pagesUrl}/`, scale: 0.25, format: 'webp', quality: 60 });
  const webp = await readImage(response, 'image/webp');
  assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
  assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  assert.deepEqual(sizeOf(webp), [320, 200]);
});

test('fullPage captures the whole page, up to 10000 px', async () => {
  const tall = await readImage(await shoot({ url: `${pagesUrl}/tall`, width: 800, fullPage: true }), 'image/png');
  assert.deepEqual(sizeOf(tall), [800, 3000]);
  const veryTall = await readImage(await shoot({ url: `${pagesUrl}/very-tall`, width: 800, fullPage: true }), 'image/png');
  assert.deepEqual(sizeOf(veryTall), [800, 10000]);
});

test('answers 400 for bad input', async () => {
  for (const params of [{}, { url: 'file:///etc/passwd' }, { url: `${pagesUrl}/`, width: 9999 }]) {
    const response = await shoot(params);
    assert.equal(response.status, 400, JSON.stringify(params));
    assert.ok((await response.json()).error);
  }
});

test('answers 401 without the right API key', async () => {
  assert.equal((await shoot({ url: `${pagesUrl}/` }, null)).status, 401);
  assert.equal((await shoot({ url: `${pagesUrl}/` }, 'wrong-key')).status, 401);
});

test('answers 502 when the page cannot be loaded', async () => {
  const response = await shoot({ url: 'http://127.0.0.1:1/' });
  assert.equal(response.status, 502);
});

test('answers 504 when the page is too slow', async () => {
  const response = await shoot({ url: `${pagesUrl}/slow` });
  assert.equal(response.status, 504);
});

test('answers 503 when too many screenshots run', async () => {
  // MAX_OPEN_CONTEXTS is 1. The first request waits for the slow page.
  const first = shoot({ url: `${pagesUrl}/slow` });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const second = await shoot({ url: `${pagesUrl}/` });
  assert.equal(second.status, 503);
  assert.equal((await first).status, 504);
});

test('store=true saves the image and returns its key', async () => {
  const response = await shoot({ url: `${pagesUrl}/`, format: 'webp', store: 'true' });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { bucket: 'test', key: 'screenshots/1.webp' });
});

test('store=true without storage answers 400', async () => {
  const noStorage = await listen(createApp({ apiKey: '', storage: null }));
  const response = await fetch(`http://127.0.0.1:${noStorage.address().port}/screenshot?url=${pagesUrl}/&store=true`);
  noStorage.close();
  assert.equal(response.status, 400);
});
