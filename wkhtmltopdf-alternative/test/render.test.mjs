// Each test checks one row of the wkhtmltopdf to page.pdf() mapping table.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PDFDocument, PDFName } from 'pdf-lib';
import puppeteer from 'puppeteer';
import { PDF_OPTIONS, renderPdf } from '../render-chrome.mjs';
import { fonts, pixel, text, wordBox } from './pdf-tools.mjs';

const MM = 72 / 25.4; // points in one millimetre
let browser;

before(async () => {
  browser = await puppeteer.launch();
});

after(async () => {
  await browser.close();
});

async function pageSize(pdf, index = 0) {
  const doc = await PDFDocument.load(pdf);
  return { count: doc.getPageCount(), ...doc.getPage(index).getSize() };
}

test('the invoice renders as an A4 PDF with page numbers and a header', async () => {
  const pdf = await renderPdf(browser, 'document/invoice.html');
  assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), '%PDF-');
  const { count, width, height } = await pageSize(pdf);
  assert.equal(count, 2);
  assert.ok(Math.abs(width - 595) < 2 && Math.abs(height - 842) < 2, `${width} x ${height}`);
  const content = text(pdf);
  assert.match(content, /Page 1 of 2/);
  assert.match(content, /Page 2 of 2/);
  assert.equal(content.match(/^\s*Lumen Data Ltd\s*$/gm).length, 2); // header on each page
  assert.doesNotMatch(content, /Pay online/); // print media hides the button
  assert.match(fonts(pdf), /Inter-Regular/); // the local web font loaded
});

test('--page-size A4: format A4 (the default is Letter)', async () => {
  const letter = await renderPdf(browser, 'test/fixtures/plain.html', { pdf: { format: undefined } });
  const a4 = await renderPdf(browser, 'test/fixtures/plain.html', { pdf: { format: 'A4' } });
  assert.equal(Math.round((await pageSize(letter)).width), 612);
  assert.equal(Math.round((await pageSize(a4)).width), 596);
});

test('-O Landscape: landscape true', async () => {
  const pdf = await renderPdf(browser, 'test/fixtures/plain.html', { pdf: { landscape: true } });
  const { width, height } = await pageSize(pdf);
  assert.ok(width > height);
});

test('-T -B -L -R: the margin option, when the CSS has no @page margin', async () => {
  const pdf = await renderPdf(browser, 'test/fixtures/plain.html', {
    pdf: { margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } },
  });
  const box = wordBox(pdf, 'TOPLEFT');
  assert.ok(Math.abs(box.xMin - 15 * MM) < 2, `left edge at ${box.xMin} pt`);
  assert.ok(box.yMin > 20 * MM && box.yMin < 20 * MM + 20, `top edge at ${box.yMin} pt`);
});

test('a CSS @page margin wins over the margin option', async () => {
  const pdf = await renderPdf(browser, 'test/fixtures/css-margin.html', {
    pdf: { margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } },
  });
  const box = wordBox(pdf, 'TOPLEFT');
  assert.ok(Math.abs(box.xMin - 30 * MM) < 2, `left edge at ${box.xMin} pt`);
});

