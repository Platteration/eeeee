import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const key = 'abplot.web.document.v1';
const fixture = {
  name: 'North lawn', pointA: [100, 400], pointB: [300, 400], abDistance: 2, unit: 'meters',
  points: [{ id: '8F3B0C1E-1111-4222-8333-444455556666', label: 'Oak', position: [200, 300] }],
};
const points = (page) => page.locator('#measurements tbody tr');

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('keyboard deletion activates the button and undo restores the point', async ({ page }) => {
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await page.getByRole('button', { name: 'Delete point 1', exact: true }).press('Space');
  await expect(points(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(points(page)).toHaveCount(1);
});

test('typed coordinates commit and tab advances to the next cell', async ({ page }) => {
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await page.getByLabel('Along for point 1', { exact: true }).fill('3,5');
  await page.getByLabel('Along for point 1', { exact: true }).press('Tab');
  await expect(page.getByLabel('Perp. for point 1', { exact: true })).toBeFocused();
  await page.getByLabel('Perp. for point 1', { exact: true }).fill('-1.25');
  await page.getByLabel('Perp. for point 1', { exact: true }).press('Enter');
  await expect(page.getByLabel('Along for point 1', { exact: true })).toHaveValue('+3.50');
  await expect(page.getByLabel('Perp. for point 1', { exact: true })).toHaveValue('-1.25');
  await page.reload();
  await expect(page.getByLabel('Perp. for point 1', { exact: true })).toHaveValue('-1.25');
});

test('text-field undo does not undo unrelated plot edits', async ({ page }) => {
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).press('Control+z');
  await expect(points(page)).toHaveCount(1);
});

test('canceled touch and shift click never add a point', async ({ page }) => {
  const svg = page.locator('#canvas');
  await svg.dispatchEvent('pointerdown', { pointerId: 91, pointerType: 'touch', button: 0, clientX: 100, clientY: 130 });
  await svg.dispatchEvent('pointercancel', { pointerId: 91, pointerType: 'touch', button: 0, clientX: 100, clientY: 130 });
  await expect(points(page)).toHaveCount(0);
  await svg.click({ position: { x: 30, y: 30 }, modifiers: ['Shift'] });
  await expect(points(page)).toHaveCount(0);
});

test('an interrupted drag saves its last position as one undoable edit', async ({ page }) => {
  const handle = page.locator('[data-handle="A"]');
  const svg = page.locator('#canvas');
  // Marker nodes are replaced during rendering. Read the current target and
  // its bounds together through the stable SVG root, instead of a visibility
  // check followed by a separate geometry read on a potentially detached node.
  let box;
  await expect.poll(async () => {
    box = await svg.evaluate((root) => {
      const target = root.querySelector('[data-handle="A"] [data-hit-target]');
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    return Boolean(box && box.width > 0 && box.height > 0);
  }).toBe(true);
  const start = { pointerId: 92, pointerType: 'touch', button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  await handle.dispatchEvent('pointerdown', start);
  await svg.dispatchEvent('pointermove', { ...start, clientX: start.clientX + 25 });
  await svg.dispatchEvent('pointermove', { ...start, clientX: start.clientX + 40 });
  await svg.dispatchEvent('pointercancel', start);
  await expect(page.locator('#save-status')).toContainText('Saved in this browser');
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  expect(saved.pointA.x).not.toBe(100);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  const restored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  expect(restored.pointA).toEqual({ x: 100, y: 400 });
});

test('JSON validation, named import, units and all four downloads work', async ({ page }) => {
  await page.locator('#file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.locator('#status')).toContainText('Could not import');
  await expect(points(page)).toHaveCount(0);
  await page.locator('#file').setInputFiles({ name: 'lawn.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('North lawn');
  await expect(points(page)).toHaveCount(1);
  await page.getByLabel('Unit', { exact: true }).selectOption('feet');
  expect(Number(await page.getByLabel('A–B distance', { exact: true }).inputValue())).toBeCloseTo(2 / 0.3048);
  await page.getByLabel('Unit', { exact: true }).selectOption('meters');
  for (const format of ['JSON', 'CSV', 'SVG', 'PNG']) {
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: `Export ${format}`, exact: true }).click();
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    const bytes = await readFile(await download.path());
    expect(bytes.length).toBeGreaterThan(20);
    if (format === 'JSON') {
      const exported = JSON.parse(bytes.toString());
      expect(exported.abDistance).toBeCloseTo(fixture.abDistance);
      expect({ ...exported, abDistance: fixture.abDistance }).toEqual(fixture);
    }
    if (format === 'SVG') expect(bytes.toString()).toContain('<svg');
    if (format === 'PNG') expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  }
});

test('save failure is visible and retry persists the current plot', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    window.failAutosave = true;
    Storage.prototype.setItem = function (key, value) {
      if (window.failAutosave && key === 'abplot.web.document.v1') throw new Error('Test quota exceeded');
      return original.call(this, key, value);
    };
  });
  await page.reload();
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('Could not autosave');
  await page.evaluate(() => { window.failAutosave = false; });
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText('Saved in this browser');
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).points.length, key)).toBe(1);
});

test('the narrow layout fits the page and canvas targets remain touch-sized', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  const canvas = await page.locator('#canvas').boundingBox();
  for (const target of await page.locator('[data-hit-target]').all()) {
    const box = await target.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(43.9);
    expect(box.height).toBeGreaterThanOrEqual(43.9);
    expect(box.x).toBeGreaterThanOrEqual(canvas.x);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
  }
});
