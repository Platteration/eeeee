import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store, STORAGE_KEY } from '../src/store.js';
import { defaultDocument, serializeDocument, parseDocument } from '../src/plotDocument.js';
import { positionForOffsets } from '../src/measurements.js';
import { readPreferences } from '../src/preferences.js';
import { rasterSize, toCsv } from '../src/exporters.js';
import { LatestOperation, withTimeout } from '../src/operations.js';
import { abGrid } from '../src/grid.js';

const storage = (initial = null) => {
  let value = initial;
  return { getItem: () => value, setItem: (_, next) => { value = next; } };
};
test('overflow cannot enter state, history, autosave or JSON', () => {
  const doc = defaultDocument(), disk = storage(), store = new Store({ storage: disk });
  assert.equal(positionForOffsets(doc, { along: 1e308, perp: 0 }), null);
  const invalid = d => { d.points.push({ id: 'p', label: 'p', position: { x: Infinity, y: 0 } }); };
  assert.throws(() => store.apply(invalid), /finite/);
  assert.equal(store.canUndo, false); assert.equal(disk.getItem(), null);
  store.begin(); assert.throws(() => store.mutate(invalid), /finite/); store.end();
  invalid(doc); assert.throws(() => serializeDocument(doc), /finite/);
  assert.deepEqual(parseDocument(serializeDocument(store.document)), store.document);
});
test('failed recovery replacement preserves original and download until durable success', () => {
  const disk = storage('{broken'), write = disk.setItem;
  disk.setItem = () => { throw Error('quota'); };
  const store = Store.fromStorage(disk);
  store.retrySaving(disk, { replaceUnreadable: true });
  assert.equal(store.recoveryText, '{broken'); assert.equal(store.needsRecovery, true);
  assert.match(store.saveError, /Could not autosave/);
  disk.setItem = write; store.retrySaving(disk, { replaceUnreadable: true });
  assert.equal(store.recoveryText, null); assert.equal(store.needsRecovery, false);
});
test('blocked reads are not reported as corrupt documents', () => {
  const store = Store.fromStorage({ getItem() { throw Error('blocked'); } });
  assert.equal(store.needsRecovery, false); assert.equal(store.recoveryText, null);
  assert.match(store.saveError, /could not be read/);
});
test('concurrent locked saves preserve first writer and surface the stale tab', async () => {
  const disk = storage(); let queue = Promise.resolve();
  const locks = { request: (_, action) => queue = queue.then(action) };
  const first = Store.fromStorage(disk, { locks }), second = Store.fromStorage(disk, { locks });
  first.apply(d => { d.name = 'First tab'; }); second.apply(d => { d.abDistance = 7; });
  await Promise.all([first.whenSaved(), second.whenSaved()]);
  assert.equal(JSON.parse(disk.getItem(STORAGE_KEY)).name, 'First tab');
  assert.equal(second.hasConflict, true); assert.equal(second.document.abDistance, 7);
  second.loadLatest(); assert.equal(second.document.name, 'First tab'); assert.equal(second.hasConflict, false);
});
test('a browser without locking keeps edits exportable and does not write', () => {
  const disk = storage(), store = Store.fromStorage(disk, { locks: null });
  store.apply(d => { d.name = 'Unsaved'; });
  assert.equal(disk.getItem(), null); assert.match(store.saveError, /Safe autosave/);
  assert.equal(parseDocument(serializeDocument(store.document)).name, 'Unsaved');
});
test('malformed preferences are individually defaulted', () => {
  for (const raw of ['null', '[]', '{', '{"sheet":12,"planScale":{},"annotateExports":"yes"}', '{"sheet":"bogus"}']) {
    assert.deepEqual(readPreferences(storage(raw)), { sheet: '', planScale: '', annotateExports: false });
  }
});
test('PNG rejects excessive dimensions and CSV escapes formulas only in text', () => {
  assert.throws(() => rasterSize('<svg width="1000" height="1000000">', { pixelRatio: 2 }), /megapixel/);
  const doc = defaultDocument(); doc.points.push({ id: 'p', label: '=1+1', position: { x: 0, y: 0 } });
  const csv = toCsv(doc); assert.match(csv, /'=1\+1/); assert.match(csv, /,-1\.0000,/);
});
test('obsolete asynchronous operations are ignored and timeouts release callers', async () => {
  const operation = new LatestOperation(), old = operation.start(), current = operation.start();
  assert.equal(old(), false); assert.equal(current(), true); operation.cancel(); assert.equal(current(), false);
  await assert.rejects(withTimeout(new Promise(() => {}), 5), /timed out/);
});
test('huge grid indices terminate without unsafe integer loops', () => {
  assert.equal(abGrid(defaultDocument(), { x: 1e30, y: 1e30, w: 100, h: 100 }, 40), null);
});
