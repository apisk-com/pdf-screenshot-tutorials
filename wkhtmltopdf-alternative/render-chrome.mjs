// Render an HTML file to PDF with headless Chrome (Puppeteer).
// Usage: node render-chrome.mjs document/invoice.html out/chrome.pdf [scale]
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

// page.pdf() options that replace the old wkhtmltopdf flags.
// Page size, margins, header and footer come from @page rules in page.css.
export const PDF_OPTIONS = {
  format: 'A4', // --page-size A4 (the Puppeteer default is Letter)
  preferCSSPageSize: true, // use @page { size } when the CSS sets it
  printBackground: true, // --background (on by default in wkhtmltopdf)
  outline: true, // --outline (PDF bookmarks from the headings)
  timeout: 30_000,
};

export async function renderPdf(browser, inputPath, options = {}) {
  const page = await browser.newPage();
  try {
    // A file:// URL lets the page load the CSS and fonts next to it.
    // Use it only for templates that you control.
    const url = pathToFileURL(resolve(inputPath)).href;
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });

    // Replaces --window-status: wait until the page sets window.status.
    if (options.windowStatus) {
      await page.waitForFunction(
        (status) => window.status === status,
        { timeout: 10_000 },
        options.windowStatus,
      );
    }
    return await page.pdf({ ...PDF_OPTIONS, ...options.pdf });
  } finally {
    // Close the page also when goto() or pdf() fails.
    await page.close();
  }
}

// Command line: node render-chrome.mjs <input.html> <output.pdf> [scale]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, scale = '1'] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Usage: node render-chrome.mjs <input.html> <output.pdf> [scale]');
    process.exit(2);
  }
  const browser = await puppeteer.launch();
  try {
    // scale 0.8 gives the size of the old wkhtmltopdf output (smart shrinking).
    const pdf = await renderPdf(browser, input, { pdf: { scale: Number(scale) } });
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(output, pdf);
    console.log(`Wrote ${output} (${pdf.length} bytes)`);
  } finally {
    await browser.close();
  }
}
