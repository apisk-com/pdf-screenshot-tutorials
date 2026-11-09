// Small helpers that read a PDF with the poppler command line tools.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

export function saveTemp(pdf, name = 'test.pdf') {
  const file = join(mkdtempSync(join(tmpdir(), 'wk-alt-')), name);
  writeFileSync(file, pdf);
  return file;
}

export function text(pdf) {
  return execFileSync('pdftotext', ['-layout', saveTemp(pdf), '-'], { encoding: 'utf8' });
}

export function fonts(pdf) {
  return execFileSync('pdffonts', [saveTemp(pdf)], { encoding: 'utf8' });
}

// Position (in points) of the first word that matches on page 1.
export function wordBox(pdf, word) {
  const xml = execFileSync('pdftotext', ['-bbox', '-f', '1', '-l', '1', saveTemp(pdf), '-'], { encoding: 'utf8' });
  const match = xml.match(new RegExp(`xMin="([\\d.]+)" yMin="([\\d.]+)" xMax="([\\d.]+)" yMax="([\\d.]+)">${word}<`));
  if (!match) return null;
  const [xMin, yMin, xMax, yMax] = match.slice(1).map(Number);
  return { xMin, yMin, xMax, yMax };
}

// RGB color of one pixel of page 1, rendered at 72 dpi (1 pixel = 1 point).
export function pixel(pdf, x, y) {
  const png = PNG.sync.read(execFileSync('pdftoppm', ['-png', '-r', '72', '-f', '1', '-l', '1', '-singlefile', saveTemp(pdf)]));
  const i = (png.width * Math.round(y) + Math.round(x)) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}
