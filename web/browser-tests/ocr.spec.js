import { seedBaseline } from './helpers.js';
import { test, expect } from '@playwright/test';

test('local photo OCR uses only site assets and requires review before import', async ({ page }) => {
  test.setTimeout(90000);
  const external = [], errors = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:8000/')) external.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await seedBaseline(page); await page.goto('/');
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 160;
    const context = canvas.getContext('2d'); context.fillStyle = 'white'; context.fillRect(0, 0, 1000, 160);
    context.fillStyle = 'black'; context.font = '40px Arial'; context.fillText('P1  12.50  8.25', 30, 70);
    return canvas.toDataURL().split(',')[1];
  });
  await page.locator('#bulk-entry').click(); await page.locator('#entry-mode').selectOption('offsets'); await page.locator('#ocr-panel summary').click();
  await page.locator('#ocr-file').setInputFiles({ name: 'measurements.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('#ocr-local')).toBeEnabled(); await page.locator('#ocr-local').click();
  await expect(page.locator('#entry-text')).toHaveValue(/12\.50\s+8\.25/, { timeout: 65000 });
  await page.locator('#entry-review-button').click();
  await expect(page.locator('#entry-apply')).toBeDisabled();
  await page.locator('#entry-checked').check(); await expect(page.locator('#entry-apply')).toBeEnabled();
  await page.locator('#entry-apply').click(); await expect(page.locator('#measurements tbody tr')).toHaveCount(1);
  expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('local OCR load failure preserves manual entry', async ({ page }) => {
  await page.route('**/vendor/ocr/tesseract.esm.min.js', route => route.abort());
  await seedBaseline(page); await page.goto('/');
  const message = await page.evaluate(async () => {
    const { recognizeLocal } = await import('./src/ocr.js');
    try { await recognizeLocal(new Blob()); } catch (error) { return error.message; }
  });
  expect(message).toBeTruthy();
  await page.locator('#bulk-entry').click(); await page.locator('#entry-text').fill('P1 1 2');
  await page.locator('#entry-review-button').click(); await expect(page.locator('#entry-apply')).toBeEnabled();
});

test('online recognition requires an explicit image upload and supports retry after rejected code', async ({ page }) => {
  let uploads = 0, logins = 0;
  await page.route('**/api/ocr/config', route => route.fulfill({ json: { enabled: true } }));
  await page.route('**/api/ocr/session', route => { logins++; return route.fulfill({ status: logins === 1 ? 401 : 200, json: logins === 1 ? { error: { message: 'Access code rejected' } } : { authenticated: true } }); });
  await page.route('**/api/ocr', route => { uploads++; return route.fulfill({ json: { text: 'P1 1.50 2.25', words: [{ text: '1.50', confidence: 0.6 }] } }); });
  await seedBaseline(page); await page.goto('/');
  const bytes = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 100; return c.toDataURL().split(',')[1]; });
  await page.locator('#bulk-entry').click(); await page.locator('#entry-mode').selectOption('offsets'); await page.locator('#ocr-panel summary').click();
  await page.locator('#ocr-file').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(bytes, 'base64') });
  await expect(page.locator('#ocr-online')).toBeEnabled(); expect(uploads).toBe(0);
  await page.locator('#ocr-code').fill('wrong'); await page.locator('#ocr-online').click();
  await expect(page.locator('#ocr-notes')).toContainText('Access code rejected'); expect(uploads).toBe(0);
  await page.locator('#ocr-code').fill('pilot-code'); await page.locator('#ocr-online').click();
  await expect(page.locator('#entry-text')).toHaveValue('P1 1.50 2.25'); expect(uploads).toBe(1);
  await expect(page.locator('#ocr-notes')).toContainText('1.50');
});
