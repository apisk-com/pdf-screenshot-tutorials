// Render an HTML string to a PDF buffer with Playwright and Chromium.

// The page CSS does not apply to the header and footer templates, so every
// style is inline. Without a font size, the text is almost invisible.
const textStyle = 'font: 9px Arial, sans-serif; width: 100%; margin: 0 14mm; color: #52606d;';
const headerTemplate = `<div style="${textStyle}"><span class="title"></span></div>`;
const footerTemplate = `<div style="${textStyle} text-align: right;">
  Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;

export const defaultPdfOptions = {
  format: 'A4',
  // The top and bottom margins must leave room for the header and footer.
  margin: { top: '20mm', right: '14mm', bottom: '18mm', left: '14mm' },
  printBackground: true, // keep background colors and images
  displayHeaderFooter: true,
  headerTemplate,
  footerTemplate,
  outline: true, // bookmarks from the headings (Chromium needs tagged: true for this)
  tagged: true, // accessible PDF with a structure tree
};

export async function htmlToPdf(browser, html, options = {}) {
  const { media = 'print', loadTimeout = 15_000, pdfTimeout = 30_000, ...pdfOptions } = options;
  // A new context per document: no cookies or storage leak between documents.
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(loadTimeout);
    await page.emulateMedia({ media });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    return await withTimeout(page.pdf({ ...defaultPdfOptions, ...pdfOptions }), pdfTimeout);
  } finally {
    // Closing the context also stops a render that ran out of time.
    await context.close();
  }
}

// page.pdf() in Playwright has no timeout option, so race it against a timer.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`page.pdf() took longer than ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
