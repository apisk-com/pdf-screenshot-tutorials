import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { createApp } from '../src/app.js';
import { cleanMarkdown, markdownToHtml } from '../src/markdown.js';
import { closeBrowser, renderPdf } from '../src/render.js';

let api;
let baseUrl;

before(async () => {
  api = createApp().listen(0, '127.0.0.1');
  await once(api, 'listening');
  baseUrl = `http://127.0.0.1:${api.address().port}`;
});

after(async () => {
  api.close();
  await closeBrowser();
});

function convert(body, type = 'application/json', query = '') {
  return fetch(`${baseUrl}/markdown${query}`, {
    method: 'POST',
    headers: { 'Content-Type': type },
    body: type === 'application/json' ? JSON.stringify(body) : body,
  });
}

async function loadPdf(response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  return PDFDocument.load(bytes);
}

test('JSON body: one page, first heading is the PDF title', async () => {
  const pdf = await loadPdf(await convert({ markdown: '# Report\n\nHello **world**.' }));
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getTitle(), 'Report');
});

test('text/markdown body: breakBefore=h1 starts each h1 on a new page', async () => {
  const markdown = '# One\n\nA\n\n# Two\n\nB\n\n# Three\n\nC';
  const pdf = await loadPdf(await convert(markdown, 'text/markdown', '?breakBefore=h1'));
  assert.equal(pdf.getPageCount(), 3);
});

test('\\newpage starts a new page', async () => {
  const pdf = await loadPdf(await convert({ markdown: 'Page one\n\n\\newpage\n\nPage two' }));
  assert.equal(pdf.getPageCount(), 2);
});

test('raw HTML and javascript: links are printed as text', () => {
  const html = markdownToHtml('<script>alert(1)</script>\n\n[click](javascript:alert(1))');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test('code fences get highlight.js classes', () => {
  assert.match(markdownToHtml('```js\nconst a = 1;\n```'), /hljs-keyword/);
});

test('<br> breaks a line in a table cell, nowhere else', () => {
  const html = markdownToHtml('| A |\n|---|\n| one<br>two |\n\nText <br> here');
  assert.match(html, /one<br>\ntwo/);
  assert.match(html, /Text &lt;br&gt; here/);
});

test('front matter and an outer ```markdown fence are removed', () => {
  assert.equal(cleanMarkdown('---\ntitle: Notes\n---\n# Hi'), '# Hi');
  assert.equal(cleanMarkdown('```markdown\n# Hi\n\nText\n```'), '# Hi\n\nText');
  assert.equal(cleanMarkdown('```js\nx = 1\n```'), '```js\nx = 1\n```');
});

test('the render makes no network requests', async () => {
  let hits = 0;
  const target = createServer((req, res) => {
    hits += 1;
    res.end();
  });
  target.listen(0, '127.0.0.1');
  await once(target, 'listening');
  const url = `http://127.0.0.1:${target.address().port}/secret.png`;

  // A Markdown image prints its alt text.
  await loadPdf(await convert({ markdown: `![secret](${url})` }));
  // An <img> tag in the HTML: only the request filter in render.js stops it.
  await renderPdf(`<img src="${url}">`);

  target.close();
  assert.equal(hits, 0);
});

test('bad input gets 400, 413 and 415', async () => {
  assert.equal((await convert({ markdown: '   ' })).status, 400);
  assert.equal((await convert({ markdown: '# A', format: 'A5' })).status, 400);
  assert.equal((await convert('# A', 'text/markdown', '?breakBefore=h3')).status, 400);
  assert.equal((await convert({ markdown: 'x'.repeat(1_100_000) })).status, 413);
  assert.equal((await convert('# A', 'text/plain')).status, 415);
});
