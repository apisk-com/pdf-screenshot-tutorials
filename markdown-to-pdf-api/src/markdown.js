import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

const require = createRequire(import.meta.url);

// The print stylesheet and a highlight.js color theme, read once at startup.
const css = [
  readFileSync(new URL('./print.css', import.meta.url), 'utf8'),
  readFileSync(require.resolve('highlight.js/styles/github.css'), 'utf8'),
].join('\n');

const md = new MarkdownIt({
  html: false, // raw HTML in the Markdown is printed as text, never rendered
  linkify: true, // bare URLs become links
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    }
    return ''; // unknown language: markdown-it escapes the code as plain text
  },
});

// The PDF step loads no remote files. Print the alt text instead of the image.
const renderImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const src = tokens[idx].attrGet('src') ?? '';
  if (src.startsWith('data:image/')) return renderImage(tokens, idx, options, env, self);
  const alt = self.renderInlineAsText(tokens[idx].children, options, env);
  return `<span class="image-placeholder">[image: ${md.utils.escapeHtml(alt)}]</span>`;
};

// GitHub tables and chat models use <br> for a line break in a table cell.
// HTML is off, so change only this one tag into a line break.
md.core.ruler.push('table_cell_br', (state) => {
  let inCell = false;
  for (const token of state.tokens) {
    if (token.type === 'th_open' || token.type === 'td_open') inCell = true;
    if (token.type === 'th_close' || token.type === 'td_close') inCell = false;
    if (!inCell || token.type !== 'inline') continue;
    token.children = token.children.flatMap((child) => {
      if (child.type !== 'text') return [child];
      return child.content.split(/<br\s*\/?>/i).flatMap((part, i) => {
        const text = new state.Token('text', '', 0);
        text.content = part;
        return i === 0 ? [text] : [new state.Token('hardbreak', 'br', 0), text];
      });
    });
  }
});

// Clean the input before markdown-it reads it.
export function cleanMarkdown(text) {
  let clean = text.replace(/\r\n?/g, '\n').trim();
  // Front matter (--- at the top) is metadata, not text. Remove it without
  // parsing it: some front matter parsers can run JavaScript.
  clean = clean.replace(/^---[a-z]*\n[\s\S]*?\n---(\n|$)/, '');
  // Chat models often put the full answer in a ```markdown fence. Remove that
  // outer fence, so the answer prints as a document, not as one code block.
  const fenced = clean.match(/^(`{3,}|~{3,})(?:markdown|md)[ \t]*\n([\s\S]*?)\n\1[ \t]*$/i);
  return fenced ? fenced[2] : clean;
}

function firstHeadingText(tokens) {
  const i = tokens.findIndex((token) => token.type === 'heading_open');
  if (i === -1) return '';
  return tokens[i + 1].children
    .filter((child) => child.type === 'text' || child.type === 'code_inline')
    .map((child) => child.content)
    .join('');
}

// Markdown in, a complete HTML document out. breakBefore: 'none', 'h1' or 'h2'.
export function markdownToHtml(markdown, { breakBefore = 'none' } = {}) {
  const tokens = md.parse(cleanMarkdown(markdown), {});
  const title = firstHeadingText(tokens) || 'Document';
  const body = md.renderer
    .render(tokens, md.options, {})
    // A paragraph with only \newpage starts a new page, as in Pandoc with LaTeX.
    .replaceAll('<p>\\newpage</p>', '<div class="page-break"></div>');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${md.utils.escapeHtml(title)}</title>
<style>
${css}
</style>
</head>
<body class="break-${breakBefore}">
${body}
</body>
</html>`;
}