test('--header-html and --footer-center [page]/[topage]: header and footer templates', async () => {
  const pdf = await renderPdf(browser, 'test/fixtures/long.html', {
    pdf: {
      margin: { top: '20mm', bottom: '20mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div style="font-size:9px; margin-left:15mm">Lumen Data Ltd</div>',
      footerTemplate:
        '<div style="font-size:9px; width:100%; text-align:center">' +
        '<span class="pageNumber"></span>/<span class="totalPages"></span></div>',
    },
  });
  const { count } = await pageSize(pdf);
  assert.ok(count >= 2);
  const content = text(pdf);
  assert.match(content, new RegExp(`\\b1/${count}\\b`));
  assert.match(content, new RegExp(`\\b${count}/${count}\\b`));
  assert.equal(content.match(/Lumen Data Ltd/g).length, count);
});

test('--background: printBackground true (the Puppeteer default is false)', async () => {
  // The red bar starts below the first line, at about 30 pt from the top.
  const withBackground = await renderPdf(browser, 'test/fixtures/plain.html');
  const without = await renderPdf(browser, 'test/fixtures/plain.html', { pdf: { printBackground: false } });
  assert.deepEqual(pixel(withBackground, 100, 80), [200, 0, 0]);
  assert.deepEqual(pixel(without, 100, 80), [255, 255, 255]);
});

test('--print-media-type is the default; emulateMediaType("screen") gives the old default', async () => {
  const print = text(await renderPdf(browser, 'test/fixtures/plain.html'));
  assert.match(print, /PRINTTEXT/);
  assert.doesNotMatch(print, /SCREENTEXT/);

  const page = await browser.newPage();
  try {
    await page.goto(new URL('../test/fixtures/plain.html', import.meta.url).href);
    await page.emulateMediaType('screen');
    const screen = text(await page.pdf(PDF_OPTIONS));
    assert.match(screen, /SCREENTEXT/);
    assert.doesNotMatch(screen, /PRINTTEXT/);
  } finally {
    await page.close();
  }
});

test('--zoom: scale (from 0.1 to 2)', async () => {
  const width = async (scale) => {
    const pdf = await renderPdf(browser, 'test/fixtures/plain.html', { pdf: { scale } });
    return wordBox(pdf, 'RIGHTMARK').xMax - wordBox(pdf, 'LEFTMARK').xMin;
  };
  // The ruler is 400 CSS pixels wide: 300 pt at scale 1.
  assert.ok(Math.abs((await width(1)) - 300) < 2);
  assert.ok(Math.abs((await width(0.8)) - 240) < 2);
});

test('--window-status / --javascript-delay: wait for the page before page.pdf()', async () => {
  const early = text(await renderPdf(browser, 'test/fixtures/delayed.html'));
  assert.match(early, /LOADING/); // load event fired before the script finished
  const ready = text(await renderPdf(browser, 'test/fixtures/delayed.html', { windowStatus: 'ready' }));
  assert.match(ready, /CHARTREADY/);
});

test('--enable-local-file-access: a file:// page loads files, also outside its folder', async () => {
  const pdf = await renderPdf(browser, 'test/fixtures/outside-font.html');
  assert.match(fonts(pdf), /Inter/);
});

test('page.setContent() cannot load file:// resources', async () => {
  const fontUrl = new URL('../document/fonts/inter-latin-400-normal.woff2', import.meta.url).href;
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<style>@font-face { font-family: "Inter"; src: url("${fontUrl}"); }
       body { font-family: "Inter", sans-serif; }</style><p>No local font</p>`,
    );
    assert.doesNotMatch(fonts(await page.pdf(PDF_OPTIONS)), /Inter/);
  } finally {
    await page.close();
  }
});

test('flex and grid items share one line; margin boxes print', async () => {
  const pdf = await renderPdf(browser, 'test/fixtures/modern-css.html');
  assert.equal(wordBox(pdf, 'FLEXA').yMin, wordBox(pdf, 'FLEXC').yMin);
  assert.equal(wordBox(pdf, 'GRIDA').yMin, wordBox(pdf, 'GRIDC').yMin);
  assert.match(text(pdf), /MARGINBOXTEXT/);
});

test('Chrome prints no margin box when the page margin is 0', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<style>@page { margin: 0; @bottom-center { content: "MARGINBOXTEXT"; } }</style><p>Body</p>');
    assert.doesNotMatch(text(await page.pdf(PDF_OPTIONS)), /MARGINBOXTEXT/);
  } finally {
    await page.close();
  }
});

test('--outline: outline true adds PDF bookmarks', async () => {
  const pdf = await renderPdf(browser, 'test/fixtures/plain.html');
  const doc = await PDFDocument.load(pdf);
  assert.ok(doc.catalog.get(PDFName.of('Outlines')));
  const plain = await PDFDocument.load(await renderPdf(browser, 'test/fixtures/plain.html', { pdf: { outline: false } }));
  assert.equal(plain.catalog.get(PDFName.of('Outlines')), undefined);
});
