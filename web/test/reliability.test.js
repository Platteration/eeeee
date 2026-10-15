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
test('a browser without a lock manager still autosaves and warns that tabs are unprotected', () => {
  const disk = storage(), store = Store.fromStorage(disk, { locks: null });
  store.apply(d => { d.name = 'Plain HTTP'; });
  assert.equal(JSON.parse(disk.getItem()).name, 'Plain HTTP');
  assert.equal(store.saveError, null); assert.equal(store.hasSaved, true);
  assert.match(store.saveWarning, /not a secure origin/); assert.match(store.saveWarning, /one tab/);
  assert.equal(Store.fromStorage(disk, { locks: null }).document.name, 'Plain HTTP');
  // The last-read check survives without the lock: a save another tab finished first is not overwritten.
  disk.setItem(STORAGE_KEY, JSON.stringify({ ...defaultDocument(), name: 'Other tab' }));
  store.apply(d => { d.abDistance = 9; });
  assert.equal(JSON.parse(disk.getItem()).name, 'Other tab'); assert.equal(store.hasConflict, true);
  assert.equal(parseDocument(serializeDocument(store.document)).abDistance, 9);
  assert.equal(new Store({ storage: disk, locks: { request() {} } }).saveWarning, null);
  assert.equal(new Store({ storage: null, locks: null }).saveWarning, null);
});
test('malformed preferences are individually defaulted', () => {
  for (const raw of ['null', '[]', '{', '{"sheet":12,"planScale":{},"annotateExports":"yes"}', '{"sheet":"bogus"}']) {
    assert.deepEqual(readPreferences(storage(raw)), { sheet: '', planScale: '', annotateExports: false });
  }
});
test('PNG stays within the phone canvas area, rejects unrasterizable shapes, and CSV escapes formulas only in text', () => {
  // Oversized sheets are scaled down to the canvas area a phone can draw; a shape that still
  // needs more than 16384 px on a side after that is refused rather than encoded blank.
  const capped = rasterSize('<svg width="10000" height="10000">', { pixelRatio: 2 });
  assert.ok(capped.width * capped.height <= 16777216 && capped.width >= 4090, `${capped.width}x${capped.height}`);
  assert.throws(() => rasterSize('<svg width="1000" height="1000000">', { pixelRatio: 2 }), /too elongated/);
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

test('leaving the page flushes a save still waiting for the lock', async () => {
  const disk = storage(); let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const locks = { request: async (_, action) => { entered(); await new Promise(resolve => { release = resolve; }); return action(); } };
  const store = Store.fromStorage(disk, { locks });
  assert.equal(store.flush(), false); assert.equal(disk.getItem(), null);
  store.apply(d => { d.name = 'Leaving'; }); await started;
  assert.equal(disk.getItem(), null); assert.equal(store.isSaving, true);
  assert.equal(store.flush(), true);
  assert.equal(JSON.parse(disk.getItem()).name, 'Leaving'); assert.equal(store.hasSaved, true);
  release(); await store.whenSaved();
  assert.equal(store.hasConflict, false); assert.equal(store.isSaving, false); assert.equal(store.saveError, null);
  assert.equal(JSON.parse(disk.getItem()).name, 'Leaving');
});
test('the unload flush never overwrites a save another tab finished first', async () => {
  const disk = storage(); let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const locks = { request: async (_, action) => { entered(); await new Promise(resolve => { release = resolve; }); return action(); } };
  const store = Store.fromStorage(disk, { locks });
  store.apply(d => { d.name = 'Mine'; }); await started;
  const theirs = JSON.stringify({ ...defaultDocument(), name: 'Theirs' }); disk.setItem(STORAGE_KEY, theirs);
  assert.equal(store.flush(), false); assert.equal(disk.getItem(), theirs);
  release(); await store.whenSaved();
  assert.equal(store.hasConflict, true); assert.equal(disk.getItem(), theirs);
});
test('edits during a locked recovery replacement are subsequently saved', async () => {
  const disk = storage('{broken'); let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  let first = true;
  const locks = { request: async (_, action) => { if (first) { first = false; entered(); await new Promise(resolve => { release = resolve; }); } return action(); } };
  const store = Store.fromStorage(disk, { locks });
  store.retrySaving(disk, { replaceUnreadable: true }); await started;
  store.apply(doc => { doc.name = 'Edited while recovering'; });
  assert.equal(store.isSaving, true); release();
  await store.whenSaved(); await store.whenSaved();
  assert.equal(JSON.parse(disk.getItem()).name, 'Edited while recovering');
  assert.equal(store.isSaving, false); assert.equal(store.needsRecovery, false);
});

test('a queued save never regresses a newer document the unload flush already stored', async () => {
  const disk = storage(); let open; const opened = new Promise(resolve => { open = resolve; });
  const locks = { request: async (_, action) => { await opened; return action(); } };
  const store = Store.fromStorage(disk, { locks });
  const writes = [], write = disk.setItem; disk.setItem = (key, value) => { writes.push(JSON.parse(value).name); write(key, value); };
  store.apply(d => { d.name = 'edit 1'; }); store.apply(d => { d.name = 'edit 2'; });
  assert.equal(store.flush(), true); assert.deepEqual(writes, ['edit 2']);
  open(); await store.whenSaved();
  assert.deepEqual(writes, ['edit 2'], 'the queued writes must not put edit 1 back, even briefly');
  assert.equal(JSON.parse(disk.getItem()).name, 'edit 2'); assert.equal(store.hasUnsavedChanges, false);
  store.apply(d => { d.name = 'edit 3'; }); await store.whenSaved();
  assert.deepEqual(writes, ['edit 2', 'edit 3'], 'later saves still write');
});

test('unsaved changes are reported while autosave is paused, failed or unavailable, and clear on a durable write', async () => {
  const disk = storage(), store = Store.fromStorage(disk);
  store.apply(d => { d.name = 'mine'; }); assert.equal(store.hasUnsavedChanges, false);
  disk.setItem(STORAGE_KEY, JSON.stringify({ ...defaultDocument(), name: 'theirs' })); // another tab saved
  store.apply(d => { d.name = 'mine again'; });
  assert.equal(store.hasConflict, true); assert.equal(store.hasUnsavedChanges, true);
  store.loadLatest(); assert.equal(store.hasUnsavedChanges, false);

  const failing = storage(), write = failing.setItem; failing.setItem = () => { throw Error('quota'); };
  const memoryOnly = Store.fromStorage(failing);
  memoryOnly.apply(d => { d.name = 'quota'; });
  assert.match(memoryOnly.saveError, /only in memory/); assert.equal(memoryOnly.hasUnsavedChanges, true);
  failing.setItem = write; memoryOnly.retrySaving(); assert.equal(memoryOnly.hasUnsavedChanges, false);

  const noStorage = new Store({ storage: null });
  assert.equal(noStorage.hasUnsavedChanges, false);
  noStorage.apply(d => { d.name = 'nowhere to save'; }); assert.equal(noStorage.hasUnsavedChanges, true);

  let release, entered, requested;
  const locks = { request: async (_, action) => { entered(); await new Promise(resolve => { release = resolve; }); return action(); } };
  const queued = Store.fromStorage(storage(), { locks });
  requested = new Promise(resolve => { entered = resolve; });
  queued.apply(d => { d.name = 'waiting'; }); assert.equal(queued.hasUnsavedChanges, true, 'still waiting for the lock');
  await requested; release(); await queued.whenSaved(); assert.equal(queued.hasUnsavedChanges, false);
  requested = new Promise(resolve => { entered = resolve; });
  queued.apply(d => { d.name = 'flushed'; }); assert.equal(queued.flush(), true); assert.equal(queued.hasUnsavedChanges, false);
  await requested; release(); await queued.whenSaved(); assert.equal(queued.hasUnsavedChanges, false);
});
