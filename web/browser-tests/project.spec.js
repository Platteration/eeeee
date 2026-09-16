import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function setup(page) {
  await page.goto('/'); await page.waitForFunction(() => window.abplot?.photoPanel);
  await page.evaluate(() => window.abplot.store.apply(doc => { doc.name = 'Pool one'; doc.abDistance = 2; }));
  const bytes = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 600; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#6aabb6'; ctx.fillRect(0, 0, 1000, 600); return canvas.toDataURL().split(',')[1]; });
  await page.locator('#pool-photo-button').click();
  await page.locator('#photo-file').setInputFiles({ name: 'pool.png', mimeType: 'image/png', buffer: Buffer.from(bytes, 'base64') });
  await expect(page.locator('#photo-workspace')).toBeVisible();
}
async function screenPoint(page, x, y) {
  const canvas = page.locator('#photo-canvas'); await canvas.scrollIntoViewIfNeeded();
  return canvas.evaluate((svg, p) => { const q = new DOMPoint(p.x, p.y).matrixTransform(svg.getScreenCTM()); return { x: q.x, y: q.y }; }, { x, y });
}
async function click(page, x, y) { const p = await screenPoint(page, x, y); await page.mouse.click(p.x, p.y); }
const pins = page => page.evaluate(() => window.abplot.photoPanel.photo.pins);

test('photo selection cannot accidentally place the next point and moving changes only its match', async ({ page }) => {
  await setup(page); const before = await page.evaluate(() => JSON.stringify(window.abplot.store.document));
  await click(page, 240, 205); expect(await pins(page)).toEqual({});
  await page.locator('#photo-tool').selectOption('match'); await click(page, 240, 205);
  await expect(page.locator('#photo-point')).toHaveValue('B');
  await click(page, 240, 205); await expect(page.locator('#photo-point')).toHaveValue('A');
  expect(Object.keys(await pins(page))).toEqual(['A']);
  await page.locator('#photo-tool').selectOption('move');
  const from = await screenPoint(page, 240, 205), to = await screenPoint(page, 350, 300);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 4 }); await page.mouse.up();
  expect((await pins(page)).A.x).toBeGreaterThan(330);
  expect(await page.evaluate(() => JSON.stringify(window.abplot.store.document))).toBe(before);
  await page.locator('#photo-undo').click(); expect((await pins(page)).A.x).toBeLessThan(250);
});

test('keyboard nudges require Move and canceled dragging leaves a match unchanged', async ({ page }) => {
  await setup(page); await page.locator('#photo-tool').selectOption('match'); await click(page, 240, 205);
  await page.locator('#photo-point').selectOption('A'); await page.locator('#photo-tool').selectOption('select');
  const before = await pins(page); await page.locator('#photo-canvas').focus(); await page.keyboard.press('ArrowRight'); expect(await pins(page)).toEqual(before);
  await page.locator('#photo-tool').selectOption('move'); await page.locator('#photo-canvas').focus(); await page.keyboard.press('ArrowRight');
  expect((await pins(page)).A.x).toBe(before.A.x + 1);
  const now = await pins(page), svg = page.locator('#photo-canvas'), p = await screenPoint(page, now.A.x, now.A.y);
  const marker = page.locator('#photo-canvas [data-photo-id="A"] circle');
  await marker.dispatchEvent('pointerdown', { pointerId: 123, pointerType: 'touch', button: 0, clientX: p.x, clientY: p.y });
  await svg.dispatchEvent('pointermove', { pointerId: 123, clientX: p.x + 30, clientY: p.y + 30 });
  await svg.dispatchEvent('pointercancel', { pointerId: 123 }); expect(await pins(page)).toEqual(now);
});

