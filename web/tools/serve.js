#!/usr/bin/env node
/**
 * A static file server for local development -- the app is plain ES modules, so
 * it only needs to be served over http:// rather than opened as a file:// URL.
 * Deliberately dependency-free; there is nothing to install before `npm start`.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  if (decoded.includes('\0')) return null;
  const relative = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const target = join(root, relative.endsWith('/') || relative === '' ? join(relative, 'index.html') : relative);
  return target === root || target.startsWith(root + sep) ? target : null;
}

const server = createServer(async (request, response) => {
  const target = resolveRequestPath(root, request.url ?? '/');
  try {
    if (!target) throw new Error('outside root');
    const info = await stat(target);
    const file = info.isDirectory() ? join(target, 'index.html') : target;
    const size = info.isDirectory() ? (await stat(file)).size : info.size;
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': size,
      'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found\n');
  }
});

// Importing this module for its exports (the tests do) must not open a port.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, () => console.log(`ABPlot web running at http://localhost:${port}/`));
}

export { server };
