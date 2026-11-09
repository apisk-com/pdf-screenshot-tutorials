import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { chromium, firefox } from 'playwright';
import { htmlToPdf } from '../pdf.js';

const report = await readFile(new URL('../../report.html', import.meta.url), 'utf8');
let browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
});

async function loadPdf(bytes) {
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  return PDFDocument.load(bytes);
}

function pageSize(doc) {
  const { width, height } = doc.getPage(0).getSize();
  return [Math.round(width), Math.round(height)];
}

test('renders the report as a 3-page A4 PDF', async () => {
  const doc = await loadPdf(await htmlToPdf(browser, report));
  assert.equal(doc.getPageCount(), 3);
  assert.deepEqual(pageSize(doc), [596, 843]);
});

test('screen media renders too', async () => {
  const doc = await loadPdf(await htmlToPdf(browser, report, { media: 'screen' }));
  assert.equal(doc.getPageCount(), 3);
});

test('landscape Letter swaps width and height', async () => {
  const doc = await loadPdf(await htmlToPdf(browser, report, { format: 'Letter', landscape: true }));
  assert.deepEqual(pageSize(doc), [792, 612]);
});

test('preferCSSPageSize lets the CSS @page size win over format', async () => {
  const html = '<style>@page { size: A5; }</style><p>Small page</p>';
  const a4 = await loadPdf(await htmlToPdf(browser, html));
  const a5 = await loadPdf(await htmlToPdf(browser, html, { preferCSSPageSize: true }));
  assert.deepEqual(pageSize(a4), [596, 843]);
  assert.deepEqual(pageSize(a5), [420, 595]);
});

test('a render that takes too long fails with a clear error', async () => {
  await assert.rejects(htmlToPdf(browser, report, { pdfTimeout: 1 }), /took longer than 1 ms/);
});

test('page.pdf() is not available in Firefox', async () => {
  const otherBrowser = await firefox.launch();
  try {
    const page = await otherBrowser.newPage();
    await assert.rejects(page.pdf(), /PDF generation is only supported for Headless Chromium/);
  } finally {
    await otherBrowser.close();
  }
});
