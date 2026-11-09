import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import puppeteer from 'puppeteer';
import { renderPdf } from '../render-chrome.mjs';

const dir = mkdtempSync(join(tmpdir(), 'wk-diff-'));
let browser;

before(async () => {
  browser = await puppeteer.launch();
  writeFileSync(join(dir, 'a.pdf'), await renderPdf(browser, 'document/invoice.html'));
  writeFileSync(join(dir, 'b.pdf'), await renderPdf(browser, 'document/invoice.html', { pdf: { scale: 0.8 } }));
});

after(async () => {
  await browser.close();
});

function diff(a, b, out) {
  return spawnSync('node', ['diff-pdfs.mjs', join(dir, a), join(dir, b), join(dir, out)], { encoding: 'utf8' });
}

test('the same PDF twice: 0% changed and exit code 0', () => {
  const result = diff('a.pdf', 'a.pdf', 'same');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /page 1: 0\.00% of pixels changed/);
  assert.ok(existsSync(join(dir, 'same', 'page-1.png')));
});

test('a changed PDF: pixels changed and exit code 1', () => {
  const result = diff('a.pdf', 'b.pdf', 'changed');
  assert.equal(result.status, 1, result.stderr);
  const percent = Number(result.stdout.match(/page 1: ([\d.]+)%/)[1]);
  assert.ok(percent > 1, `${percent}%`);
});
