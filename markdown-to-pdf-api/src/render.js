import puppeteer from 'puppeteer';

// Limits for one render. Change them with environment variables.
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 20_000);
const MAX_OPEN_PAGES = Number(process.env.MAX_OPEN_PAGES ?? 4);

let browserPromise;
let openPages = 0;

// One Chrome process for the whole service. If Chrome crashes or cannot
// start, the next request starts a new one.
export function getBrowser() {
  browserPromise ??= puppeteer.launch().then(
    (browser) => {
      browser.on('disconnected', () => {
        browserPromise = undefined;
      });
      return browser;
    },
    (error) => {
      browserPromise = undefined;
      throw error;
    },
  );
  return browserPromise;
}

export async function closeBrowser() {
  const browser = await browserPromise;
  await browser?.close();
}

// Prints one HTML document to PDF and returns the bytes.
export async function renderPdf(html, { format = 'A4' } = {}) {
  if (openPages >= MAX_OPEN_PAGES) {
    throw Object.assign(new Error('Too many renders. Try again later.'), {
      status: 503,
      expose: true,
    });
  }
  openPages++;
  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);

    // The document comes from user input. It needs no scripts and no network.
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (request.url().startsWith('data:')) request.continue();
      else request.abort();
    });

    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format,
      margin: { top: '18mm', right: '16mm', bottom: '18mm', left: '16mm' },
      printBackground: true, // keep the gray code and table backgrounds
      outline: true, // PDF bookmarks from the headings
    });
  } finally {
    openPages--;
    // close() fails when Chrome crashed. Keep the first error, not this one.
    await page?.close().catch(() => {});
  }
}
