#!/usr/bin/env node
/**
 * A static file server for local development -- the app is plain ES modules, so
 * it only needs to be served over http:// rather than opened as a file:// URL.
 * Deliberately dependency-free; there is nothing to install before `npm start`.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredOcr } from '../server/ocr-api.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT ?? 8000);

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
  if (await ocr(request, response)) return;
  const target = resolveRequestPath(root, request.url ?? '/');
  try {
    if (!target) throw new Error('outside root');
    const relative = target.slice(root.length + 1).split(sep).join('/');
    if (!['index.html', 'styles.css'].includes(relative) && !relative.startsWith('src/') && !relative.startsWith('vendor/')) {
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
  server.listen(port, () => console.log(`ABPlot web running at http://localhost:${port}/`));
}

export { server };
