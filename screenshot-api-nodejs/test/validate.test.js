import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseScreenshotRequest } from '../src/validate.js';

test('uses defaults for everything except url', () => {
  assert.deepEqual(parseScreenshotRequest({ url: 'https://example.com' }), {
    url: 'https://example.com/',
    width: 1280,
    height: 800,
    scale: 1,
    format: 'png',
    quality: undefined,
    fullPage: false,
    store: false,
  });
});

test('reads all parameters', () => {
  const options = parseScreenshotRequest({
    url: 'http://example.com/a?b=1', width: '390', height: '844', scale: '2',
    format: 'jpeg', quality: '70', fullPage: 'true',
  });
  assert.equal(options.width, 390);
  assert.equal(options.height, 844);
  assert.equal(options.scale, 2);
  assert.equal(options.format, 'jpeg');
  assert.equal(options.quality, 70);
  assert.equal(options.fullPage, true);
});

test('gives jpeg and webp a default quality of 80', () => {
  assert.equal(parseScreenshotRequest({ url: 'https://example.com', format: 'webp' }).quality, 80);
});

test('rejects bad input with status 400', () => {
  const bad = [
    {},
    { url: 'not a url' },
    { url: 'file:///etc/passwd' },
    { url: 'javascript:alert(1)' },
    { url: `https://example.com/${'a'.repeat(2048)}` },
    { url: 'https://example.com', width: '5000' },
    { url: 'https://example.com', width: '800.5' },
    { url: 'https://example.com', width: '' },
    { url: 'https://example.com', width: ['800', '900'] },
    { url: 'https://example.com', scale: '0' },
    { url: 'https://example.com', format: 'gif' },
    { url: 'https://example.com', quality: '80' },
    { url: 'https://example.com', format: 'jpeg', quality: '101' },
    { url: 'https://example.com', fullPage: 'yes' },
  ];
  for (const query of bad) {
    assert.throws(() => parseScreenshotRequest(query), { status: 400 }, JSON.stringify(query));
  }
});
