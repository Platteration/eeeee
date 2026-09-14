/**
 * Document state: one place that owns the plot, its selection, its undo history
 * and its autosave. Views subscribe and re-render; nothing mutates the document
 * behind the store's back.
 *
 * Edits come in two shapes. Discrete ones (add a point, change the unit) go
 * through {@link Store#apply} and land on the undo stack immediately. Dragging
 * is a stream of edits that should undo as a single move, so it brackets with
 * {@link Store#begin} / {@link Store#end} and the intermediate frames never
 * reach the history.
 */

import { defaultDocument, parseDocument } from './plotDocument.js';
import { validateGeometry } from './validation.js';

const STORAGE_KEY = 'abplot.web.document.v1';
const HISTORY_LIMIT = 100;

const clone = (value) =>
  typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

export class Store {
  #doc;
  #selectedId = null;
  #undo = [];
  #redo = [];
  #pending = null;
  #listeners = new Set();
  #storage;
  #saveError = null;
  #recoveryText = null;
  #loadError = null;
  #hasSaved = false;
  #expected = null;
  #conflict = false;
  #locks;
  #saving = false;
  #queue = Promise.resolve();
  #revision = 0;
  #epoch = 0;

  constructor({ document: doc = defaultDocument(), storage = null, locks = undefined } = {}) {
    validateGeometry(doc);
    this.#doc = clone(doc);
    this.#storage = storage;
    this.#locks = locks;
  }

  /**
   * Restore the last session's plot, falling back to a fresh document when
   * nothing is stored or what is stored no longer parses.
   */
  static fromStorage(storage, { locks } = {}) {
    const store = new Store({ storage, locks });
    let saved;
    try {
      saved = storage?.getItem(STORAGE_KEY) ?? null;
      store.#expected = saved;
    } catch {
      store.#saveError = 'Browser storage could not be read. Export JSON to keep your work.';
      return store;
    }
    try {
      if (saved) {
        store.#recoveryText = saved;
        store.#doc = parseDocument(saved);
        store.#recoveryText = null;
        store.#hasSaved = true;
      }
    } catch (error) {
      store.#loadError = 'The previous saved plot could not be opened. Download its recovery copy before saving over it.';
    }
    return store;
  }

  get saveError() {
    return this.#saveError ?? this.#loadError ?? (!this.#storage ? 'Browser storage is unavailable. Export JSON to keep your work.' : this.#locks === null ? 'Safe autosave is unavailable in this browser. Export JSON to keep your work.' : null);
  }

