import { seedBaseline, addPoint, showPoints } from './helpers.js';
import { test, expect } from '@playwright/test';

const KEY = 'abplot.web.document.v1';
const threePoints = {
  name: 'Fixes', pointA: [100, 400], pointB: [300, 400], abDistance: 4, unit: 'meters',
  points: [1, 2, 3].map(n => ({ id: `0000000${n}-0000-4000-8000-00000000000${n}`, label: String(n), position: [120 + 40 * n, 300], needsRemeasure: n === 2 })),
};
const seedThree = page => page.addInitScript(([key, doc]) => localStorage.setItem(key, JSON.stringify(doc)), [KEY, threePoints]);

/** WCAG contrast between an element's text colour and the first opaque background behind it. */
async function contrast(page, selector, { hover = false } = {}) {
  if (hover) await page.hover(selector);
  return page.evaluate(selector => {
    const parse = value => value.match(/[\d.]+/g).map(Number);
    const luminance = ([r, g, b]) => { const c = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const element = document.querySelector(selector);
    const text = parse(getComputedStyle(element).color);
    let node = element, background = null;
    while (node && !background) { const parsed = parse(getComputedStyle(node).backgroundColor); if (parsed.length === 3 || (parsed.length === 4 && parsed[3] > 0.99)) background = parsed.slice(0, 3); node = node.parentElement; }
    const [light, dark] = [luminance(text), luminance(background ?? [255, 255, 255])].sort((a, b) => b - a);
    return Number(((light + 0.05) / (dark + 0.05)).toFixed(2));
  }, selector);
}

test('phone landscape keeps the editor panel reachable and scrollable', async ({ page }) => {
  for (const [width, height] of [[844, 390], [740, 360], [812, 375]]) {
    await page.setViewportSize({ width, height });
    await seedBaseline(page); await page.goto('/');
    await expect(page.locator('#startup')).toBeHidden();
    const geometry = await page.evaluate(() => {
      const panel = document.getElementById('editor-panel').getBoundingClientRect();
      const content = document.getElementById('panel-content');
      return { panelTop: panel.top, panelBottom: panel.bottom, inner: innerHeight, contentHeight: content.clientHeight, scrollable: content.scrollHeight > content.clientHeight, overflowY: getComputedStyle(content).overflowY };
    });
    expect(geometry.panelTop, `${width}x${height}`).toBeLessThan(geometry.inner - 100);
    expect(geometry.panelBottom, `${width}x${height}`).toBeLessThanOrEqual(geometry.inner + 1);
    expect(geometry.contentHeight, `${width}x${height}`).toBeGreaterThan(60);
    expect(geometry.overflowY).toBe('auto');
    await expect(page.locator('#panel-measure')).toBeInViewport();
    await expect(page.getByLabel('A–B distance', { exact: true })).toBeInViewport();
    await page.locator('#panel-points').click();
    await expect(page.locator('#panel-points')).toHaveAttribute('aria-pressed', 'true');
    // Collapsing the panel gives the height back to the plan.
    await page.locator('#panel-collapse').click();
    const canvas = await page.locator('#canvas').boundingBox();
    expect(canvas.height, `${width}x${height} collapsed`).toBeGreaterThan(100);
  }
});

test('pressed and primary buttons keep a readable label under the pointer in both colour schemes', async ({ page }) => {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await seedBaseline(page); await page.goto('/');
    for (const selector of ['#save-project', '#workspace-plan', '#tool-select', '#panel-measure']) {
      expect(await contrast(page, selector, { hover: true }), `${scheme} ${selector}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(await contrast(page, '#tool-move', { hover: true }), `${scheme} plain button hover`).toBeGreaterThanOrEqual(4.5);
  }
});

test('dialogs and small panel text meet AA contrast in the dark scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await seedThree(page); await page.goto('/');
  await page.locator('#export-options-button').click();
  for (const selector of ['#sheet-note', '#export-options .checkbox', '#reset', '#export-options p']) expect(await contrast(page, selector), selector).toBeGreaterThanOrEqual(4.5);
  const dialog = await page.evaluate(() => { const style = getComputedStyle(document.getElementById('export-options')); return { background: style.backgroundColor, color: style.color }; });
  expect(dialog.background).not.toBe('rgb(255, 255, 255)');
  await page.locator('#export-close').click();
  await page.locator('#bulk-entry').click();
  expect(await contrast(page, '#measurement-import .note')).toBeGreaterThanOrEqual(4.5);
  await page.locator('#entry-close').click();
  await showPoints(page);
  expect(await contrast(page, '#clear')).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(page, '.remeasure-badge')).toBeGreaterThanOrEqual(4.5);
});

test('a file dropped on a file input or an open dialog is not hijacked as a project import', async ({ page }) => {
  await seedBaseline(page); await page.goto('/');
  await page.locator('#bulk-entry').click();
  const drop = (selector, name, type) => page.evaluate(([selector, name, type]) => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['1,2,3'], name, { type }));
    const event = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
    document.querySelector(selector).dispatchEvent(event);
    return event.defaultPrevented;
  }, [selector, name, type]);
  expect(await drop('#entry-file', 'rows.csv', 'text/csv')).toBe(false); // native input handling keeps the file
  expect(await drop('#measurement-import h2', 'rows.csv', 'text/csv')).toBe(true); // ignored, not imported
  await page.waitForTimeout(200);
  await expect(page.locator('#status')).not.toContainText('Could not import');
  await page.locator('#entry-close').click();
  expect(await drop('#plan-canvas', 'plot.json', 'application/json')).toBe(true);
  await expect(page.locator('#status')).toContainText('Could not import plot.json');
});

test('keyboard deletion acts on the focused row and keeps focus in the table; rejected labels revert', async ({ page }) => {
  await seedThree(page); await page.goto('/');
  await showPoints(page);
  const rows = page.locator('#measurements tbody tr');
  await rows.nth(0).locator('td').nth(3).click(); // highlight row 1 by clicking its read-only "From A" cell
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await rows.nth(2).focus();
  await page.keyboard.press('Delete');
  await expect(rows).toHaveCount(2);
  expect(await page.evaluate(() => window.abplot.store.document.points.map(p => p.label))).toEqual(['1', '2']);
  await expect(page.locator('#status')).toContainText('Deleted point 3');
  const focusedLabel = () => page.evaluate(() => document.activeElement.closest('tr')?.querySelector('input.label-input')?.value ?? document.activeElement.id);
  expect(await focusedLabel()).toBe('2');
  await rows.nth(1).locator('button.row-delete').focus();
  await page.keyboard.press('Space');
  await expect(rows).toHaveCount(1);
  expect(await focusedLabel()).toBe('1');

  const label = page.getByLabel('Label for point 1', { exact: true });
  await label.fill('A'); await label.press('Tab');
  await expect(page.locator('#status')).toContainText(/reserved|unique|Choose/i);
  await expect(label).toHaveValue('1');
  await expect(label).toHaveAttribute('aria-invalid', 'true');
});

test('holding an arrow key nudges a point as one undo step', async ({ page }) => {
  await seedThree(page); await page.goto('/');
  await showPoints(page);
  await page.locator('#measurements tbody tr').nth(0).locator('td').nth(3).click();
  await expect(page.locator('#measurements tbody tr').nth(0)).toHaveAttribute('aria-selected', 'true');
  const before = await page.evaluate(() => ({ ...window.abplot.store.document.points[0].position }));
  await page.locator('#tool-move').click(); // arrow keys nudge only in Move mode
  await page.locator('#canvas').focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  const moved = await page.evaluate(() => ({ ...window.abplot.store.document.points[0].position }));
  expect(moved.x).toBeGreaterThan(before.x);
  await page.locator('#undo').click();
  expect(await page.evaluate(() => ({ ...window.abplot.store.document.points[0].position }))).toEqual(before);
});

test('a touch that lifted over another control does not turn later single touches into pinches', async ({ page }) => {
  await seedBaseline(page); await page.goto('/');
  await page.locator('#tool-move').click();
  const svg = page.locator('#canvas');
  const box = await svg.boundingBox();
  const center = selector => svg.evaluate((root, sel) => { const r = root.querySelector(sel).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
  const b = await center('[data-handle="B"] [data-hit-target]');
  const touch = (pointerId, clientX, clientY) => ({ pointerId, pointerType: 'touch', isPrimary: pointerId === 601, button: 0, buttons: 1, clientX, clientY });
  await svg.dispatchEvent('pointerdown', touch(601, box.x + 20, box.y + 20));
  await page.locator('[data-handle="B"] [data-hit-target]').dispatchEvent('pointerdown', touch(602, b.x, b.y));
  await svg.dispatchEvent('pointerup', { ...touch(601, box.x + 20, box.y + 20), buttons: 0 });
  // The second finger lifts over the header: its pointerup never reaches the svg.
  await page.locator('.app-bar').dispatchEvent('pointerup', { ...touch(602, 5, 5), buttons: 0 });
  const before = await page.evaluate(() => ({ A: { ...window.abplot.store.document.pointA }, zoom: window.abplot.editor.unitsPerPixel }));
  const a = await center('[data-handle="A"] [data-hit-target]');
  await page.locator('[data-handle="A"] [data-hit-target]').dispatchEvent('pointerdown', touch(603, a.x, a.y));
  await svg.dispatchEvent('pointermove', touch(603, a.x + 40, a.y));
  await svg.dispatchEvent('pointermove', touch(603, a.x + 80, a.y));
  await svg.dispatchEvent('pointerup', { ...touch(603, a.x + 80, a.y), buttons: 0 });
  const after = await page.evaluate(() => ({ A: { ...window.abplot.store.document.pointA }, zoom: window.abplot.editor.unitsPerPixel }));
  expect(after.zoom).toBe(before.zoom);
  expect(after.A.x).toBeGreaterThan(before.A.x + 10);
});

test('loading the latest save after a conflict says the photo is detached and returns to the plan', async ({ page }) => {
  await seedBaseline(page); await page.goto('/');
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; c.getContext('2d').fillRect(0, 0, 300, 200); return c.toDataURL().split(',')[1]; });
  await page.locator('#pool-photo-button').click();
  await page.locator('#photo-file').setInputFiles({ name: 'pool.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(page.locator('#photo-workspace')).toBeVisible();
  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({ name: 'Other tab', pointA: [100, 400], pointB: [300, 400], abDistance: 2, unit: 'meters', points: [] })), KEY);
  await page.evaluate(() => window.abplot.store.apply(d => { d.name = 'Mine'; }));
  await expect(page.locator('#save-status')).toContainText('Another tab');
  let confirmText = '';
  page.once('dialog', dialog => { confirmText = dialog.message(); return dialog.accept(); });
  await page.locator('#retry-save').click();
  expect(confirmText).toContain('detaches the attached photo');
  await expect(page.locator('#status')).toContainText('photo was detached');
  await expect(page.locator('#pool-photo')).toBeHidden();
  await expect(page.locator('#plan-canvas')).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Other tab');
});

const wouldPrompt = page => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });

test('quick entry stays neutral until a reading is typed and the suggested number follows the plot', async ({ page }) => {
  await seedBaseline(page); await page.goto('/');
  await expect(page.locator('#quick-label')).toHaveValue('1');
  await page.locator('#quick-description').fill('Deep-end corner');
  await page.locator('#quick-side').selectOption('right');
  await expect(page.locator('#quick-status')).not.toContainText('not a number');
  await expect(page.locator('#quick-status')).toHaveAttribute('data-tone', 'ok');
  expect(await wouldPrompt(page)).toBe(true); // a typed description is worth keeping
  await page.locator('#quick-description').fill('');
  expect(await wouldPrompt(page)).toBe(false); // side and insertion choices alone are not a draft
  // Another point arriving keeps the suggestion current while it is still the automatic one.
  await page.evaluate(() => window.abplot.store.apply(d => { d.points.push({ id: '0000000A-0000-4000-8000-00000000000A', label: '1', position: { x: 150, y: 300 } }); }));
  await expect(page.locator('#quick-label')).toHaveValue('2');
  await page.locator('#quick-a').fill('2'); await page.locator('#quick-b').fill('2');
  await expect(page.locator('#quick-status')).toContainText('Ready to add');
  await page.locator('#quick-save').click();
  await expect(page.locator('#quick-status')).not.toContainText('not a number');
  expect(await page.evaluate(() => window.abplot.store.document.points.map(p => p.label))).toEqual(['1', '2']);
});

test('review drafts for deleted points or an unchanged name do not block leaving or opening a project', async ({ page }) => {
  await seedThree(page); await page.goto('/');
  await page.locator('#panel-points').click(); await page.locator('#review-details').evaluate(el => { el.open = true; });
  await page.locator('#review-point').selectOption('00000001-0000-4000-8000-000000000001');
  await page.locator('#review-label').fill('1x');
  expect(await wouldPrompt(page)).toBe(true);
  await page.locator('#review-label').fill('1');
  expect(await wouldPrompt(page)).toBe(false);
  await page.locator('#remeasure-a').fill('3');
  expect(await wouldPrompt(page)).toBe(true);
  await page.locator('#coordinate-table').evaluate(el => { el.open = true; });
  await page.locator('#measurements tbody tr').nth(0).locator('button.row-delete').click();
  await expect(page.locator('#measurements tbody tr')).toHaveCount(2);
  expect(await wouldPrompt(page)).toBe(false);
});
