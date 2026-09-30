import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * A static host such as GitHub Pages serves the package below a path prefix
 * (https://user.github.io/eeeee/). Rewrite /eeeee/* to the dev server's root so
 * the page, its modules and its fetches all run with the prefixed document URL.
 */
const PREFIX = '/eeeee';
test.beforeEach(async ({ page }) => {
  await page.route(`**${PREFIX}/**`, route => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.slice(PREFIX.length) || '/';
    return route.continue({ url: url.href });
  });
});

test('the editor starts, autosaves, exports and probes its optional API from a sub-path origin', async ({ page }) => {
  const requested = [];
  page.on('request', request => requested.push(request.url()));
  await page.goto(`${PREFIX}/`);
  await expect(page.locator('#startup')).toBeHidden();
  await expect(page.locator('main')).not.toHaveAttribute('inert');
  expect(page.url()).toContain(`${PREFIX}/`);
  // The optional online OCR probe must stay inside the site, not jump to the origin root.
  await expect.poll(() => requested.filter(url => url.includes('api/ocr/config'))).toEqual([`http://127.0.0.1:8000${PREFIX}/api/ocr/config`]);
  expect(requested.some(url => url.includes(`${PREFIX}/src/photoPanel.js`))).toBe(true);
  expect(requested.some(url => /127\.0\.0\.1:8000\/(src|styles)/.test(url))).toBe(false);

  await page.getByLabel('A–B distance', { exact: true }).fill('4');
  await page.locator('#baseline-apply').click();
  await page.locator('#quick-a').fill('3'); await page.locator('#quick-b').fill('3'); await page.locator('#quick-save').click();
  await page.locator('#panel-points').click();
  await expect(page.locator('#coordinate-table')).toContainText('1');
  await page.reload();
  await expect(page.locator('#startup')).toBeHidden();
  await expect(page.getByLabel('A–B distance', { exact: true })).toHaveValue('4');

  await page.locator('#export-options-button').click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export plot for iPhone', exact: true }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  const exported = JSON.parse((await readFile(await download.path())).toString());
  expect(exported.abDistance).toBe(4);
  expect(exported.points).toHaveLength(1);

  // The privacy page and the local OCR assets resolve relative to the prefixed site too.
  const [privacy, ocr] = await page.evaluate(async () => {
    const results = [];
    for (const path of ['privacy.html', 'vendor/ocr/tesseract.esm.min.js']) {
      const response = await fetch(new URL(path, location.href), { method: 'HEAD' });
      results.push({ url: response.url, ok: response.ok, type: response.headers.get('content-type') });
    }
    return results;
  });
  expect(privacy).toMatchObject({ ok: true, url: `http://127.0.0.1:8000${PREFIX}/privacy.html` });
  expect(ocr).toMatchObject({ ok: true, url: `http://127.0.0.1:8000${PREFIX}/vendor/ocr/tesseract.esm.min.js` });
});
