import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, readdir, access } from 'node:fs/promises';
import { server } from '../tools/serve.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const source = await read('sw.js');
const literal = name => Function(`"use strict"; return (${source.match(new RegExp(`const ${name} = ([^;]+);`))[1]});`)();

test('the service worker precaches every application module and nothing that does not exist', async () => {
  const shell = literal('SHELL');
  const modules = (await readdir(new URL('src/', root))).filter(name => name.endsWith('.js')).map(name => `src/${name}`).sort();
  assert.deepEqual(shell.filter(path => path.startsWith('src/')).sort(), modules, 'add new modules to SHELL in sw.js');
  for (const path of shell.filter(path => path !== './')) await access(new URL(path, root));
  for (const required of ['index.html', 'styles.css', 'privacy.html', 'manifest.webmanifest']) assert.ok(shell.includes(required), required);
});

test('the OCR cache name follows the pinned recognition packages', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const lock = JSON.parse(await read('package-lock.json'));
  const name = literal('OCR_CACHE');
  assert.ok(name.includes(`tesseract-${pkg.dependencies['tesseract.js']}`), `bump OCR_CACHE for tesseract.js ${pkg.dependencies['tesseract.js']}`);
  assert.ok(name.includes(`eng-${pkg.dependencies['@tesseract.js-data/eng']}`), 'bump OCR_CACHE for the English model');
  assert.equal(lock.packages['node_modules/tesseract.js-core'].version, pkg.dependencies['tesseract.js'], 'tesseract.js-core is expected to track tesseract.js; if it diverges, include its version in OCR_CACHE');
});

test('the web app manifest is valid, relative, and its icons ship', async () => {
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './'); assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && !icon.purpose), 'a plain 512px icon');
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'), 'a 192px icon');
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'), 'a maskable icon');
  for (const icon of manifest.icons) { assert.ok(!icon.src.startsWith('/'), icon.src); await access(new URL(icon.src, root)); }
  const html = await read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest" \/>/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/abplot-180\.png" \/>/);
  assert.match(html, /<meta name="theme-color" content="#0a84ff" \/>/);
  assert.match(await read('src/bootstrap.js'), /serviceWorker\.register\('sw\.js'\)/, 'register relative to the page so a sub-path site keeps its own scope');
});

test('the release server serves the offline files with usable types and keeps private paths hidden', async t => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const manifest = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifest.status, 200); assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
  const worker = await fetch(`${base}/sw.js`);
  assert.equal(worker.status, 200); assert.match(worker.headers.get('content-type'), /javascript/); assert.equal(worker.headers.get('cache-control'), 'no-cache');
  const icon = await fetch(`${base}/icons/abplot-192.png`);
  assert.equal(icon.status, 200); assert.equal(icon.headers.get('content-type'), 'image/png');
  for (const path of ['/icons/../package.json', '/icons/missing.png', '/tools/serve.js', '/test/offline.test.js']) assert.equal((await fetch(base + path)).status, 404, path);
});
