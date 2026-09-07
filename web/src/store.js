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

  constructor({ document: doc = defaultDocument(), storage = null } = {}) {
    this.#doc = clone(doc);
    this.#storage = storage;
  }

  /**
   * Restore the last session's plot, falling back to a fresh document when
   * nothing is stored or what is stored no longer parses.
   */
  static fromStorage(storage) {
    const store = new Store({ storage });
    try {
      const saved = storage?.getItem(STORAGE_KEY);
      if (saved) store.#doc = parseDocument(saved);
    } catch (error) {
      console.warn('ABPlot: ignoring unreadable saved plot:', error.message);
    }
    return store;
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
    const before = clone(this.#doc);
    const draft = clone(this.#doc);
    mutate(draft);
    if (JSON.stringify(draft) === JSON.stringify(before)) return;
    this.#doc = draft;
    this.#pushUndo(before);
    this.#changed();
  }

  /** Start a gesture whose intermediate states should not enter the history. */
  begin() {
    this.#pending = clone(this.#doc);
  }

  /** Apply a frame of an in-progress gesture. */
  mutate(mutate) {
    const draft = clone(this.#doc);
    mutate(draft);
    this.#doc = draft;
    this.#changed();
  }

  /** Finish a gesture, recording it as a single undoable edit if it changed anything. */
  end() {
    const before = this.#pending;
    this.#pending = null;
    if (!before || JSON.stringify(before) === JSON.stringify(this.#doc)) return;
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
    this.#changed();
  }

  undo() {
    if (!this.canUndo) return;
    this.#redo.push(clone(this.#doc));
    this.#doc = this.#undo.pop();
    this.#afterHistoryStep();
  }

  redo() {
    if (!this.canRedo) return;
    this.#undo.push(clone(this.#doc));
    this.#doc = this.#redo.pop();
    this.#afterHistoryStep();
  }

  #afterHistoryStep() {
    if (!this.#doc.points.some((point) => point.id === this.#selectedId)) this.#selectedId = null;
    this.#changed();
  }

  #pushUndo(snapshot) {
    this.#undo.push(snapshot);
    if (this.#undo.length > HISTORY_LIMIT) this.#undo.shift();
    this.#redo.length = 0;
  }

  #changed() {
    this.#save();
    for (const listener of this.#listeners) listener(this);
  }

  #save() {
    if (!this.#storage) return;
    try {
      this.#storage.setItem(STORAGE_KEY, JSON.stringify(this.#doc));
    } catch (error) {
      // A full or disabled storage must not take the editor down with it.
      console.warn('ABPlot: could not save plot:', error.message);
    }
  }
}

export { STORAGE_KEY };
