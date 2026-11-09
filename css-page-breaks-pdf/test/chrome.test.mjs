// Render each test document in Chrome (Puppeteer) and Chromium (Playwright),
// without and with its fix, and compare the pages with cases/cases.json.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { observe, pageSizes } from '../pages.mjs';
import { addCss, launch, renderPdf } from '../render.mjs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const cases = JSON.parse(read('cases/cases.json'));

for (const engine of ['puppeteer', 'playwright']) {
  describe(engine, () => {
    let browser;
    before(async () => {
      browser = await launch(engine);
    });
    after(() => browser.close());

    for (const c of cases) {
      test(c.id, async () => {
        const html = read(c.file);
        const expected = c.chrome;
        const observed = { without: observe(await renderPdf(browser, html), expected.without) };
        if (expected.with) {
          const fix = c.fixFile ? read(c.fixFile) : c.fix;
          observed.with = observe(await renderPdf(browser, addCss(html, fix)), expected.with);
        }
        assert.deepEqual(observed, expected);
      });
    }

    test('without preferCSSPageSize, the named page is A4 landscape, not A5', async () => {
      const fix = '@page wide { size: A5 landscape; } .wide { page: wide; }';
      const page = await browser.newPage();
      try {
        await page.setContent(addCss(read('cases/named-page.html'), fix));
        const pdf = Buffer.from(await page.pdf({ format: 'A4' }));
        const a4 = [595, 842]; // A4 in points; the two engines round it differently
        const expected = [a4, [a4[1], a4[0]], a4];
        const sizes = pageSizes(pdf);
        assert.equal(sizes.length, 3);
        sizes.forEach(([w, h], i) => {
          assert.ok(Math.abs(w - expected[i][0]) <= 2 && Math.abs(h - expected[i][1]) <= 2, `page ${i + 1}: ${w} x ${h}`);
        });
      } finally {
        await page.close();
      }
    });
  });
}
