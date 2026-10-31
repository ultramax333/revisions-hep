(function () {
  'use strict';
  const COLLECTION = window.QCM_COLLECTION?.id;
  const scopes = { 'fra-qcm-oral': { subject: 'Français', prefix: 'HEP-QCM' }, 'cla-qcm-s1': { subject: 'Organisation de la classe', prefix: 'CLA-QCM' }, 'dev-qcm-uf1': { subject: 'Développement', prefix: 'DEV-QCM' } };
  if (!Object.hasOwn(scopes, COLLECTION)) throw Error('Collection d’avis QCM incompatible.');
  const DB = 'hep-revisions-quick-feedback-v1' + (COLLECTION === 'fra-qcm-oral' ? '' : '-' + COLLECTION);
  const SCHEMA = 'hep-qcm-votes-local/1', UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const clone = value => JSON.parse(JSON.stringify(value));
  const keyOf = q => JSON.stringify([q.questionId, q.contentRevision]);
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const fail = message => { throw new Error(message); };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, expected) => object(value) && Object.keys(value).sort().join('|') === [...expected].sort().join('|');
  const string = (value, max, nonempty = false) => typeof value === 'string' && value.length <= max && (!nonempty || !!value.trim());
  const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const questionOK = q => object(q) && string(q.questionId, 180, true) && typeof q.contentRevision === 'string' && /^[0-9a-f]{12,64}$/.test(q.contentRevision);
  const snapshotOK = (s, transport = false) => keys(s, ['question', 'answer', 'hint', 'module', 'course']) && Object.entries(s).every(([k, v]) => string(v, transport ? ['module', 'course'].includes(k) ? 80 : 20000 : 2000000));
  const versionOK = value => Number.isInteger(value) && value >= 1 && value <= 2147483647;
  function validAck(ack, id) { return keys(ack, ['ok', 'submissionId', 'receiptId', 'receivedAt']) && ack.ok === true && ack.submissionId === id && UUID.test(ack.receiptId) && iso(ack.receivedAt); }
  function payloadOK(p) {
    return keys(p, ['schema', 'submissionId', 'firstName', 'feedback', 'vote', 'client']) && p.schema === 'hep-qcm-vote/1' && UUID.test(p.submissionId) && string(p.firstName, 80) &&
      keys(p.feedback, ['questionId', 'contentRevision', 'comment', 'snapshot']) && questionOK(p.feedback) && string(p.feedback.comment, 8000) && snapshotOK(p.feedback.snapshot, true) &&
      keys(p.vote, ['threadId', 'version', 'value']) && UUID.test(p.vote.threadId) && versionOK(p.vote.version) && ['up', 'down'].includes(p.vote.value) &&
      keys(p.client, ['appVersion', 'collection']) && p.client.collection === COLLECTION && string(p.client.appVersion, 32, true) && new TextEncoder().encode(JSON.stringify(p)).length <= 65536;
  }
  function empty() { return { schema: SCHEMA, collection: COLLECTION, threads: {}, intents: {} }; }
  // One collection record, read and written in a single IDB transaction. No localStorage
  // fallback: an unavailable durable store must never look like a saved or received vote.
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('collections');
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
      request.onerror = () => { opening = null; reject(Error('Le stockage des avis est indisponible. Aucun avis n’a été confirmé.')); };
      request.onblocked = () => { opening = null; reject(Error('Ferme les anciens onglets pour ouvrir le stockage des avis.')); };
    });
    return opening;
  }
  let channel;
  try { channel = new BroadcastChannel(DB); } catch (_) { /* Focus refresh also works without BroadcastChannel. */ }
  const listeners = new Set();
  const notify = () => { listeners.forEach(fn => fn()); };
  if (channel) channel.onmessage = notify;
  async function transaction(write, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let result, error;
      const tx = db.transaction('collections', write ? 'readwrite' : 'readonly'), store = tx.objectStore('collections');
      const request = store.get(COLLECTION);
      request.onsuccess = () => {
        try { const state = request.result || empty(); result = fn(state); if (write) store.put(state, COLLECTION); }
        catch (e) { error = e instanceof DOMException ? Error('L’avis n’a pas pu être enregistré. Conserve une sauvegarde ; réessaie après avoir libéré de la place.') : e; tx.abort(); }
      };
      tx.oncomplete = () => { resolve(clone(result)); if (write) { notify(); channel?.postMessage('changed'); } };
      tx.onabort = tx.onerror = () => reject(error || Error('L’avis n’a pas pu être enregistré. Conserve une sauvegarde ; réessaie après avoir libéré de la place.'));
    });
  }
  const read = () => transaction(false, state => state);
  function currentReceived(state, thread) {
    return Object.values(state.intents).some(i => i.payload.vote.threadId === thread.threadId && i.payload.vote.version === thread.version && validAck(i.ack, i.payload.submissionId));
  }
  function counts(state) {
    const threads = Object.values(state.threads), received = threads.filter(t => currentReceived(state, t)).length;
    return { total: threads.length, received, pending: threads.length - received, receipts: Object.values(state.intents).filter(i => validAck(i.ack, i.payload.submissionId)).length };
  }
  function nextCurrent(thread, value, comment, snapshot) {
    if (thread.version >= 2147483647) fail('La limite de versions est atteinte. Exporte les avis pour les conserver.');
    thread.version++;
    thread.current = { value, comment, snapshot: clone(snapshot), updatedAt: new Date().toISOString() };
  }
  function setVote(question, value, snapshot) {
    if (!questionOK(question) || !['up', 'down'].includes(value) || !snapshotOK(snapshot)) fail('Cet avis ne peut pas être conservé : la question est incomplète.');
    return transaction(true, state => {
      const key = keyOf(question);
      const thread = state.threads[key] || { questionId: question.questionId, contentRevision: question.contentRevision, threadId: crypto.randomUUID(), version: 0 };
      nextCurrent(thread, value, thread.current?.comment || '', snapshot);
      state.threads[key] = thread;
      return thread;
    });
  }
  // Comment edits keep the snapshot captured by the thumb. A delayed editor cannot
  // overwrite a vote made in another tab: it gets an explicit conflict instead.
  function setComment(question, expectedVersion, comment) {
    if (!string(comment, 8000)) fail('Le commentaire est trop long.');
    return transaction(true, state => {
      const thread = state.threads[keyOf(question)];
      if (!thread || thread.version !== expectedVersion) fail('Cet avis a changé ailleurs. Recharge le commentaire avant de le modifier.');
      if (thread.current.comment !== comment) nextCurrent(thread, thread.current.value, comment, thread.current.snapshot);
      return thread;
    });
  }
  function prepare(firstName, appVersion) {
    if (!string(firstName, 80) || !string(appVersion, 32, true)) fail('Vérifie le prénom avant l’envoi.');
    return transaction(true, state => {
      const ids = [], blocked = [];
      for (const [key, thread] of Object.entries(state.threads)) {
        if (currentReceived(state, thread)) continue;
        let intent = Object.values(state.intents).find(i => i.payload.vote.threadId === thread.threadId && i.payload.vote.version === thread.version);
        if (!intent) {
          const payload = { schema: 'hep-qcm-vote/1', submissionId: crypto.randomUUID(), firstName, feedback: { questionId: thread.questionId, contentRevision: thread.contentRevision, comment: thread.current.comment, snapshot: clone(thread.current.snapshot) }, vote: { threadId: thread.threadId, version: thread.version, value: thread.current.value }, client: { appVersion, collection: COLLECTION } };
          if (!payloadOK(payload)) { blocked.push(key); continue; }
          intent = { payload, body: JSON.stringify(payload), key, createdAt: new Date().toISOString(), retryAt: 0, lease: null, lastError: '', ack: null };
          state.intents[payload.submissionId] = intent;
        }
        ids.push(intent.payload.submissionId);
      }
      return { ids, blocked, counts: counts(state) };
    });
  }
  function claim(id, owner, now = Date.now()) {
    return transaction(true, state => {
      const i = state.intents[id];
      if (!i || validAck(i.ack, id)) return { kind: 'received' };
      const t = state.threads[i.key];
      if (!t || t.threadId !== i.payload.vote.threadId || t.version !== i.payload.vote.version) return { kind: 'superseded' };
      if (i.retryAt > now) return { kind: 'wait', retryAt: i.retryAt };
      if (i.lease && i.lease.until > now) return { kind: 'busy' };
      i.lease = { owner, until: now + 60000 };
      return { kind: 'claimed', body: i.body, submissionId: id };
    });
  }
  function complete(id, owner, ack, retryAt = 0, lastError = '') {
    return transaction(true, state => {
      const i = state.intents[id];
      if (!i) fail('L’intention d’envoi manque.');
      if (ack) {
        if (!validAck(ack, id)) fail('Le reçu est invalide.');
        // An old ACK confirms only this frozen intention; counts compare versions.
        if (i.ack && !equal(i.ack, ack)) fail('Deux reçus différents pour le même envoi. Exporte les avis pour les conserver.');
        i.ack = clone(ack);
      }
      if (i.lease?.owner === owner) { i.lease = null; i.retryAt = retryAt; i.lastError = lastError; }
      return counts(state);
    });
  }
  function validate(raw) {
    if (!keys(raw, ['schema', 'collection', 'threads', 'intents']) || raw.schema !== SCHEMA || raw.collection !== COLLECTION || !object(raw.threads) || !object(raw.intents)) fail('Choisis une sauvegarde dédiée aux avis QCM de cette matière.');
    if (Object.keys(raw.threads).length > 10000 || Object.keys(raw.intents).length > 50000) fail('Cette sauvegarde contient trop d’éléments.');
    const threadIDs = new Set(), versions = new Set();
    for (const [key, t] of Object.entries(raw.threads)) {
      if (!keys(t, ['questionId', 'contentRevision', 'threadId', 'version', 'current']) || !questionOK(t) || key !== keyOf(t) || !UUID.test(t.threadId) || threadIDs.has(t.threadId) || !versionOK(t.version) ||
          !keys(t.current, ['value', 'comment', 'snapshot', 'updatedAt']) || !['up', 'down'].includes(t.current.value) || !string(t.current.comment, 8000) || !snapshotOK(t.current.snapshot) || !iso(t.current.updatedAt)) fail('Un avis de la sauvegarde est invalide. Rien n’a été remplacé.');
      threadIDs.add(t.threadId);
    }
    for (const [id, i] of Object.entries(raw.intents)) {
      if (!keys(i, ['payload', 'body', 'key', 'createdAt', 'retryAt', 'lease', 'lastError', 'ack']) || !payloadOK(i.payload) || id !== i.payload.submissionId || i.body !== JSON.stringify(i.payload) || !iso(i.createdAt) || !Number.isSafeInteger(i.retryAt) || i.retryAt < 0 || !string(i.lastError, 300) ||
          (i.lease !== null && (!keys(i.lease, ['owner', 'until']) || !UUID.test(i.lease.owner) || !Number.isSafeInteger(i.lease.until) || i.lease.until < 0)) || (i.ack !== null && !validAck(i.ack, id))) fail('Une intention ou un reçu de la sauvegarde est invalide. Rien n’a été remplacé.');
      const t = raw.threads[i.key], p = i.payload, vk = p.vote.threadId + ':' + p.vote.version;
      if (!t || i.key !== keyOf(p.feedback) || t.threadId !== p.vote.threadId || p.vote.version > t.version || versions.has(vk)) fail('Les versions de la sauvegarde sont incohérentes. Rien n’a été remplacé.');
      if (p.vote.version === t.version && (!equal(p.feedback.snapshot, t.current.snapshot) || p.feedback.comment !== t.current.comment || p.vote.value !== t.current.value)) fail('Le contenu conservé ne correspond pas à son intention.');
      versions.add(vk);
    }
    return clone(raw);
  }
  function restore(raw) {
    const incoming = validate(raw);
    return transaction(true, state => {
      // Conflicts reject the entire import. Neither side disappears silently.
      for (const [key, t] of Object.entries(incoming.threads)) {
        const local = state.threads[key];
        if (local && (local.threadId !== t.threadId || (local.version === t.version && !equal(local, t)))) fail('Conflit entre deux avis. Les données locales restent intactes ; conserve les deux sauvegardes.');
        if (!local || local.version < t.version) state.threads[key] = t;
      }
      for (const [id, i] of Object.entries(incoming.intents)) {
        const local = state.intents[id];
        const conflict = Object.values(state.intents).find(other => other.payload.vote.threadId === i.payload.vote.threadId && other.payload.vote.version === i.payload.vote.version && other.payload.submissionId !== id);
        if (conflict || (local && (local.body !== i.body || (local.ack && i.ack && !equal(local.ack, i.ack))))) fail('Conflit d’intentions d’envoi. Les données locales restent intactes ; conserve les deux sauvegardes.');
        if (!local) state.intents[id] = { ...i, lease: null };
        else { if (!local.ack && i.ack) local.ack = i.ack; local.retryAt = Math.max(local.retryAt, i.retryAt); }
      }
      validate(state);
      return counts(state);
    });
  }
  window.HEPQuickStore = { collection: COLLECTION, subject: scopes[COLLECTION].subject, exportPrefix: scopes[COLLECTION].prefix, read, setVote, setComment, prepare, claim, complete, restore, validate, validAck, counts, currentReceived, keyOf, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}());
