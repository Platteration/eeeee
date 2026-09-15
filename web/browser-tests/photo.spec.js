import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openPhoto(page) {
  await page.goto('/');
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1000; c.height = 600;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#6b8263'; ctx.fillRect(0, 0, 1000, 600);
    ctx.fillStyle = '#ccc9b8'; ctx.beginPath(); ctx.moveTo(220, 180); ctx.lineTo(740, 160); ctx.lineTo(880, 460); ctx.lineTo(80, 470); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#148cbd'; ctx.beginPath(); ctx.moveTo(240, 205); ctx.lineTo(720, 185); ctx.lineTo(830, 420); ctx.lineTo(135, 435); ctx.closePath(); ctx.fill();
    return c.toDataURL().split(',')[1];
  });
  await page.locator('#pool-photo-button').click();
  await page.locator('#photo-file').setInputFiles({ name: 'pool.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(page.locator('#photo-workspace')).toBeVisible();
}
async function clickPhoto(page, x, y) {
  const canvas = page.locator('#photo-canvas'); await canvas.scrollIntoViewIfNeeded();
  const point = await canvas.evaluate((svg, p) => { const matrix = svg.getScreenCTM(), q = new DOMPoint(p.x, p.y).matrixTransform(matrix); return { x: q.x, y: q.y, tolerance: 2 / matrix.a }; }, { x, y });
  await page.mouse.click(point.x, point.y);
  // Firefox/WebKit quantize native pointer positions to CSS pixels. Check
  // image alignment within two screen pixels rather than subpixel strings.
  return point.tolerance;
}
test('existing points match the photo without changing measurements, and marks undo', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await openPhoto(page);
  const before = await page.evaluate(() => JSON.stringify(window.abplot.store.document));
  await clickPhoto(page, 240, 205); await expect(page.locator('#photo-point')).toHaveValue('B');
  await clickPhoto(page, 720, 185);
  await expect(page.locator('#photo-canvas [data-photo-id]')).toHaveCount(2);
  expect(await page.evaluate(() => JSON.stringify(window.abplot.store.document))).toBe(before);
  await page.locator('#photo-undo').click(); await expect(page.locator('#photo-canvas [data-photo-id]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
test('click-first entry validates A/B distances and overlays the resulting measured point', async ({ page }) => {
  await openPhoto(page); await page.locator('#photo-mode').selectOption('new'); const tolerance = await clickPhoto(page, 300, 250);
  await page.locator('#photo-label').fill('Corner'); await page.locator('#photo-from-a').fill('0.1'); await page.locator('#photo-from-b').fill('0.1');
  await page.locator('#photo-add-measured').click(); await expect(page.locator('#photo-status')).toContainText('triangle');
  expect(await page.evaluate(() => window.abplot.store.document.points.length)).toBe(0);
  await page.locator('#photo-from-a').fill(String(Math.sqrt(2))); await page.locator('#photo-from-b').fill(String(Math.sqrt(2)));
  await page.locator('#photo-add-measured').click();
  const point = await page.evaluate(() => window.abplot.store.document.points[0]);
  expect(point.label).toBe('Corner'); expect(point.position.x).toBeCloseTo(200); expect(point.position.y).toBeCloseTo(300);
  const marker = page.locator(`#photo-canvas [data-photo-id="${point.id}"] circle`);
  expect(Math.abs(Number(await marker.getAttribute('cx')) - 300)).toBeLessThan(tolerance);
  expect(Math.abs(Number(await marker.getAttribute('cy')) - 250)).toBeLessThan(tolerance);
});
test('photo projects reopen with marks and exports contain the embedded photo', async ({ page }) => {
  await openPhoto(page); const tolerance = await clickPhoto(page, 240, 205);
  const saving = page.waitForEvent('download'); await page.locator('#photo-save-project').click(); const saved = await saving;
  const bytes = await readFile(await saved.path()), project = JSON.parse(bytes);
  expect(project.format).toBe('abplot-photo-project'); expect(Math.abs(project.photo.pins.A.x - 240)).toBeLessThan(tolerance); expect(project.photo.dataUrl).toContain('data:image/png;base64,');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#photo-project-file').setInputFiles({ name: 'saved-photo.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.locator('#photo-status')).toContainText('Opened saved-photo.json');
  await expect(page.locator('#photo-canvas [data-photo-id="A"]')).toBeVisible();
  for (const format of ['svg', 'png']) {
    const downloading = page.waitForEvent('download'); await page.locator(`#photo-export-${format}`).click();
    const file = await downloading; expect(await file.failure()).toBeNull(); const exported = await readFile(await file.path());
    if (format === 'svg') expect(exported.toString()).toContain('<image href="data:image/png;base64,');
    else expect(exported.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  }
});
test('photo clicks stay aligned after zoom, and cancelled touch creates no marker', async ({ page }) => {
  await openPhoto(page); await page.locator('#photo-zoom-in').click(); const tolerance = await clickPhoto(page, 400, 300);
  const marker = page.locator('#photo-canvas [data-photo-id="A"] circle'); expect(Math.abs(Number(await marker.getAttribute('cx')) - 400)).toBeLessThan(tolerance);
  const svg = page.locator('#photo-canvas');
  await svg.dispatchEvent('pointerdown', { pointerId: 99, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
  await svg.dispatchEvent('pointercancel', { pointerId: 99, pointerType: 'touch' });
  await svg.dispatchEvent('pointerup', { pointerId: 99, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
  await expect(page.locator('#photo-canvas [data-photo-id]')).toHaveCount(1);
});

test('four photo matches project the remaining point without changing the plot', async ({ page }) => {
  await openPhoto(page);
  const ids = await page.evaluate(() => {
    const points = [[300, 200], [100, 200], [200, 300]].map(([x, y], index) => ({ id: crypto.randomUUID().toUpperCase(), label: String(index + 1), position: { x, y } }));
    window.abplot.store.apply(doc => { doc.points = points; }); return points.map(p => p.id);
  });
  const before = await page.evaluate(() => JSON.stringify(window.abplot.store.document));
  await page.locator('#photo-project').check(); await expect(page.locator('#photo-fit-note')).toContainText('at least four');
  await page.locator('#photo-next').uncheck();
  for (const [id, x, y] of [['A', 200, 450], ['B', 800, 450], [ids[0], 700, 180], [ids[1], 300, 180]]) {
    await page.locator('#photo-point').selectOption(id); await clickPhoto(page, x, y);
  }
  await expect(page.locator('#photo-fit-note')).toContainText('Perspective fit: 4 matches');
  const projected = page.locator(`#photo-canvas [data-photo-id="${ids[2]}"] circle`);
  await expect(projected).toHaveAttribute('fill', '#0008');
  expect(Math.abs(Number(await projected.getAttribute('cx')) - 500)).toBeLessThan(8);
  expect(await page.evaluate(() => JSON.stringify(window.abplot.store.document))).toBe(before);
  await page.locator('#photo-project').uncheck(); await expect(projected).toHaveCount(0);
});

test('removing a photo cancels a pending replacement and invalid baseline restores its value', async ({ page }) => {
  await openPhoto(page);
  await page.locator('#photo-baseline').fill('-1'); await page.locator('#photo-unit').focus();
  await expect(page.locator('#photo-baseline')).toHaveValue('2');
  const image = await page.locator('#photo-canvas image').getAttribute('href');
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    window.createImageBitmap = async (...args) => { await new Promise(resolve => { window.resumePhotoRead = resolve; }); window.createImageBitmap = original; return original(...args); };
  });
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#photo-file').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(image.split(',')[1], 'base64') });
  await page.waitForFunction(() => Boolean(window.resumePhotoRead));
  await page.locator('#photo-remove').click(); await page.evaluate(() => window.resumePhotoRead());
  await expect(page.locator('#photo-workspace')).toBeHidden();
  await expect(page.locator('#photo-status')).toContainText('Photo removed');
  await expect(page.locator('#photo-canvas image')).not.toHaveAttribute('href');
});
