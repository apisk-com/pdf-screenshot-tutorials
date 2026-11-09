import express from 'express';
import { markdownToHtml } from './markdown.js';
import { renderPdf } from './render.js';

const FORMATS = ['A4', 'Letter', 'Legal'];
const BREAKS = ['none', 'h1', 'h2'];

// An error that the API returns to the client with this status.
function httpError(status, message) {
  return Object.assign(new Error(message), { status, expose: true });
}

// JSON: options in the body. Plain Markdown: options in the query string.
function parseRequest(req) {
  let input;
  if (req.is('application/json')) input = req.body;
  else if (req.is('text/markdown')) input = { ...req.query, markdown: req.body };
  else throw httpError(415, 'Send application/json or text/markdown.');

  const { markdown, format = 'A4', breakBefore = 'none' } = input ?? {};
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    throw httpError(400, '"markdown" must be a string that is not empty.');
  }
  if (!FORMATS.includes(format)) {
    throw httpError(400, `"format" must be one of: ${FORMATS.join(', ')}.`);
  }
  if (!BREAKS.includes(breakBefore)) {
    throw httpError(400, `"breakBefore" must be one of: ${BREAKS.join(', ')}.`);
  }
  return { markdown, format, breakBefore };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // 1 MB of Markdown is several hundred pages. A larger body gets status 413.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ type: 'text/markdown', limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/markdown', async (req, res) => {
    const { markdown, format, breakBefore } = parseRequest(req);
    const pdf = await renderPdf(markdownToHtml(markdown, { breakBefore }), { format });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="document.pdf"',
    });
    res.send(pdf);
  });

  // Express 5 sends errors from async handlers and from the body parsers here.
  app.use((error, req, res, next) => {
    if (error.name === 'TimeoutError') {
      return res.status(504).json({ error: 'The document did not print in time.' });
    }
    const status = error.status ?? 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: error.expose ? error.message : 'Rendering failed.' });
  });

  return app;
}
