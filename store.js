(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HEPStore = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const SCHEMA = 'hep-revisions-state/1';
  const KEY = 'hep-revisions-state-v1';
  const text = (value, max = 8000) => typeof value === 'string' ? value.slice(0, max) : '';
  const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
  const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : '1970-01-01T00:00:00.000Z';
  const uuid = () => globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const empty = () => ({ schema: SCHEMA, deviceId: uuid(), attempts: {}, feedback: {}, drafts: {}, session: null, sessionUpdatedAt: '1970-01-01T00:00:00.000Z', preferences: { count: 10 } });
  const stable = value => value && typeof value === 'object' && !Array.isArray(value)
    ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}'
    : Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : JSON.stringify(value);
  function fingerprint(value) {
    let hash = 14695981039346656037n;
    for (const char of stable(value)) { hash ^= BigInt(char.codePointAt(0)); hash = BigInt.asUintN(64, hash * 1099511628211n); }
    return hash.toString(16).padStart(16, '0');
  }
  function snapshot(raw = {}) {
    return { question: text(raw.question, 16000), answer: text(raw.answer, 32000), hint: text(raw.hint, 4000), module: text(raw.module, 120), course: text(raw.course, 120) };
  }
  function normalize(raw, deviceId) {
    if (!raw || typeof raw !== 'object' || raw.schema !== SCHEMA) throw new Error('Ce fichier n’est pas une sauvegarde Révisions HEP compatible.');
    const out = empty();
    out.deviceId = safeId(deviceId) ? deviceId : safeId(raw.deviceId) ? raw.deviceId : out.deviceId;
    for (const name of ['attempts', 'feedback']) {
      const records = raw[name] && typeof raw[name] === 'object' && !Array.isArray(raw[name]) ? Object.values(raw[name]) : [];
      if (records.length > 50000) throw new Error('La sauvegarde contient trop d’éléments.');
      out[name] = Object.create(null);
      records.forEach(record => {
        if (!record || !safeId(record.id) || !safeId(record.questionId) || typeof record.contentRevision !== 'string') return;
        const item = { id: record.id, originId: safeId(record.originId) ? record.originId : record.id, questionId: record.questionId,
          contentRevision: text(record.contentRevision, 100), updatedAt: stamp(record.updatedAt), deviceId: text(record.deviceId, 200) };
        if (name === 'attempts') {
          if (![0, 1, 2].includes(record.grade) || !safeId(record.sessionId)) return;
          Object.assign(item, { sessionId: record.sessionId, grade: record.grade, hintUsed: !!record.hintUsed });
        } else Object.assign(item, { category: text(record.category, 80) || 'autre', comment: text(record.comment), deleted: !!record.deleted, snapshot: snapshot(record.snapshot) });
        out[name][item.id] = item;
      });
    }
    Object.entries(raw.drafts || {}).slice(0, 5000).forEach(([id, draft]) => {
      if (safeId(id) && draft && typeof draft === 'object') out.drafts[id] = { text: text(draft.text, 12000), updatedAt: stamp(draft.updatedAt) };
    });
    if (raw.session && typeof raw.session === 'object' && safeId(raw.session.id) && Array.isArray(raw.session.ids)) {
      const ids = raw.session.ids.filter(safeId).slice(0, 10000);
      if (ids.length) out.session = { id: raw.session.id, ids, index: Math.min(Math.max(0, Number(raw.session.index) || 0), ids.length - 1), startedAt: stamp(raw.session.startedAt), mode: text(raw.session.mode, 40), updatedAt: stamp(raw.session.updatedAt) };
    }
    if (raw.preferences && [10, 20, 0].includes(Number(raw.preferences.count))) out.preferences.count = Number(raw.preferences.count);
    out.sessionUpdatedAt = stamp(raw.sessionUpdatedAt || (out.session && out.session.updatedAt));
    return out;
  }
  function unionEvents(a, b) {
    const groups = new Map();
    [...Object.values(a), ...Object.values(b)].forEach(item => {
      const origin = item.originId || item.id;
      const payload = { ...item }; delete payload.id; delete payload.originId;
      const digest = fingerprint(payload);
      if (!groups.has(origin)) groups.set(origin, new Map());
      groups.get(origin).set(digest, payload);
    });
    const result = Object.create(null);
    [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([origin, variants]) => {
      [...variants.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([hash, payload]) => {
        const id = variants.size === 1 ? origin : origin + '::' + hash;
        result[id] = { id, originId: origin, ...payload };
      });
    });
    return result;
  }
  function merge(a, b, deviceId) {
    const left = normalize(a, deviceId), right = normalize(b, deviceId);
    const out = { ...left, attempts: unionEvents(left.attempts, right.attempts), feedback: unionEvents(left.feedback, right.feedback) };
    // Keep the current edit of each device/version thread, including deletion markers.
    // Immutable variants of an ID conflict remain separate threads.
    out.feedback = Object.fromEntries(feedbackThreads(out).map(item => [item.id, item]));
    Object.entries(right.drafts).forEach(([id, draft]) => { if (!out.drafts[id] || draft.updatedAt > out.drafts[id].updatedAt) out.drafts[id] = draft; });
    if (right.sessionUpdatedAt > out.sessionUpdatedAt) { out.session = right.session; out.sessionUpdatedAt = right.sessionUpdatedAt; }
    return out;
  }
  const later = (a, b) => !a || b.updatedAt > a.updatedAt || (b.updatedAt === a.updatedAt && stable(b) > stable(a));
  function latestFeedback(state) {
    const byQuestion = Object.create(null);
    Object.values(state.feedback).forEach(item => { if (later(byQuestion[item.questionId], item)) byQuestion[item.questionId] = item; });
    return byQuestion;
  }
  function feedbackThread(item) {
    return [item.questionId, item.deviceId, item.contentRevision, fingerprint(snapshot(item.snapshot)), item.id.includes('::') ? item.id : ''].join('|');
  }
  function feedbackThreads(state) {
    const threads = Object.create(null);
    Object.values(state.feedback).forEach(item => { const key = feedbackThread(item); if (later(threads[key], item)) threads[key] = item; });
    return Object.values(threads);
  }
  function currentFeedback(state, question, snap, deviceId = state.deviceId) {
    const key = feedbackThread({ questionId: question.id, deviceId, contentRevision: question.contentRevision, snapshot: snap, id: '' });
    return feedbackThreads(state).find(item => feedbackThread(item) === key);
  }
  function attemptsFor(state, questions) {
    const byId = new Map(questions.map(q => [q.id, q]));
    const bySession = Object.create(null);
    Object.values(state.attempts).forEach(item => {
      const q = byId.get(item.questionId);
      if (!q || q.contentRevision !== item.contentRevision) return;
      const key = item.sessionId + ':' + item.questionId;
      if (later(bySession[key], item)) bySession[key] = item;
    });
    return Object.values(bySession);
  }
  function mastery(state, questions) {
    const latest = Object.create(null);
    attemptsFor(state, questions).forEach(item => { if (later(latest[item.questionId], item)) latest[item.questionId] = item; });
    return latest;
  }
  function feedbackBundle(state, bank) {
    return { schema: 'hep-revisions-feedback/1', exportedAt: new Date().toISOString(), bankRevision: bank.bankRevision,
      feedback: feedbackThreads(state).filter(item => !item.deleted && item.comment.trim()).map(item => ({ ...item })) };
  }
  class Repository {
    constructor(storage) {
      this.storage = storage; this.warning = ''; this.state = empty();
      try {
        const raw = storage.getItem(KEY);
        if (raw) this.state = normalize(JSON.parse(raw));
      } catch (error) { this.warning = 'La sauvegarde locale n’a pas pu être lue. Exporte tes données avant de quitter.'; }
      this.deviceId = this.state.deviceId;
    }
    save() {
      try {
        const raw = this.storage.getItem(KEY);
        const persisted = raw ? normalize(JSON.parse(raw), this.deviceId) : null;
        if (persisted) this.ingest(persisted);
        this.state.deviceId = this.deviceId;
        const saved = { ...this.state };
        if (persisted && persisted.sessionUpdatedAt > saved.sessionUpdatedAt) {
          saved.session = persisted.session; saved.sessionUpdatedAt = persisted.sessionUpdatedAt;
        }
        this.storage.setItem(KEY, JSON.stringify(saved));
        this.warning = ''; return true;
      } catch (_) { this.warning = 'Enregistrement local indisponible : télécharge une sauvegarde avant de quitter.'; return false; }
    }
    import(raw) {
      const incoming = normalize(raw, this.deviceId);
      this.state = merge(this.state, incoming, this.deviceId);
      this.save();
    }
    mergeRemote(raw) {
      this.ingest(raw);
      this.save();
    }
    ingest(raw) {
      // A second tab/device may add data, but cannot navigate the question shown here.
      const session = this.state.session, sessionUpdatedAt = this.state.sessionUpdatedAt;
      this.state = merge(this.state, normalize(raw, this.deviceId), this.deviceId);
      this.state.session = session; this.state.sessionUpdatedAt = sessionUpdatedAt;
    }
    setSession(session) {
      this.state.session = session;
      this.state.sessionUpdatedAt = new Date(Math.max(Date.now(), Date.parse(this.state.sessionUpdatedAt) + 1)).toISOString();
      if (session) session.updatedAt = this.state.sessionUpdatedAt;
      this.save();
    }
    grade(question, grade, sessionId, hintUsed) {
      const previous = attemptsFor(this.state, [question]).find(item => item.sessionId === sessionId);
      const updatedAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
      const event = { id: uuid(), questionId: question.id, contentRevision: question.contentRevision, updatedAt, deviceId: this.deviceId, sessionId, grade, hintUsed: !!hintUsed };
      this.state.attempts[event.id] = { ...event, originId: event.id }; this.save(); return event;
    }
    comment(question, category, comment, snap) {
      const previous = currentFeedback(this.state, question, snap, this.deviceId);
      if (previous && previous.comment === comment && previous.category === category && previous.contentRevision === question.contentRevision && stable(previous.snapshot) === stable(snapshot(snap))) return previous;
      const updatedAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString();
      const event = { id: uuid(), questionId: question.id, contentRevision: question.contentRevision, updatedAt, deviceId: this.deviceId, category, comment, deleted: !comment.trim(), snapshot: snapshot(snap) };
      this.state.feedback[event.id] = { ...event, originId: event.id }; this.save(); return event;
    }
  }
  return { SCHEMA, KEY, uuid, empty, normalize, merge, stable, fingerprint, latestFeedback, feedbackThreads, currentFeedback, attemptsFor, mastery, feedbackBundle, Repository };
}));
