import { test, expect } from '@playwright/test';

async function setup(page, values = [{ label: '1' }, { label: '2' }]) {
  await page.goto('/'); await expect(page.locator('#startup')).toBeHidden();
  const ids = await page.evaluate(values => {
    const points = values.map((value, index) => ({ id: crypto.randomUUID().toUpperCase(), position: { x: 180 + index * 30, y: 280 + index * 30 }, ...value }));
    window.abplot.store.apply(doc => { doc.abDistance = 2; doc.points = points; doc.outlineDirection = 'off'; });
    window.abplot.editor.fit(); return points.map(point => point.id);
  }, values);
  await page.locator('#panel-points').click();
  if (!await page.locator('#review-details').evaluate(node => node.open)) await page.locator('#review-details summary').click();
  await page.locator('#review-point').selectOption(ids[0]);
  return ids;
}

test('inspector validates names and preserves descriptions, order and grouped notes', async ({ page }) => {
  const [id] = await setup(page);
  const before = await page.evaluate(() => window.abplot.store.document.points[0].position);
  await page.locator('#review-label').fill('2'); await page.locator('#review-label').press('Tab');
  await expect(page.locator('#review-name-status')).toContainText('Duplicate');
  expect(await page.evaluate(() => window.abplot.store.document.points[0].label)).toBe('1');
  await page.locator('#review-label').fill('A'); await page.locator('#review-label').press('Tab');
  await expect(page.locator('#review-name-status')).toContainText('reserved');
  await page.locator('#review-label').fill('12'); await page.locator('#review-label').press('Enter');
  await page.locator('#review-description').fill('Shallow-end corner');
  await page.locator('#review-flag').check();
  await page.locator('#review-note').pressSequentially('Check tape sag');
  await page.locator('#undo').click();
  expect(await page.evaluate(() => window.abplot.store.document.points[0].note)).toBeUndefined();
  await page.locator('#redo').click();
  await page.locator('#review-later').click();
  const saved = await page.evaluate(id => window.abplot.store.document.points.find(p => p.id === id), id);
  expect(saved).toMatchObject({ id, label: '12', description: 'Shallow-end corner', note: 'Check tape sag', needsRemeasure: true, position: before });
  await page.evaluate(() => window.abplot.store.whenSaved()); await page.reload(); await expect(page.locator('#startup')).toBeHidden();
  await page.locator('#panel-points').click(); await page.locator('#review-details summary').click(); await page.locator('#review-point').selectOption(id);
  await expect(page.locator('#review-description')).toHaveValue('Shallow-end corner');
  await expect(page.locator('#review-note')).toHaveValue('Check tape sag');
  await expect(page.locator('#review-selected-help')).toContainText('position 2 of 2');
});

test('legacy name warnings do not block corrected A/B distances', async ({ page }) => {
  const [id] = await setup(page, [{ label: 'A', description: 'Legacy corner' }]);
  await expect(page.locator('#review-name-status')).toContainText('reserved');
  await page.locator('#remeasure-a').fill('2'); await page.locator('#remeasure-b').fill('2');
  await expect(page.locator('#remeasure-save')).toBeEnabled(); await page.locator('#remeasure-save').click();
  const updated = await page.evaluate(() => window.abplot.store.document.points[0]);
  expect(updated).toMatchObject({ id, label: 'A', description: 'Legacy corner' });
  expect(updated.position.y).toBeCloseTo(400 - 100 * Math.sqrt(3));
});

test('unfinished readings follow UUID across navigation and rename, while geometry context stays guarded', async ({ page }) => {
  const ids = await setup(page);
  await page.locator('#remeasure-a').fill('3'); await page.locator('#remeasure-b').fill('4');
  await page.locator('#review-next-point').click(); await expect(page.locator('#review-point')).toHaveValue(ids[1]);
  await page.locator('#remeasure-a').fill('2.5'); await page.locator('#remeasure-b').fill('2.5');
  await page.locator('#review-previous-point').click();
  await expect(page.locator('#remeasure-a')).toHaveValue('3'); await expect(page.locator('#remeasure-b')).toHaveValue('4');
  await page.locator('#review-label').fill('99'); await page.locator('#review-label').press('Enter');
  await expect(page.locator('#remeasure-save')).toBeEnabled();
  await page.evaluate(() => window.abplot.store.apply(doc => { doc.abDistance = 3; }));
  await expect(page.locator('#remeasure-status')).toContainText('changed while you were typing');
  await page.locator('#review-next-point').click(); await expect(page.locator('#remeasure-a')).toHaveValue('2.5');
  await expect(page.locator('#remeasure-save')).toBeDisabled();
  await page.locator('#remeasure-reset').click(); await expect(page.locator('#remeasure-status')).not.toContainText('changed while you were typing');
});

test('number and description search and review filters preserve the selected point', async ({ page }) => {
  const ids = await setup(page, [{ label: '1', description: 'Shallow steps', needsRemeasure: true }, { label: '2', description: 'Deep end' }, { label: 'A', description: 'Old name' }]);
  await page.locator('#review-filter').selectOption('flagged'); await expect(page.locator('#review-navigation-status')).toContainText('1 point shown');
  await page.locator('#review-filter').selectOption('all'); await page.locator('#review-search').fill('deep');
  await page.locator('#review-next-point').click(); await expect(page.locator('#review-point')).toHaveValue(ids[1]);
  await page.locator('#review-search').fill(''); await page.locator('#review-filter').selectOption('warnings');
  await page.locator('#review-next-point').click(); await expect(page.locator('#review-point')).toHaveValue(ids[2]);
  await page.locator('#review-search').fill('no match'); await expect(page.locator('#review-navigation-status')).toContainText('0 points shown');
  await expect(page.locator('#review-point')).toHaveValue(ids[2]); await expect(page.locator('#review-next-point')).toBeDisabled();
});

test('undo and redo of a point addition retain its unapplied name and measurement fields', async ({ page }) => {
  const [id] = await setup(page, [{ label: '1' }]);
  await page.locator('#review-label').fill('A'); await page.locator('#review-label').press('Tab');
  await page.locator('#remeasure-a').fill('3'); await page.locator('#remeasure-b').fill('4');
  await page.locator('#undo').click();
  expect(await page.evaluate(() => window.abplot.store.document.points.length)).toBe(0);
  await page.locator('#redo').click(); await page.locator('#review-point').selectOption(id);
  await expect(page.locator('#review-label')).toHaveValue('A');
  await expect(page.locator('#review-name-status')).toContainText('reserved');
  expect(await page.evaluate(() => window.abplot.store.document.points[0].label)).toBe('1');
  await expect(page.locator('#remeasure-a')).toHaveValue('3'); await expect(page.locator('#remeasure-b')).toHaveValue('4');
  await expect(page.locator('#remeasure-save')).toBeEnabled();
});
