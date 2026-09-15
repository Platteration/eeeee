#!/usr/bin/env node
/**
 * Dependency-free HTTP server for local use or a container behind HTTPS.
 * Runtime files are allowlisted; optional OCR is configured separately.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredOcr } from '../server/ocr-api.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT ?? 8000);
const host = process.env.HOST ?? '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

/**
 * Resolve a request path to a file inside `root`, or null if it escapes.
 * Exported so the traversal guard is covered by the tests.
 */
export function resolveRequestPath(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (/[\\\0:]/.test(decoded) || decoded.split('/').includes('..')) return null;
  const relative = decoded.replace(/^\/+/, '');
  const base = resolve(root);
  const target = resolve(base, relative.endsWith('/') || relative === '' ? join(relative, 'index.html') : relative);
  return target === base || target.startsWith(base + sep) ? target : null;
}

const ocr = configuredOcr();
const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  const path = (request.url ?? '/').split('?')[0];
  if (path === '/healthz' && ['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' })); return;
  }
  try { if (await ocr(request, response)) return; }
  catch { if (!response.headersSent) response.writeHead(500); response.end('Service unavailable'); return; }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }); response.end('Method not allowed'); return;
  }
  const target = resolveRequestPath(root, request.url ?? '/');
  try {
    if (!target) throw new Error('outside root');
    const relative = target.slice(root.length + 1).split(sep).join('/');
    if (!['index.html', 'styles.css', 'privacy.html'].includes(relative) && !relative.startsWith('src/') && !relative.startsWith('vendor/')) {
      response.writeHead(404); response.end('Not found'); return;
    }
    const info = await stat(target);
    const file = info.isDirectory() ? join(target, 'index.html') : target;
    const size = info.isDirectory() ? (await stat(file)).size : info.size;
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': size,
      'cache-control': 'no-cache',
    });
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch (error) {
    const status = !target || ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500;
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(status === 404 ? 'Not found\n' : 'Could not read file\n');
  }
});

server.requestTimeout = 70000;
server.headersTimeout = 10000;

// Importing this module for its exports (the tests do) must not open a port.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () => console.log(`ABPlot web running at http://localhost:${port}/`));
  server.on('error', error => { console.error(`Could not start ABPlot: ${error.code || 'server error'}`); process.exitCode = 1; });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 10000).unref();
  });
}

export { server };
