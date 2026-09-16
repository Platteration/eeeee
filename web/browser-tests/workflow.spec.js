import { test, expect } from '@playwright/test';

async function ready(page) { await page.goto('/'); await expect(page.locator('#startup')).toBeHidden(); }
test('new projects require a baseline and direct A/B entry preserves numbers and insertion order', async ({ page }) => {
  await ready(page);
  expect(await page.evaluate(() => window.abplot.store.document.abDistance)).toBe(0);
  await page.locator('#ab-distance').fill('5'); await page.locator('#quick-description').focus();
  expect(await page.evaluate(() => window.abplot.store.document.abDistance)).toBe(0);
  await page.locator('#baseline-apply').click();
  await page.locator('#quick-a').fill('2'); await page.locator('#quick-b').fill('2');
  await expect(page.locator('#quick-save')).toBeDisabled(); await expect(page.locator('#quick-status')).toContainText('Impossible triangle');
  await page.locator('#quick-a').fill('4'); await page.locator('#quick-b').fill('4');
  await page.locator('#quick-description').fill('Deep-end corner'); await page.locator('#quick-save').click();
  const first = await page.evaluate(() => window.abplot.store.document.points[0]);
  expect(first.label).toBe('1'); expect(first.description).toBe('Deep-end corner');
  await page.locator('#quick-a').fill('3'); await page.locator('#quick-b').fill('4'); await page.locator('#quick-save').click();
  await page.locator('#quick-insert').selectOption(first.id); await page.locator('#quick-a').fill('4'); await page.locator('#quick-b').fill('3'); await page.locator('#quick-save').click();
  expect(await page.evaluate(() => window.abplot.store.document.points.map(p => p.label))).toEqual(['1', '3', '2']);
  await page.locator('#undo').click(); expect(await page.evaluate(() => window.abplot.store.document.points.map(p => p.label))).toEqual(['1', '2']);
});

test('unapplied quick readings survive navigation and reject a changed baseline', async ({ page }) => {
  await ready(page); await page.locator('#ab-distance').fill('2'); await page.locator('#baseline-apply').click();
  await page.locator('#quick-a').fill('2'); await page.locator('#quick-b').fill('2');
  await page.locator('#pool-photo-button').click(); await page.locator('#workspace-plan').click();
  await expect(page.locator('#quick-a')).toHaveValue('2');
  await page.locator('#ab-distance').fill('3'); await page.locator('#baseline-apply').click();
  await expect(page.locator('#quick-status')).toContainText('baseline or units changed'); await expect(page.locator('#quick-save')).toBeDisabled();
  await page.locator('#quick-reset').click(); await page.locator('#quick-a').fill('3'); await page.locator('#quick-b').fill('3'); await expect(page.locator('#quick-save')).toBeEnabled();
});

test('a pending baseline keeps its physical value through unit changes, Undo and Redo', async ({ page }) => {
  await ready(page); await page.locator('#ab-distance').fill('2'); await page.locator('#baseline-apply').click();
  await page.locator('#ab-distance').fill('10'); await page.locator('#unit').selectOption('feet');
  expect(Number(await page.locator('#ab-distance').inputValue())).toBeCloseTo(10 / 0.3048, 8);
  await page.locator('#undo').click(); await expect(page.locator('#unit')).toHaveValue('meters');
  expect(Number(await page.locator('#ab-distance').inputValue())).toBeCloseTo(10, 8);
  expect(await page.evaluate(() => window.abplot.store.document.abDistance)).toBe(2);
  await page.locator('#redo').click(); await expect(page.locator('#unit')).toHaveValue('feet');
  expect(Number(await page.locator('#ab-distance').inputValue())).toBeCloseTo(10 / 0.3048, 8);
  await page.locator('#undo').click(); await page.locator('#baseline-apply').click();
  expect(await page.evaluate(() => window.abplot.store.document.abDistance)).toBeCloseTo(10, 8);
});

test('Select is non-destructive and Escape exits placement even while its toolbar button has focus', async ({ page }) => {
  await ready(page); const canvas = page.locator('#canvas');
  await canvas.click({ position: { x: 40, y: 40 } }); expect(await page.evaluate(() => window.abplot.store.document.points.length)).toBe(0);
  await page.locator('#tool-add').click(); await page.locator('#tool-add').press('Escape'); await expect(page.locator('#tool-select')).toHaveAttribute('aria-pressed', 'true');
  await canvas.click({ position: { x: 40, y: 40 } }); expect(await page.evaluate(() => window.abplot.store.document.points.length)).toBe(0);
  await page.locator('#tool-add').click(); await canvas.click({ position: { x: 40, y: 40 } }); await page.locator('#tool-done').click();
  expect(await page.evaluate(() => window.abplot.store.document.points.length)).toBe(1);
  const before = await page.evaluate(() => JSON.stringify(window.abplot.store.document));
  const a = page.locator('#canvas [data-handle="A"]'), box = await a.boundingBox();
  const event = { pointerId: 801, pointerType: 'touch', button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  await a.dispatchEvent('pointerdown', event); await canvas.dispatchEvent('pointermove', { ...event, clientX: event.clientX + 25 }); await canvas.dispatchEvent('pointerup', event);
  expect(await page.evaluate(() => JSON.stringify(window.abplot.store.document))).toBe(before);
});

test('phone reference dragging never opens or resizes the collapsed inspector mid-gesture', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await ready(page);
  await page.locator('#panel-collapse').click(); await page.locator('#tool-move').click(); await page.locator('#fit').click();
  const canvas = page.locator('#canvas'), a = page.locator('#canvas [data-handle="A"]');
  const before = await canvas.boundingBox(), box = await a.boundingBox();
  const event = { pointerId: 802, pointerType: 'touch', button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  await a.dispatchEvent('pointerdown', event); await expect(page.locator('#panel-content')).toBeHidden();
  expect(await canvas.boundingBox()).toEqual(before);
  await canvas.dispatchEvent('pointermove', { ...event, clientX: event.clientX + 20 }); await canvas.dispatchEvent('pointerup', event);
  await expect(page.locator('#panel-content')).toBeHidden();
  expect(await page.evaluate(() => window.abplot.store.document.pointA.x)).not.toBe(100);
  await page.locator('#undo').click(); expect(await page.evaluate(() => window.abplot.store.document.pointA.x)).toBe(100);
});