test('photo measurement drafts survive reference changes and creation undoes with its match', async ({ page }) => {
  await setup(page); await page.locator('#photo-mode').selectOption('new'); await click(page, 350, 300);
  await page.locator('#photo-from-a').fill('2'); await page.locator('#photo-from-b').fill('2'); await page.locator('#photo-description').fill('Deep end');
  await page.locator('#photo-baseline').fill('3');
  expect(await page.evaluate(() => window.abplot.store.document.abDistance)).toBe(2);
  await page.locator('#photo-baseline-apply').click();
  await expect(page.locator('#photo-add-measured')).toBeDisabled(); await expect(page.locator('#photo-measure-status')).toContainText('reference or units changed');
  await expect(page.locator('#photo-from-a')).toHaveValue('2');
  await page.locator('#photo-draft-reset').click(); await page.locator('#photo-add-measured').click();
  const point = await page.evaluate(() => window.abplot.store.document.points[0]); expect(point.description).toBe('Deep end'); expect((await pins(page))[point.id]).toBeTruthy();
  await page.locator('#photo-undo').click(); expect(await page.evaluate(() => window.abplot.store.document.points.length)).toBe(0); expect((await pins(page))[point.id]).toBeUndefined();
});

test('main Save project includes the photo and plain project opening detaches it with atomic undo', async ({ page }) => {
  await setup(page); await page.locator('#photo-tool').selectOption('match'); await click(page, 240, 205);
  const downloading = page.waitForEvent('download'); await page.locator('#save-project').click(); const file = await downloading;
  const project = JSON.parse(await readFile(await file.path())); expect(project.format).toBe('abplot-photo-project'); expect(project.photo.pins.A).toBeTruthy();
  const asset = await page.evaluate(() => { window.previousAsset = window.abplot.store.projectPhoto.asset; return window.abplot.photoPanel.photo.dataUrl; });
  const plain = { ...project.document, name: 'Pool two', points: [] };
  await page.locator('#photo-project-file').setInputFiles({ name: 'plain.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plain)) });
  await expect(page.locator('#pool-photo')).toBeHidden(); expect(await page.evaluate(() => window.abplot.photoPanel.photo)).toBeNull();
  await page.evaluate(() => window.abplot.store.undo());
  expect(await page.evaluate(() => window.abplot.store.document.name)).toBe('Pool one');
  expect(await page.evaluate(() => window.abplot.photoPanel.photo.dataUrl)).toBe(asset);
  expect(await page.evaluate(() => window.abplot.store.projectPhoto.asset === window.previousAsset)).toBe(true);
});

test('detaching before the recovery debounce preserves the previous complete photo project', async ({ page }) => {
  await setup(page); await page.locator('#photo-tool').selectOption('match'); await click(page, 240, 205);
  const id = await page.evaluate(() => { const id = window.abplot.store.projectPhoto.recoveryId; window.abplot.photoPanel.replaceDocument({ ...window.abplot.store.document, name: 'Pool two', points: [] }); return id; });
  await expect.poll(() => page.evaluate(id => new Promise(resolve => {
    const request = indexedDB.open('abplot-photo-recovery', 1); request.onsuccess = () => { const db = request.result, tx = db.transaction('projects'), record = tx.objectStore('projects').get(id); tx.oncomplete = () => { db.close(); resolve(record.result?.text ?? null); }; };
  }), id)).toContain('"A":');
  expect(await page.evaluate(() => window.abplot.photoPanel.photo)).toBeNull();
  await page.evaluate(() => window.abplot.store.undo()); expect((await pins(page)).A).toBeTruthy();
});

test('a delayed project read cannot overwrite newer photo-only edits', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const text = JSON.stringify({ ...window.abplot.store.document, name: 'Incoming' });
    window.pendingOpen = window.abplot.photoPanel.openProject({ size: text.length, name: 'delayed.json', text: () => new Promise(resolve => { window.finishProjectRead = () => resolve(text); }) }).then(value => value, error => error.message);
    window.abplot.store.applyProject(project => { project.photo.pins.A = { x: 50, y: 60 }; });
    window.finishProjectRead();
  });
  expect(await page.evaluate(() => window.pendingOpen)).toContain('project changed');
  expect((await pins(page)).A).toEqual({ x: 50, y: 60 }); expect(await page.evaluate(() => window.abplot.store.document.name)).toBe('Pool one');
});

