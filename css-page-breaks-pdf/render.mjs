// Render an HTML file to PDF with Chrome (Puppeteer) or Chromium (Playwright).
// Usage: node render.mjs <input.html> <output.pdf> [extra.css] [--playwright]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import puppeteer from 'puppeteer';

// Put a stylesheet at the end of <head>. It comes after the page CSS,
// so its rules win when both have the same specificity.
export function addCss(html, css) {
  if (!css) return html;
  return html.replace('</head>', `<style>\n${css}\n</style>\n</head>`);
}

export async function launch(engine = 'puppeteer') {
  if (engine === 'playwright') return chromium.launch({ chromiumSandbox: true });
  return puppeteer.launch();
}

// Puppeteer and Playwright have the same newPage(), setContent() and pdf().
export async function renderPdf(browser, html) {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    return Buffer.from(
      await page.pdf({
        preferCSSPageSize: true, // the @page size in the CSS wins over the paper format
        printBackground: true,
      }),
    );
  } finally {
    await page.close();
  }
}

// Command line
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const engine = args.includes('--playwright') ? 'playwright' : 'puppeteer';
  const [input, output, cssFile] = args.filter((a) => !a.startsWith('--'));
  if (!input || !output) {
    console.error('Usage: node render.mjs <input.html> <output.pdf> [extra.css] [--playwright]');
    process.exit(2);
  }
  const css = cssFile ? await readFile(cssFile, 'utf8') : '';
  const html = addCss(await readFile(input, 'utf8'), css);
  const browser = await launch(engine);
  try {
    const pdf = await renderPdf(browser, html);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, pdf);
    console.log(`Wrote ${output} with ${engine} (${pdf.length} bytes)`);
  } finally {
    await browser.close();
  }
}
