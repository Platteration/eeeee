import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, STORAGE_KEY } from '../src/store.js';
import { defaultDocument } from '../src/plotDocument.js';
import { photoState, photoFromState } from '../src/projectState.js';

const image = () => photoState({ name: 'Pool', width: 10, height: 10, dataUrl: 'data:image/png;base64,cGl4ZWxz', pins: { A: { x: 2, y: 3 } }, settings: { opacity: 0.9 } }, 'recovery-one');
function storage() { const map = new Map(); return { map, getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) }; }

test('project replacement and undo restore a consistent document/photo pair', () => {
  const store = new Store();
  store.applyProject(project => { project.document.name = 'Pool one'; project.photo = image(); });
  const asset = store.projectPhoto.asset;
  store.applyProject(project => { project.document = { ...defaultDocument(), name: 'Pool two' }; project.photo = null; });
  assert.equal(store.projectPhoto, null);
  store.undo(); assert.equal(store.document.name, 'Pool one'); assert.equal(store.projectPhoto.asset, asset); assert.deepEqual(store.projectPhoto.pins.A, { x: 2, y: 3 });
  store.redo(); assert.equal(store.document.name, 'Pool two'); assert.equal(store.projectPhoto, null);
});

test('point creation and photo matching are one undo action with shared immutable image bytes', () => {
  const store = new Store(); store.applyProject(project => { project.photo = image(); });
  const asset = store.projectPhoto.asset;
  store.applyProject(project => { project.document.points.push({ id: 'point', label: '1', position: { x: 3, y: 4 } }); project.photo.pins.point = { x: 6, y: 7 }; });
  assert.equal(store.projectPhoto.asset, asset);
  assert.ok(Object.isFrozen(asset));
  store.undo(); assert.equal(store.document.points.length, 0); assert.equal(store.projectPhoto.pins.point, undefined); assert.equal(store.projectPhoto.asset, asset);
  store.redo(); assert.equal(store.document.points.length, 1); assert.deepEqual(store.projectPhoto.pins.point, { x: 6, y: 7 });
});

test('photo moves preserve measurements and prior snapshots while serializing only plot autosave', () => {
  const disk = storage(), store = new Store({ storage: disk }); store.applyProject(project => { project.photo = image(); });
  const doc = structuredClone(store.document), before = store.projectPhoto;
  store.applyProject(project => { project.photo.pins.A.x = 8; });
  assert.deepEqual(store.document, doc); assert.equal(before.pins.A.x, 2); assert.equal(store.projectPhoto.asset, before.asset);
  assert.deepEqual(JSON.parse(disk.getItem(STORAGE_KEY)), doc);
  assert.equal(photoFromState(store.projectPhoto).dataUrl, before.asset.dataUrl);
  store.undo(); assert.equal(store.projectPhoto.pins.A.x, 2);
});

test('a focus token groups text edits without postponing autosave', () => {
  const disk = storage(), store = new Store({ storage: disk }), focus = {};
  for (const value of ['P', 'Po', 'Pool']) { store.apply(doc => { doc.name = value; }, { historyGroup: focus }); assert.equal(JSON.parse(disk.getItem(STORAGE_KEY)).name, value); }
  store.undo(); assert.equal(store.document.name, defaultDocument().name); assert.equal(store.canUndo, false);
  store.redo(); assert.equal(store.document.name, 'Pool');
  store.apply(doc => { doc.name = 'Pool two'; }, { historyGroup: focus }); store.undo(); assert.equal(store.document.name, 'Pool');
});

test('unrelated edits and blur end a history group even if the field token is reused', () => {
  const store = new Store(), focus = {};
  store.apply(doc => { doc.name = 'Pool'; }, { historyGroup: focus });
  store.apply(doc => { doc.abDistance = 10; });
  store.apply(doc => { doc.name = 'Pool notes'; }, { historyGroup: focus });
  store.undo(); assert.equal(store.document.name, 'Pool'); assert.equal(store.document.abDistance, 10);
  store.undo(); assert.equal(store.document.abDistance, 2);
  store.endHistoryGroup(); store.apply(doc => { doc.name = 'Renamed'; }, { historyGroup: focus });
  store.undo(); assert.equal(store.document.name, 'Pool');
});

test('fresh browser defaults do not create an undo step, and latest plot detaches photo', () => {
  const disk = storage(), doc = { ...defaultDocument(), abDistance: 0 }, store = Store.fromStorage(disk, { document: doc });
  assert.equal(store.document.abDistance, 0); assert.equal(store.canUndo, false); assert.equal(disk.map.size, 0);
  store.applyProject(project => { project.photo = image(); });
  disk.setItem(STORAGE_KEY, JSON.stringify({ ...defaultDocument(), name: 'Other tab' }));
  store.loadLatest(); assert.equal(store.projectPhoto, null); assert.equal(store.document.name, 'Other tab'); assert.equal(store.canUndo, false);
});