test('photo baseline drafts survive workspace navigation, reset explicitly and guard New project', async ({ page }) => {
  await setup(page);
  await page.locator('#photo-baseline').fill('2');
  expect(await page.evaluate(() => window.abplot.photoPanel.hasDraft)).toBe(false);
  await page.locator('#photo-baseline').fill('');
  expect(await page.evaluate(() => window.abplot.photoPanel.hasDraft)).toBe(true);
  await page.locator('#photo-baseline-reset').click(); await expect(page.locator('#photo-baseline')).toHaveValue('2');
  expect(await page.evaluate(() => window.abplot.photoPanel.hasDraft)).toBe(false);
  await page.locator('#photo-baseline').fill('5');
  await page.locator('#workspace-plan').click(); await page.locator('#pool-photo-button').click();
  await expect(page.locator('#photo-baseline')).toHaveValue('5');
  expect(await page.evaluate(() => window.abplot.store.document.abDistance)).toBe(2);
  await page.locator('#export-options-button').click();
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#reset').click();
  await expect(page.locator('#export-options')).toBeVisible(); await expect(page.locator('#pool-photo')).toBeVisible();
  await expect(page.locator('#photo-baseline')).toHaveValue('5');
  expect(await page.evaluate(() => window.abplot.photoPanel.hasDraft)).toBe(true);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#reset').click();
  await expect(page.locator('#export-options')).toBeHidden(); await expect(page.locator('#pool-photo')).toBeHidden();
  await expect(page.locator('#plan-canvas')).toBeVisible();
  expect(await page.evaluate(() => window.abplot.photoPanel.hasDraft)).toBe(false);
  expect(await page.evaluate(() => window.abplot.store.document.abDistance)).toBe(0);
  await page.evaluate(() => window.abplot.store.undo()); await page.locator('#pool-photo-button').click();
  await expect(page.locator('#photo-baseline')).toHaveValue('2');
});

test('opening a project discards a staged photo baseline only after confirmation', async ({ page }) => {
  await setup(page); await page.locator('#photo-baseline').fill('6');
  const text = await page.evaluate(() => JSON.stringify({ ...window.abplot.store.document, name: 'Incoming pool', abDistance: 9 }));
  const file = { name: 'incoming.json', mimeType: 'application/json', buffer: Buffer.from(text) };
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#photo-project-file').setInputFiles(file);
  await expect(page.locator('#photo-baseline')).toHaveValue('6');
  expect(await page.evaluate(() => window.abplot.store.document.name)).toBe('Pool one');
  expect(await page.evaluate(() => window.abplot.photoPanel.hasDraft)).toBe(true);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#photo-project-file').setInputFiles(file);
  await expect(page.locator('#pool-photo')).toBeHidden();
  expect(await page.evaluate(() => window.abplot.photoPanel.hasDraft)).toBe(false);
  expect(await page.evaluate(() => window.abplot.store.document.abDistance)).toBe(9);
  await page.evaluate(() => window.abplot.store.undo()); await page.locator('#pool-photo-button').click();
  await expect(page.locator('#photo-baseline')).toHaveValue('2');
});

test('an older recovery completion cannot report saved while a newer edit awaits debounce', async ({ page }) => {
  await setup(page);
  await expect.poll(() => page.evaluate(() => window.abplot.photoPanel.recoveryStatus.state)).toBe('saved');
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      ...descriptor,
      set(handler) {
        if (this.mode === 'readwrite' && this.objectStoreNames.contains('projects')) {
          Object.defineProperty(IDBTransaction.prototype, 'oncomplete', descriptor);
          descriptor.set.call(this, event => { window.finishOldPhotoWrite = () => handler.call(this, event); });
        } else descriptor.set.call(this, handler);
      },
    });
    window.abplot.store.applyProject(project => { project.photo.pins.A = { x: 100, y: 200 }; });
  });
  await page.waitForFunction(() => window.finishOldPhotoWrite);
  const status = await page.evaluate(async () => {
    window.abplot.store.applyProject(project => { project.photo.pins.B = { x: 600, y: 300 }; });
    window.finishOldPhotoWrite();
    await new Promise(requestAnimationFrame);
    return window.abplot.photoPanel.recoveryStatus.state;
  });
  expect(status).toBe('saving');
  await expect.poll(() => page.evaluate(() => window.abplot.photoPanel.recoveryStatus.state)).toBe('saved');
  const saved = await page.evaluate(async () => { const { photoRecovery } = await import('/src/photoRecovery.js'); return JSON.parse((await photoRecovery().list())[0].text); });
  expect(saved.photo.pins).toEqual({ A: { x: 100, y: 200 }, B: { x: 600, y: 300 } });
});
