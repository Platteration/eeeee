import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STORAGE_KEY, Store } from '../src/store.js';
import { defaultDocument } from '../src/plotDocument.js';

/** A stand-in for `window.localStorage`. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    get size() {
      return map.size;
    },
    map,
  };
}

const withPoint = () => ({
  ...defaultDocument(),
  points: [{ id: 'p1', label: '1', position: { x: 10, y: 20 } }],
});

describe('editing', () => {
  it('notifies subscribers and records undoable edits', () => {
    const store = new Store({ document: defaultDocument() });
    let notifications = 0;
    store.subscribe(() => (notifications += 1));

    store.apply((draft) => draft.points.push({ id: 'p1', label: '1', position: { x: 1, y: 2 } }));
    assert.equal(notifications, 1);
    assert.equal(store.document.points.length, 1);
    assert.equal(store.canUndo, true);

    store.undo();
    assert.equal(store.document.points.length, 0);
    assert.equal(store.canRedo, true);
    store.redo();
    assert.equal(store.document.points.length, 1);
  });

  it('ignores an edit that changes nothing', () => {
    const store = new Store({ document: defaultDocument() });
    store.apply((draft) => {
      draft.abDistance = draft.abDistance;
    });
    assert.equal(store.canUndo, false);
  });

  it('does not let a mutation reach into the previous document', () => {
    const store = new Store({ document: withPoint() });
    store.apply((draft) => {
      draft.points[0].position.x = 999;
    });
    store.undo();
    assert.equal(store.document.points[0].position.x, 10);
  });

  it('collapses a drag into a single undo step', () => {
    const store = new Store({ document: withPoint() });
    store.begin();
    for (const x of [11, 12, 13, 14]) {
      store.mutate((draft) => {
        draft.points[0].position.x = x;
      });
    }
    store.end();

    assert.equal(store.document.points[0].position.x, 14);
    store.undo();
    assert.equal(store.document.points[0].position.x, 10);
    assert.equal(store.canUndo, false, 'the whole drag should be one step');
  });

  it('records nothing for a drag that never moved', () => {
    const store = new Store({ document: withPoint() });
    store.begin();
    store.end();
    assert.equal(store.canUndo, false);
  });

  it('drops the redo stack once a new edit lands', () => {
    const store = new Store({ document: defaultDocument() });
    store.apply((draft) => (draft.abDistance = 5));
    store.undo();
    assert.equal(store.canRedo, true);
    store.apply((draft) => (draft.abDistance = 9));
    assert.equal(store.canRedo, false);
  });
});

describe('selection', () => {
  it('clears a selection the document no longer contains', () => {
    const store = new Store({ document: withPoint() });
    store.select('p1');
    store.apply((draft) => (draft.points = []));
    assert.equal(store.selectedId, 'p1', 'apply leaves selection alone');
    store.undo();
    store.select('p1');
    store.replace(defaultDocument());
    assert.equal(store.selectedId, null);
  });

  it('drops a stale selection when undoing past the point that created it', () => {
    const store = new Store({ document: defaultDocument() });
    store.apply((draft) => draft.points.push({ id: 'p9', label: '1', position: { x: 0, y: 0 } }));
    store.select('p9');
    store.undo();
    assert.equal(store.selectedId, null);
  });
});

describe('replace', () => {
  it('swaps the whole document as one undoable edit', () => {
    const store = new Store({ document: withPoint() });
    store.replace({ ...defaultDocument(), abDistance: 12, unit: 'feet' });
    assert.equal(store.document.points.length, 0);
    assert.equal(store.document.abDistance, 12);
    store.undo();
    assert.equal(store.document.points.length, 1);
  });
});

describe('persistence', () => {
  it('saves every change', () => {
    const storage = fakeStorage();
    const store = new Store({ document: defaultDocument(), storage });
    store.apply((draft) => (draft.abDistance = 7));
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).abDistance, 7);
  });

  it('restores what was saved', () => {
    const storage = fakeStorage({
      [STORAGE_KEY]: JSON.stringify({ pointA: [0, 0], pointB: [50, 0], abDistance: 9, unit: 'feet', points: [] }),
    });
    const store = Store.fromStorage(storage);
    assert.equal(store.document.abDistance, 9);
    assert.deepEqual(store.document.pointB, { x: 50, y: 0 });
  });

  it('falls back to a fresh plot when what is stored is unusable', () => {
    const store = Store.fromStorage(fakeStorage({ [STORAGE_KEY]: '{"pointA": "nope"}' }));
    assert.deepEqual(store.document, defaultDocument());
  });

  it('survives storage that refuses to write', () => {
    const store = new Store({
      document: defaultDocument(),
      storage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota exceeded');
        },
      },
    });
    store.apply((draft) => (draft.abDistance = 3));
    assert.equal(store.document.abDistance, 3);
  });
});

describe('save recovery', () => {
  it('surfaces quota errors and clears them after a successful retry', () => {
    let full = true;
    const storage = fakeStorage();
    const set = storage.setItem;
    storage.setItem = (key, value) => { if (full) throw new Error('quota'); set(key, value); };
    const store = new Store({ storage });
    store.apply((d) => { d.abDistance = 9; });
    assert.match(store.saveError, /Could not autosave/);
    full = false;
    store.retrySaving();
    assert.equal(store.saveError, null);
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).abDistance, 9);
    assert.equal(store.hasSaved, true);
  });
  it('keeps a corrupt autosave intact until replacement is explicitly requested', () => {
    const broken = '{bad json';
    const storage = fakeStorage({ [STORAGE_KEY]: broken });
    const store = Store.fromStorage(storage);
    store.apply((d) => { d.abDistance = 8; });
    store.retrySaving();
    assert.equal(storage.getItem(STORAGE_KEY), broken);
    assert.equal(store.recoveryText, broken);
    assert.equal(store.needsRecovery, true);
    store.retrySaving(storage, { replaceUnreadable: true });
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).abDistance, 8);
    assert.equal(store.saveError, null);
  });
  it('does not write merely because selection changes', () => {
    let writes = 0;
    const store = new Store({ document: withPoint(), storage: { setItem: () => writes++ } });
    store.select('p1');
    store.select(null);
    assert.equal(writes, 0);
  });
  it('reports unavailable storage and recovers when storage becomes available', () => {
    const store = new Store();
    assert.match(store.saveError, /unavailable/);
    store.retrySaving(fakeStorage());
    assert.equal(store.saveError, null);
  });
});

describe('gesture persistence', () => {
  it('writes a drag once and keeps it as one undo step', () => {
    let writes = 0;
    const storage = fakeStorage();
    const original = storage.setItem;
    storage.setItem = (key, value) => { writes++; original(key, value); };
    const store = new Store({ document: withPoint(), storage });
    store.begin();
    for (const x of [15, 25, 35]) store.mutate((d) => { d.points[0].position.x = x; });
    assert.equal(writes, 0);
    assert.equal(store.isEditing, true);
    store.end();
    assert.equal(writes, 1);
    assert.equal(store.isEditing, false);
    store.undo();
    assert.equal(store.document.points[0].position.x, 10);
    assert.equal(store.canUndo, false);
  });
  it('finishes an in-flight drag before a discrete edit or undo', () => {
    const store = new Store({ document: withPoint() });
    store.begin();
    store.mutate((d) => { d.points[0].position.x = 80; });
    store.apply((d) => { d.abDistance = 7; });
    store.undo();
    assert.equal(store.document.abDistance, 2);
    assert.equal(store.document.points[0].position.x, 80);
    store.undo();
    assert.equal(store.document.points[0].position.x, 10);
    store.begin();
    store.mutate((d) => { d.points[0].position.x = 90; });
    store.undo();
    assert.equal(store.document.points[0].position.x, 10);
    assert.equal(store.isEditing, false);
  });
  it('notifies the UI when a drag returns to its original position', () => {
    const store = new Store({ document: withPoint() });
    let editing;
    store.subscribe(() => { editing = store.isEditing; });
    store.begin();
    store.mutate((d) => { d.points[0].position.x = 30; });
    store.mutate((d) => { d.points[0].position.x = 10; });
    store.end();
    assert.equal(editing, false);
    assert.equal(store.canUndo, false);
  });
});
