// Serves local pages for the tests, so they do not need the internet.
//   /           test-page.html
//   /tall       a page 3000 px high
//   /very-tall  a page 25000 px high
//   /slow       never answers
// Run it alone with: node test/test-page-server.js (port 8080, or PORT)
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const testPage = readFileSync(new URL('./test-page.html', import.meta.url));
const tallPages = { '/tall': 3000, '/very-tall': 25000 };

export function startTestPageServer(port = 0) {
  const server = createServer((req, res) => {
    if (req.url === '/slow') return;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    const height = tallPages[req.url];
    if (height) {
      return res.end(`<body style="margin:0"><div style="height:${height}px;background:#2563eb"></div></body>`);
    }
    res.end(testPage);
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const server = await startTestPageServer(Number(process.env.PORT ?? 8080));
  console.log(`Test pages on http://127.0.0.1:${server.address().port}/`);
}
