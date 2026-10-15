import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Offline behaviour is tested against a private copy of the release server so it
 * can really go away: Playwright's network emulation does not reach service
 * worker fetches, and the shared dev server must keep running for other tests.
 */
const web = fileURLToPath(new URL('../', import.meta.url));

async function startServer() {
  for (let tries = 0; tries < 3; tries++) {
    const port = 8100 + Math.floor(Math.random() * 800);
    const child = spawn(process.execPath, ['tools/serve.js'], { cwd: web, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
    const base = `http://127.0.0.1:${port}/`;
    for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
      try { if ((await fetch(base + 'healthz')).ok) return { base, child }; } catch { /* not yet */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await stop(child);
  }
  throw new Error('release server did not start');
}

// A process killed by a signal reports exitCode null, so track exit explicitly.
const stop = child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL'); });

test('after one online load the editor opens offline with its saved plot, and the manifest installs', async ({ page }) => {
  test.setTimeout(90000);
  const { base, child } = await startServer();
  try {
    await page.goto(base);
    await expect(page.locator('#startup')).toBeHidden();
    // The manifest and icons are reachable from the page.
    const manifest = await page.evaluate(async () => {
      const href = document.querySelector('link[rel="manifest"]').href;
      const response = await fetch(href); const json = await response.json();
      const icon = await fetch(new URL(json.icons[0].src, href));
      return { href, type: response.headers.get('content-type'), start: json.start_url, iconOk: icon.ok };
    });
    expect(manifest).toMatchObject({ href: `${base}manifest.webmanifest`, type: 'application/manifest+json', start: './', iconOk: true });

    // Wait until the worker has finished precaching the shell.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(async () => page.evaluate(async () => {
      const cache = await caches.open('abplot-shell-v1');
      return (await cache.keys()).length;
    }), { timeout: 30000 }).toBeGreaterThanOrEqual(30);

    await page.getByLabel('Name', { exact: true }).fill('Offline pool');
    await expect(page.locator('#save-status')).toContainText('Saved in this browser');

    await stop(child);
    await expect(fetch(base + 'healthz')).rejects.toThrow();

    await page.reload();
    await expect(page.locator('#startup')).toBeHidden();
    await expect(page.locator('main')).not.toHaveAttribute('inert');
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Offline pool');
    // The optional online service is never cached: its probe fails offline and the controls stay hidden.
    await page.locator('#bulk-entry').click();
    await expect(page.locator('#ocr-online-controls')).toBeHidden();
    await page.locator('#entry-close').click();
    // Editing keeps working from the cached shell.
    await page.getByLabel('A–B distance', { exact: true }).fill('5');
    await page.locator('#baseline-apply').click();
    await page.locator('#quick-a').fill('3'); await page.locator('#quick-b').fill('4'); await page.locator('#quick-save').click();
    await page.locator('#panel-points').click();
    await expect(page.locator('#coordinate-table')).toContainText('1');
  } finally {
    await stop(child);
  }
});

test('the worker never caches the optional API or user data and serves fresh files while online', async ({ page }) => {
  const { base, child } = await startServer();
  try {
    await page.goto(base);
    await expect(page.locator('#startup')).toBeHidden();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(async () => page.evaluate(async () => (await caches.open('abplot-shell-v1')).keys().then(keys => keys.length)), { timeout: 30000 }).toBeGreaterThanOrEqual(30);
    await page.reload(); // now controlled by the worker
    await expect(page.locator('#startup')).toBeHidden();
    const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
    expect(controlled).toBe(true);
    const cachedPaths = await page.evaluate(async () => {
      const names = await caches.keys();
      const keys = [];
      for (const name of names) for (const request of await (await caches.open(name)).keys()) keys.push(new URL(request.url).pathname);
      return { names, keys };
    });
    expect(cachedPaths.names.sort()).toEqual(['abplot-shell-v1']);
    expect(cachedPaths.keys.some(path => path.includes('/api/'))).toBe(false);
    expect(cachedPaths.keys.some(path => path.includes('healthz'))).toBe(false);
    // While online, a controlled page still gets the shell from the server, not a stale copy:
    // the worker forwards the request and the response carries the server's revalidation header.
    const served = await page.evaluate(async () => { const r = await fetch('styles.css'); return { status: r.status, cache: r.headers.get('cache-control') }; });
    expect(served).toEqual({ status: 200, cache: 'no-cache' });
  } finally {
    await stop(child);
  }
});