  get revision() { return this.#revision; }
  get hasConflict() { return this.#conflict; }
  get isSaving() { return this.#saving; }
  whenSaved() { return this.#queue; }

  loadLatest() {
    const saved = this.#storage?.getItem(STORAGE_KEY) ?? null;
    const doc = saved === null ? defaultDocument() : parseDocument(saved);
    this.#epoch++;
    this.#expected = saved;
    this.#conflict = false;
    this.#saveError = this.#loadError = this.#recoveryText = null;
    this.#pending = null;
    this.#undo = []; this.#redo = [];
    this.#doc = doc; this.#selectedId = null; this.#revision++;
    this.#hasSaved = saved !== null;
    this.#changed(false);
  }

  get recoveryText() { return this.#recoveryText; }
  get hasSaved() { return this.#hasSaved; }
  get isEditing() { return this.#pending !== null; }
  get needsRecovery() { return this.#loadError !== null; }

  retrySaving(storage = this.#storage, { replaceUnreadable = false } = {}) {
    this.#storage = storage;
    // Never overwrite an unreadable autosave until the user has backed it up.
    if (this.#loadError && !replaceUnreadable) return;
    return this.#save(replaceUnreadable);
  }

  get document() {
    return this.#doc;
  }

  get selectedId() {
    return this.#selectedId;
  }

  get selectedPoint() {
    return this.#doc.points.find((point) => point.id === this.#selectedId) ?? null;
  }

  get canUndo() {
    return this.#undo.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  /** Subscribe to every change; returns an unsubscribe function. */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Apply `mutate(draft)` as one undoable edit. */
  apply(mutate) {
    this.end();
    const before = clone(this.#doc);
    const draft = clone(this.#doc);
    mutate(draft);
    validateGeometry(draft);
    if (JSON.stringify(draft) === JSON.stringify(before)) return;
    this.#doc = draft;
    this.#revision++;
    this.#pushUndo(before);
    this.#changed();
  }

  /** Start a gesture whose intermediate states should not enter the history. */
  begin() {
    this.end();
    this.#pending = clone(this.#doc);
  }

  /** Apply a frame of an in-progress gesture. */
  mutate(mutate) {
    if (!this.#pending) { this.apply(mutate); return; }
    const draft = clone(this.#doc);
    mutate(draft);
    validateGeometry(draft);
    this.#doc = draft;
    this.#revision++;
    this.#changed(false);
  }

  /** Finish a gesture, recording it as a single undoable edit if it changed anything. */
  end() {
    const before = this.#pending;
    this.#pending = null;
    if (!before) return;
    if (JSON.stringify(before) === JSON.stringify(this.#doc)) {
      this.#changed(false);
      return;
    }
    this.#pushUndo(before);
    this.#changed();
  }

  /** Replace the whole document (import, or "start over") as one edit. */
  replace(doc) {
    this.apply((draft) => {
      Object.assign(draft, clone(doc));
      // Object.assign leaves stale keys behind if the incoming doc has fewer.
      for (const key of Object.keys(draft)) {
        if (!(key in doc)) delete draft[key];
      }
    });
    if (!this.#doc.points.some((point) => point.id === this.#selectedId)) {
      this.#selectedId = null;
      this.#changed();
    }
  }

  select(id) {
    if (this.#selectedId === id) return;
    this.#selectedId = id;
    this.#changed(false);
  }

  undo() {
    this.end();
    if (!this.canUndo) return;
    this.#redo.push(clone(this.#doc));
    this.#doc = this.#undo.pop();
    this.#afterHistoryStep();
  }

  redo() {
    this.end();
    if (!this.canRedo) return;
    this.#undo.push(clone(this.#doc));
    this.#doc = this.#redo.pop();
    this.#afterHistoryStep();
  }

  #afterHistoryStep() {
    this.#revision++;
    if (!this.#doc.points.some((point) => point.id === this.#selectedId)) this.#selectedId = null;
    this.#changed();
  }

  #pushUndo(snapshot) {
    this.#undo.push(snapshot);
    if (this.#undo.length > HISTORY_LIMIT) this.#undo.shift();
    this.#redo.length = 0;
  }

  #changed(save = true) {
    if (save) this.#save();
    for (const listener of this.#listeners) {
      try { listener(this); } catch (error) { globalThis.reportError?.(error); }
    }
  }

  #save(replaceUnreadable = false) {
    if (!this.#storage || this.#locks === null || this.#conflict || (this.#loadError && !replaceUnreadable)) return;
    const text = JSON.stringify(this.#doc);
    const epoch = this.#epoch;
    const persist = () => {
      if (epoch !== this.#epoch || this.#conflict) return;
      try {
        if ((this.#storage.getItem(STORAGE_KEY) ?? null) !== this.#expected) {
          this.#conflict = true;
          this.#saveError = 'Another tab saved a different plot. Autosave paused. Download your version or load the latest save.';
          return;
        }
        this.#storage.setItem(STORAGE_KEY, text);
        this.#expected = text;
        this.#hasSaved = true;
        this.#saveError = null;
        if (replaceUnreadable) { this.#loadError = null; this.#recoveryText = null; }
      } catch {
        this.#saveError = 'Could not autosave. Your latest changes are only in memory. Retry saving or export JSON.';
      } finally { this.#changed(false); }
    };
    // Undefined is the synchronous test/non-browser adapter. Browser callers
    // explicitly supply LockManager or null; they never use an unsafe fallback.
    if (this.#locks === undefined) return persist();
    this.#saving = true;
    this.#queue = this.#queue.then(() => this.#locks.request(STORAGE_KEY, persist)).catch(() => {
      this.#saveError = 'Could not acquire the save lock. Retry saving or export JSON.';
    }).finally(() => { this.#saving = false; this.#changed(false); });
    return this.#queue;
  }
}

export { STORAGE_KEY };
