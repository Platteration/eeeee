/**
 * Which of `records` a new copy for `project` makes surplus: that project's
 * older copies beyond `keep`, never a protected id (the copy just written and
 * whatever the current document points at). A record written before projects
 * were tracked counts as its own project. Pure, so it is testable without
 * IndexedDB.
 */
export function staleRecoveries(records, { project, keep, protect = [] }) {
  const kept = new Set(protect);
  return records.filter(record => (record.project ?? record.id) === project && !kept.has(record.id))
    .sort((a, b) => b.updated - a.updated).slice(keep).map(record => record.id);
}

/** Photo crash recovery is independent of the small shared plot autosave. */
export function photoRecovery(database = globalThis.indexedDB) {
  async function open() {
    if (!database) throw Error('Browser photo recovery is unavailable. Save a photo project file.');
    return new Promise((resolve, reject) => {
      let finished = false;
      const timer = setTimeout(() => { finished = true; reject(Error('Photo recovery storage is busy. Save a photo project file.')); }, 5000);
      let request;
      try { request = database.open('abplot-photo-recovery', 1); }
      catch (error) { clearTimeout(timer); reject(error); return; }
      request.onupgradeneeded = () => request.result.createObjectStore('projects', { keyPath: 'id' });
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      request.onsuccess = () => { clearTimeout(timer); if (finished) request.result.close(); else resolve(request.result); };
    });
  }
  async function transact(mode, action) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('projects', mode), request = action(transaction.objectStore('projects'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error ?? Error('Photo recovery could not be saved.'));
        transaction.onerror = () => {}; // onabort reports the transaction's final state.
      });
    } finally { db.close(); }
  }
  return {
    list: async () => (await transact('readonly', store => store.getAll())).sort((a, b) => b.updated - a.updated),
    save: record => transact('readwrite', store => store.put(record)),
    remove: id => transact('readwrite', store => store.delete(id)),
    prune: async options => {
      const stale = staleRecoveries(await transact('readonly', store => store.getAll()), options);
      if (stale.length) await transact('readwrite', store => { let request; for (const id of stale) request = store.delete(id); return request; });
      return stale;
    },
  };
}
