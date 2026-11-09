import { pipeline } from 'node:stream/promises';
import express from 'express';
import { renderPdf } from './render.js';
import { parsePdfRequest } from './validate.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Bodies over 1 MB get status 413 before any work starts.
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/pdf', async (req, res) => {
    const job = parsePdfRequest(req.body);
    await renderPdf(job, async (pdf) => {
      // Chrome finished the PDF. Send the headers, then stream the bytes.
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="document.pdf"',
      });
      await pipeline(pdf, res);
    });
  });

  // Express 5 sends errors from async handlers here.
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      // The PDF was half sent. Express closes the connection.
      return next(error);
    }
    if (error.name === 'TimeoutError') {
      return res.status(504).json({ error: 'The page did not load or print in time.' });
    }
    const status = error.status ?? 500;
    if (status >= 500) {
      console.error(error);
    }
    res.status(status).json({ error: error.expose ? error.message : 'Rendering failed.' });
  });

  return app;
}
