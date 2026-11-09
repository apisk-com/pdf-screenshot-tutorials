// Usage: node make-pdf.js <input.html> <output.pdf> [print|screen]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { htmlToPdf } from './pdf.js';

const [input = '../report.html', output = 'out/report.pdf', media = 'print'] = process.argv.slice(2);

const html = await readFile(input, 'utf8');
const browser = await chromium.launch();
try {
  const pdf = await htmlToPdf(browser, html, { media });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, pdf);
  console.log(`Wrote ${output} (${Math.round(pdf.length / 1024)} KB, ${media} media)`);
} finally {
  await browser.close();
}
