// Read a PDF with poppler: the text and the size of each page.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(command, args, pdf) {
  const dir = mkdtempSync(join(tmpdir(), 'pages-'));
  try {
    const file = join(dir, 'doc.pdf');
    writeFileSync(file, pdf);
    return execFileSync(command, [...args, file, ...(command === 'pdftotext' ? ['-'] : [])], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// pdftotext ends each page with a form feed (\f). Line breaks and runs of
// spaces become one space, so a phrase still matches when the text wraps.
export function pageTexts(pdf) {
  return run('pdftotext', ['-layout'], pdf)
    .split('\f')
    .slice(0, -1)
    .map((page) => page.replace(/\s+/g, ' '));
}

// [width, height] of each page in points (1 pt = 1/72 inch).
export function pageSizes(pdf) {
  const info = run('pdfinfo', ['-f', '1', '-l', '9999'], pdf);
  return [...info.matchAll(/^Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/gm)].map(([, w, h]) => [
    Math.round(w),
    Math.round(h),
  ]);
}

// For each key of `expected`: the pages on which that text appears,
// or the page orientations for the key "orientation".
export function observe(pdf, expected) {
  const texts = pageTexts(pdf);
  const result = {};
  for (const key of Object.keys(expected)) {
    result[key] =
      key === 'orientation'
        ? pageSizes(pdf).map(([w, h]) => (w > h ? 'landscape' : 'portrait'))
        : texts.flatMap((text, i) => (text.includes(key) ? [i + 1] : []));
  }
  return result;
}
