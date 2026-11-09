// Compare two PDFs page by page. Each page is rendered to PNG with
// pdftoppm (poppler) and compared with pixelmatch.
// Usage: node diff-pdfs.mjs <old.pdf> <new.pdf> <out-dir> [max-percent]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const DPI = 60; // enough to see layout changes, small enough to be fast
const GAP = 12; // white space between the images in a sheet

export function pageCount(pdfPath) {
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  return Number(info.match(/^Pages:\s+(\d+)/m)[1]);
}

function renderPage(pdfPath, n) {
  // Without an output name, pdftoppm writes the PNG to stdout.
  const args = ['-png', '-r', String(DPI), '-f', String(n), '-l', String(n), '-singlefile', pdfPath];
  return PNG.sync.read(execFileSync('pdftoppm', args, { maxBuffer: 64 * 1024 * 1024 }));
}

// Put an image on a white canvas, so that both pages have the same size.
function onCanvas(image, width, height) {
  const canvas = new PNG({ width, height });
  canvas.data.fill(255);
  PNG.bitblt(image, canvas, 0, 0, image.width, image.height, 0, 0);
  return canvas;
}

export function comparePdfs(oldPdf, newPdf, outDir) {
  mkdirSync(outDir, { recursive: true });
  const oldPages = pageCount(oldPdf);
  const newPages = pageCount(newPdf);
  const pages = [];

  for (let n = 1; n <= Math.max(oldPages, newPages); n++) {
    if (n > oldPages || n > newPages) {
      pages.push({ page: n, percent: 100, file: null }); // page in one PDF only
      continue;
    }
    const a = renderPage(oldPdf, n);
    const b = renderPage(newPdf, n);
    const width = Math.max(a.width, b.width);
    const height = Math.max(a.height, b.height);
    const oldImage = onCanvas(a, width, height);
    const newImage = onCanvas(b, width, height);
    const diff = new PNG({ width, height });
    const changed = pixelmatch(oldImage.data, newImage.data, diff.data, width, height, { threshold: 0.1 });

    // One sheet per page: old | new | diff (changed pixels in red).
    const sheet = new PNG({ width: width * 3 + GAP * 2, height });
    sheet.data.fill(255);
    [oldImage, newImage, diff].forEach((image, i) => {
      PNG.bitblt(image, sheet, 0, 0, width, height, i * (width + GAP), 0);
    });
    const file = join(outDir, `page-${n}.png`);
    writeFileSync(file, PNG.sync.write(sheet));
    pages.push({ page: n, percent: (100 * changed) / (width * height), file });
  }
  return { oldPages, newPages, pages };
}

// Command line: exit code 1 when the page count or a page changed too much.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [oldPdf, newPdf, outDir, maxPercent = '1'] = process.argv.slice(2);
  if (!outDir) {
    console.error('Usage: node diff-pdfs.mjs <old.pdf> <new.pdf> <out-dir> [max-percent]');
    process.exit(2);
  }
  const { oldPages, newPages, pages } = comparePdfs(oldPdf, newPdf, outDir);
  console.log(`Pages: old ${oldPages}, new ${newPages}`);
  for (const p of pages) {
    const where = p.file ? `-> ${p.file}` : '(in one PDF only)';
    console.log(`page ${p.page}: ${p.percent.toFixed(2)}% of pixels changed ${where}`);
  }
  const failed = oldPages !== newPages || pages.some((p) => p.percent > Number(maxPercent));
  process.exit(failed ? 1 : 0);
}
