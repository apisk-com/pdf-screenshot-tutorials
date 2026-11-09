import { chromium } from 'playwright';

// Limits for one screenshot. Change them with environment variables.
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 15_000);
const MAX_OPEN_CONTEXTS = Number(process.env.MAX_OPEN_CONTEXTS ?? 4);
// Full-page screenshots stop at this height (in CSS pixels) to limit memory use.
const MAX_FULL_PAGE_HEIGHT = 10_000;

let browserPromise;
let openContexts = 0;

// One Chromium process for the whole service. Requests share it.
export function getBrowser() {
  browserPromise ??= launchBrowser();
  return browserPromise;
}

async function launchBrowser() {
  try {
    const browser = await chromium.launch({
      // Playwright starts Chromium without its sandbox by default. This service
      // opens pages that it does not control, so it turns the sandbox on.
      chromiumSandbox: process.env.CHROMIUM_SANDBOX !== 'false',
    });
    // If Chromium crashes, the next request starts a new one.
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

// Takes one screenshot and returns the image as a Buffer.
export async function takeScreenshot(options) {
  if (openContexts >= MAX_OPEN_CONTEXTS) {
    throw Object.assign(new Error('Too many screenshots in progress. Try again later.'), {
      status: 503,
      expose: true,
    });
  }
  openContexts++;
  let context;
  try {
    const browser = await getBrowser();
    // A new context for each request: no cookies, storage or cache from other requests.
    context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: options.scale,
    });
    // Applies to page.goto() and page.screenshot().
    context.setDefaultTimeout(RENDER_TIMEOUT_MS);

    const page = await context.newPage();
    await page.goto(options.url, { waitUntil: 'load' });
    return await page.screenshot({
      type: options.format,
      quality: options.quality,
      fullPage: options.fullPage,
      // With fullPage, Playwright cuts this clip to the height of the page.
      clip: options.fullPage
        ? { x: 0, y: 0, width: options.width, height: MAX_FULL_PAGE_HEIGHT }
        : undefined,
    });
  } finally {
    openContexts--;
    // Closes the page too. close() fails when Chromium crashed: keep the first error.
    await context?.close().catch(() => {});
  }
}
