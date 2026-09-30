/**
 * ABPlot offline support. The whole strategy is here so it can be reasoned about:
 *
 * - App shell (page, styles, modules, manifest, icons): network first. Online, every
 *   load fetches fresh files exactly as before and refreshes the cache, so a new release
 *   is picked up on the next online load without an update prompt. Offline, the last
 *   fully loaded copy answers.
 * - Local OCR assets (vendor/ocr): cache first. They are pinned by package version and
 *   large, so they download once, on the first recognition, and stay until OCR_CACHE
 *   below changes.
 * - The optional online service (api/), anything outside this scope, and every non-GET
 *   request are never cached.
 *
 * User data never enters these caches: plots live in localStorage and IndexedDB.
 * Storage failures (quota, disabled storage) fall back to the plain network response.
 */
const SHELL_CACHE = 'abplot-shell-v1';
// Bump when web/package.json pins a different tesseract.js, tesseract.js-core or English model.
const OCR_CACHE = 'abplot-ocr-tesseract-7.0.0-eng-1.0.0';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'privacy.html',
  'manifest.webmanifest',
  'icons/abplot-180.png',
  'icons/abplot-192.png',
  'icons/abplot-512.png',
  'icons/abplot-maskable-512.png',
  'src/app.js',
  'src/bootstrap.js',
  'src/editor.js',
  'src/exporters.js',
  'src/fieldSheet.js',
  'src/format.js',
  'src/grid.js',
  'src/importPanel.js',
  'src/measurementImport.js',
  'src/measurements.js',
  'src/ocr.js',
  'src/ocrPanel.js',
  'src/operations.js',
  'src/paper.js',
  'src/photoOverlay.js',
  'src/photoPanel.js',
  'src/photoRecovery.js',
  'src/plotDocument.js',
  'src/plotMath.js',
  'src/plotReview.js',
  'src/pointNames.js',
  'src/preferences.js',
  'src/projectState.js',
  'src/quickEntry.js',
  'src/reviewPanel.js',
  'src/store.js',
  'src/validation.js',
];

const scopePath = new URL(self.registration.scope).pathname;
const shellPaths = new Set(SHELL.map(path => new URL(path, self.registration.scope).pathname));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Bypass the HTTP cache so the precached shell is the release currently on the server.
    await cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== SHELL_CACHE && key !== OCR_CACHE) await caches.delete(key);
    }
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(scopePath)) return;
  const path = url.pathname.slice(scopePath.length);
  if (path.startsWith('api/')) return;
  if (path.startsWith('vendor/ocr/')) { event.respondWith(cacheFirst(request)); return; }
  if (request.mode === 'navigate' || shellPaths.has(url.pathname)) event.respondWith(networkFirst(request));
});

async function openCache(name) {
  try { return await caches.open(name); } catch { return null; }
}

async function store(cache, request, response) {
  if (!cache || !response.ok) return;
  try { await cache.put(request, response.clone()); } catch { /* quota or disabled storage: serve from the network only */ }
}

async function networkFirst(request) {
  const cache = await openCache(SHELL_CACHE);
  try {
    const response = await fetch(request);
    await store(cache, request, response);
    return response;
  } catch (error) {
    const cached = (await cache?.match(request, { ignoreSearch: true })) ?? (request.mode === 'navigate' ? await cache?.match('./') : undefined);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cache = await openCache(OCR_CACHE);
  const cached = await cache?.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await store(cache, request, response);
  return response;
}
