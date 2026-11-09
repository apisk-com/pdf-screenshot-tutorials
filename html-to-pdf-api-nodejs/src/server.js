import { createApp } from './app.js';
import { closeBrowser, getBrowser } from './render.js';

const port = Number(process.env.PORT ?? 3000);

// Start Chrome first. If it cannot start, the service stops here with the error.
await getBrowser();

const server = createApp().listen(port, (error) => {
  if (error) throw error;
  console.log(`HTML to PDF API on http://localhost:${server.address().port}`);
});

// Docker and most process managers send SIGTERM before they stop the service.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => {
      await closeBrowser();
      process.exit(0);
    });
  });
}
