import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect.poll(() => page.evaluate(() => Boolean(window.abplot))).toBe(true);
  expect(errors).toEqual([]);
});
const open = async page => { await page.getByRole('button', { name: 'Enter measurements…', exact: true }).click(); };
test('review, correct, apply and undo 250 points', async ({ page }) => {
  await open(page);
  await page.locator('#entry-text').fill(Array.from({ length: 250 }, (_, i) => `P${i},${i / 10},${i % 10}`).join('\n'));
  await page.locator('#entry-review-button').click();
  await expect(page.locator('#entry-rows tr')).toHaveCount(250);
  expect(await page.evaluate(() => window.abplot.store.document.points.length)).toBe(0);
  await page.locator('#entry-apply').click();
  await expect(page.locator('#measurements tbody tr')).toHaveCount(250);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#measurements tbody tr')).toHaveCount(0);
});
test('invalid rows block import until corrected and stale previews are rejected', async ({ page }) => {
  await open(page); await page.locator('#entry-text').fill('P1,wrong,2'); await page.locator('#entry-review-button').click();
  await expect(page.locator('#entry-apply')).toBeDisabled();
  await page.getByLabel('first in row 1', { exact: true }).fill('3');
  await page.getByLabel('first in row 1', { exact: true }).press('Tab');
  await expect(page.locator('#entry-apply')).toBeEnabled();
  await page.evaluate(() => window.abplot.store.apply(d => { d.abDistance = 5; }));
  await expect(page.locator('#entry-apply')).toBeDisabled();
  await expect(page.locator('#entry-status')).toContainText('plot changed');
});
test('two tabs preserve first save and allow the stale plot to be downloaded', async ({ page, context }) => {
  const second = await context.newPage(); await second.goto('/');
  await page.locator('#name').fill('First tab'); await expect(page.locator('#save-status')).toContainText('Saved');
  await second.locator('#name').fill('Other tab'); await expect(second.locator('#save-status')).toContainText('Another tab');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('abplot.web.document.v1')).name)).toBe('First tab');
  const download = second.waitForEvent('download'); await second.locator('#export-json').click(); expect((await download).suggestedFilename()).toBe('other-tab.json');
});
test('bad preferences cannot break startup and overflow leaves the plot unchanged', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('abplot.web.preferences.v1', '{"sheet":42,"planScale":{}}'));
  await page.reload(); await page.locator('#add').click();
  const before = await page.evaluate(() => JSON.stringify(window.abplot.store.document));
  await page.getByLabel('Along for point 1', { exact: true }).fill('1e308'); await page.getByLabel('Along for point 1', { exact: true }).press('Enter');
  await expect(page.locator('#status')).toContainText('supported range');
  expect(await page.evaluate(() => JSON.stringify(window.abplot.store.document))).toBe(before);
});
