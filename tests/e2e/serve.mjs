// Static fixture server for e2e tests and manual development.
//   /            -> demo dashboard
//   /csp         -> same-style page served with a strict CSP + Trusted Types
//   /spa         -> page whose main region re-renders itself
//   /api/stats   -> canned JSON the dashboard fetches
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/demo');
const PORT = Number(process.env.PORT ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const STRICT_CSP = "default-src 'self'; script-src 'self'; object-src 'none'; require-trusted-types-for 'script'";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (pathname === '/api/stats') {
    res.writeHead(200, { 'content-type': MIME['.json'] });
    res.end(JSON.stringify({ users: 1284, revenue: '$12,430', uptime: '99.98%' }));
    return;
  }

  let extraHeaders = {};
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/csp') {
    pathname = '/csp.html';
    extraHeaders = { 'content-security-policy': STRICT_CSP };
  }
  if (pathname === '/spa') pathname = '/spa.html';

  const filePath = path.join(root, path.normalize(pathname));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(filePath);
    const type = MIME[path.extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', ...extraHeaders });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`[fixture server] http://localhost:${PORT}`);
});
