import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { takeScreenshot } from './render.js';
import { createStorage } from './storage.js';
import { badRequest, parseScreenshotRequest } from './validate.js';

const CONTENT_TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

export function createApp({ apiKey = process.env.API_KEY, storage = createStorage() } = {}) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/screenshot', requireApiKey(apiKey), async (req, res) => {
    const options = parseScreenshotRequest(req.query);
    if (options.store && !storage) {
      throw badRequest('"store" needs S3_BUCKET on the server.');
    }

    const image = await takeScreenshot(options);
    const contentType = CONTENT_TYPES[options.format];

    if (options.store) {
      const saved = await storage.save(image, contentType, options.format);
      return res.status(201).json(saved);
    }
    res.type(contentType).send(image);
  });

  // Express 5 sends errors from async handlers here.
  app.use((error, req, res, next) => {
    if (error.name === 'TimeoutError') {
      return res.status(504).json({ error: 'The page did not load in time.' });
    }
    // Playwright reports network errors as "net::ERR_NAME_NOT_RESOLVED" and similar.
    if (error.message?.includes('net::ERR_')) {
      return res.status(502).json({ error: 'The page could not be loaded.' });
    }
    if (!error.expose) {
      console.error(error);
    }
    res.status(error.status ?? 500).json({ error: error.expose ? error.message : 'The screenshot failed.' });
  });

  return app;
}

// Checks the header "Authorization: Bearer <key>". Without a key, all requests pass.
function requireApiKey(apiKey) {
  const expected = apiKey ? sha256(apiKey) : null;
  return (req, res, next) => {
    if (!expected) return next();
    const header = req.get('authorization') ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    // timingSafeEqual needs two buffers of the same length. SHA-256 hashes
    // always have 32 bytes, and the compare time does not show how much matched.
    if (timingSafeEqual(sha256(given), expected)) return next();
    res.status(401).json({ error: 'The API key is missing or wrong.' });
  };
}

function sha256(text) {
  return createHash('sha256').update(text).digest();
}
