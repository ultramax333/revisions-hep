(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HEPSansChoixStore = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MAX_RESPONSE = 8000;
  let lockDB;
  // A read/write transaction is also a mutex when Web Locks is unavailable.
  // Only the mutex lives in IDB; all personal data stays in the collection repo.
  function fallbackLock(scope, perform) {
    if (!lockDB) lockDB = new Promise((resolve, reject) => {
      const request = indexedDB.open('hep-revisions-sans-choix-locks-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('mutex');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { lockDB = null; reject(Error('Le verrou local est indisponible. Ta saisie reste visible ; télécharge une sauvegarde.')); };
      request.onblocked = () => reject(Error('Ferme les anciens onglets pour rétablir le stockage local.'));
    });
    return lockDB.then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('mutex', 'readwrite');
      let result, failure;
      tx.objectStore('mutex').get(scope).onsuccess = () => {
        try { result = perform(); } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || Error('La saisie n’a pas pu être enregistrée. Elle reste visible.'));
    }));
  }
  function create({ repo, scope, ingest, changed, store = globalThis.HEPStore }) {
    const writer = store.uuid(), conflictWriters = new Map();
    let cachedDrafts, index;
    const identity = (q, step) => q.id + '::' + step.id + '::' + q.qcmRevision;
    function rebuild() {
      if (cachedDrafts === repo.state.drafts) return;
      index = new Map(); cachedDrafts = repo.state.drafts;
      for (const [key, draft] of Object.entries(cachedDrafts)) {
        if (!key.startsWith('sc-meta::')) continue;
        try {
          const suffix = key.slice(9), split = suffix.lastIndexOf('::'), id = suffix.slice(0, split), author = suffix.slice(split + 2);
          const meta = JSON.parse(draft.text), response = cachedDrafts['sc-text::' + suffix]?.text;
          if (split < 0 || meta.v !== 1 || meta.writer !== author || !Number.isSafeInteger(meta.generation) || meta.generation < 1 || typeof meta.revealed !== 'boolean' || ![null, 'known', 'review'].includes(meta.selfEvaluation) || (meta.selfEvaluation && !meta.revealed) || typeof response !== 'string' || response.length > MAX_RESPONSE || meta.responseHash !== store.fingerprint(response) || typeof meta.conflict !== 'boolean') continue;
          const record = { ...meta, response, updatedAt: draft.updatedAt, token: author + ':' + meta.generation };
          if (!index.has(id)) index.set(id, []);
          index.get(id).push(record);
        } catch (_) { /* Malformed imported SC data never becomes a response. */ }
      }
    }
    const compare = (a, b) => a.generation - b.generation || a.updatedAt.localeCompare(b.updatedAt) || a.writer.localeCompare(b.writer);
    function records(q, step) { rebuild(); return index.get(identity(q, step)) || []; }
    function read(q, step) {
      const available = records(q, step).filter(record => !record.conflict).sort(compare);
      return available.length ? { ...available[available.length - 1] } : { token: '', generation: 0, response: '', revealed: false, selfEvaluation: null };
    }
    function write(q, step, base, patch, conflict) {
      const id = identity(q, step), conflictKey = id + '::' + base.token;
      if (conflict && !conflictWriters.has(conflictKey)) conflictWriters.set(conflictKey, store.uuid());
      const author = conflict ? conflictWriters.get(conflictKey) : writer;
      const suffix = id + '::' + author, textKey = 'sc-text::' + suffix, metaKey = 'sc-meta::' + suffix;
      if (textKey.length > 200 || metaKey.length > 200) throw Error('Cette question ne peut pas être sauvegardée dans ce format.');
      const previous = records(q, step);
      const updatedAt = new Date(Math.max(Date.now(), ...previous.map(record => Date.parse(record.updatedAt) + 1))).toISOString();
      const response = patch.response === undefined ? base.response : patch.response;
      if (typeof response !== 'string' || response.length > MAX_RESPONSE) throw Error('Ta réponse dépasse la limite de 8 000 caractères. Elle n’a pas été tronquée.');
      const meta = { v: 1, writer: author, generation: base.generation + 1, parent: base.token, revealed: base.revealed, selfEvaluation: base.selfEvaluation, ...patch, conflict, responseHash: store.fingerprint(response) };
      delete meta.response;
      if (!Number.isSafeInteger(meta.generation) || ![null, 'known', 'review'].includes(meta.selfEvaluation) || (meta.selfEvaluation && !meta.revealed)) throw Error('Autoévaluation incompatible.');
      const encoded = JSON.stringify(meta);
      if (encoded.length > 12000) throw Error('État trop volumineux ; aucune donnée n’a été tronquée.');
      repo.state.drafts[textKey] = { text: response, updatedAt };
      repo.state.drafts[metaKey] = { text: encoded, updatedAt };
      cachedDrafts = null;
      const saved = repo.save(); changed();
      return { ...meta, response, updatedAt, token: author + ':' + meta.generation, saved };
    }
    const exclusive = perform => globalThis.navigator?.locks ? navigator.locks.request(scope + '-edit', perform) : fallbackLock(scope, perform);
    async function update(q, step, expected, patch) {
      const perform = () => {
        ingest();
        const current = read(q, step);
        if (current.token !== expected.token) {
          // Preserve a stale free response as its own variant, never as a new grade.
          const retained = typeof patch.response === 'string' && patch.response !== current.response ? write(q, step, expected, patch, true) : null;
          return { ok: false, current, retained };
        }
        return { ok: true, current: write(q, step, current, patch, false) };
      };
      return exclusive(perform);
    }
    function alternatives(q, step) {
      const current = read(q, step), seen = new Set([current.response]);
      return records(q, step).sort(compare).reverse().filter(record => {
        if (!record.response || seen.has(record.response)) return false;
        seen.add(record.response); return true;
      });
    }
    function retain(q, step, expected, response) {
      ingest(); return write(q, step, expected, { response }, true);
    }
    return { read, update, retain, alternatives, exclusive, MAX_RESPONSE };
  }
  return { create, MAX_RESPONSE };
}));
