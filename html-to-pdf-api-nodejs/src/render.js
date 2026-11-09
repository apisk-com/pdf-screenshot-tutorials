import puppeteer from 'puppeteer';

// Limits for one render. Change them with environment variables.
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 20_000);
const MAX_OPEN_PAGES = Number(process.env.MAX_OPEN_PAGES ?? 4);

let browserPromise;
let openPages = 0;

// One Chrome process for the whole service. Requests share it.
export function getBrowser() {
  browserPromise ??= launchBrowser();
  return browserPromise;
}

async function launchBrowser() {
  try {
    const browser = await puppeteer.launch({
      // server.js handles these signals: open requests finish, then Chrome closes.
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    // If Chrome crashes, the next request starts a new one.
    browser.on('disconnected', () => {
      browserPromise = undefined;
    });
    return browser;
  } catch (error) {
    browserPromise = undefined;
    throw error;
  }
}

export async function closeBrowser() {
  const browser = await browserPromise;
  await browser?.close();
}

// Renders one job to PDF and passes the PDF stream to send().
// The page stays open until send() finishes, then closes in all cases.
export async function renderPdf(job, send) {
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

    if (job.url) {
      // Wait until the page has at most 2 open connections for 500 ms.
      await page.goto(job.url, { waitUntil: 'networkidle2' });
    } else {
      // Wait for images and stylesheets that the HTML links to.
      await page.setContent(job.html, { waitUntil: 'load' });
    }

    const pdf = await page.createPDFStream(job.options);
    await send(pdf);
  } finally {
    openPages--;
    // close() fails when Chrome crashed. Keep the first error, not this one.
    await page?.close().catch(() => {});
  }
}
