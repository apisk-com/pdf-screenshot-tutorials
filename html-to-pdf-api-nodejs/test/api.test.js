import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { PDFDocument } from 'pdf-lib';

// A short timeout, so that the timeout test runs fast. Set it before the import.
process.env.RENDER_TIMEOUT_MS = '3000';
const { createApp } = await import('../src/app.js');
const { closeBrowser } = await import('../src/render.js');
const { templates } = await import('../src/templates.js');

let api;
let pages;
let baseUrl;
let pagesUrl;

before(async () => {
  api = createApp().listen(0);
  baseUrl = `http://127.0.0.1:${api.address().port}`;

  // A local web page for the URL tests. "/slow" never answers.
  pages = createServer((req, res) => {
    if (req.url === '/slow') return;
    res.setHeader('Content-Type', 'text/html');
    res.end('<h1>Served page</h1>');
  }).listen(0);
  pagesUrl = `http://127.0.0.1:${pages.address().port}`;
});

after(async () => {
  pages.closeAllConnections();
  pages.close();
  api.close();
  await closeBrowser();
});

function postPdf(body) {
  return fetch(`${baseUrl}/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function readPdf(res) {
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  return PDFDocument.load(bytes);
}

test('renders HTML to an A4 PDF', async () => {
  const pdf = await readPdf(await postPdf({ html: '<h1>Hello</h1>' }));
  assert.equal(pdf.getPageCount(), 1);
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - 595) < 2 && Math.abs(height - 842) < 2);
});

test('applies format, landscape and CSS page breaks', async () => {
  const html = '<p>One</p><p style="break-before: page">Two</p><p style="break-before: page">Three</p>';
  const pdf = await readPdf(await postPdf({ html, options: { format: 'Letter', landscape: true } }));
  assert.equal(pdf.getPageCount(), 3);
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - 792) < 2 && Math.abs(height - 612) < 2);
});

test('renders the invoice template from the example request', async () => {
  const body = await readFile(new URL('../examples/invoice.json', import.meta.url), 'utf8');
  const pdf = await readPdf(await postPdf(body));
  assert.equal(pdf.getPageCount(), 1);
});

test('the template escapes HTML in the data', async () => {
  const { data } = JSON.parse(
    await readFile(new URL('../examples/invoice.json', import.meta.url), 'utf8'),
  );
  data.customer.name = '<script>alert(1)</script>';
  const html = templates.invoice(data);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
});

test('renders a URL', async () => {
  const pdf = await readPdf(await postPdf({ url: `${pagesUrl}/` }));
  assert.equal(pdf.getPageCount(), 1);
});

test('returns 504 when the page does not load in time', async () => {
  const res = await postPdf({ url: `${pagesUrl}/slow` });
  assert.equal(res.status, 504);
});

const badRequests = [
  ['no source', {}],
  ['two sources', { html: '<p>x</p>', url: 'https://example.com/' }],
  ['empty HTML', { html: ' ' }],
  ['a file URL', { url: 'file:///etc/passwd' }],
  ['a relative URL', { url: '/admin' }],
  ['an unknown template', { template: 'letter' }],
  ['template data that does not match', { template: 'invoice', data: { number: '1' } }],
  ['an unknown format', { html: '<p>x</p>', options: { format: 'B5' } }],
  ['a bad margin', { html: '<p>x</p>', options: { margin: { top: '1em' } } }],
  ['a string for a boolean', { html: '<p>x</p>', options: { landscape: 'yes' } }],
  ['an option that is not allowed', { html: '<p>x</p>', options: { path: '/tmp/x.pdf' } }],
  ['JSON that does not parse', '{"html": '],
];

for (const [name, body] of badRequests) {
  test(`returns 400 for ${name}`, async () => {
    const res = await postPdf(body);
    assert.equal(res.status, 400);
    assert.equal(typeof (await res.json()).error, 'string');
  });
}

test('returns 400 when the Content-Type is not JSON', async () => {
  const res = await fetch(`${baseUrl}/pdf`, { method: 'POST', body: '<h1>Hi</h1>' });
  assert.equal(res.status, 400);
});

test('returns 413 for a body over 1 MB', async () => {
  const res = await postPdf({ html: 'x'.repeat(1_100_000) });
  assert.equal(res.status, 413);
});
