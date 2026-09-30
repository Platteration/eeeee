import { test, expect } from '@playwright/test';

test('a failed application module shows reload recovery without clearing saved data', async ({ page }) => {
  await page.route('**/src/photoRecovery.js', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#startup-message')).toContainText('could not start');
  await expect(page.locator('main')).toHaveAttribute('inert', '');
  await expect(page.locator('#startup-retry')).toBeVisible();
  await page.unroute('**/src/photoRecovery.js');
  await page.locator('#startup-retry').click();
  await expect(page.locator('#startup')).toBeHidden();
  await expect(page.locator('main')).not.toHaveAttribute('inert');
  await page.locator('#pool-photo-button').click();
  await expect(page.locator('#pool-photo')).toBeVisible();
});

test('a page without a lock manager still autosaves, warns, keeps the plot across reload, and attaches photos', async ({ page }) => {
  // navigator.locks and crypto.randomUUID exist only in secure contexts; plain http:// from a phone on the LAN has neither.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
  });
  await page.goto('/');
  await expect(page.locator('#save-status')).toContainText('not a secure origin');
  await page.getByLabel('Name', { exact: true }).fill('LAN pool');
  await expect(page.locator('#save-status')).toContainText('Saved in this browser');
  await expect(page.locator('#save-status')).toContainText('one tab at a time');
  await expect(page.locator('#retry-save')).toBeHidden();
  await page.reload();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('LAN pool');
  await expect(page.locator('#save-status')).toContainText('not a secure origin');
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 300; c.getContext('2d').fillRect(0, 0, 400, 300); return c.toDataURL().split(',')[1]; });
  await page.locator('#pool-photo-button').click();
  await page.locator('#photo-file').setInputFiles({ name: 'pool.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(page.locator('#photo-workspace')).toBeVisible();
  await expect(page.locator('#photo-status')).not.toContainText('randomUUID');
  expect(await page.evaluate(() => Boolean(window.abplot.store.projectPhoto))).toBe(true);
});
