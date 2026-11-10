(function () {
  'use strict';
  // v23 — Avis sur le niveau d'une question (AGENTS du site, §3 ; REGLES §5.1).
  // Enregistré sur l'appareil (IndexedDB), regroupé et envoyé comme les pouces, sous le
  // contrat hep-qcm-level/1. Tant que CONFIG.LEVEL_FEEDBACK_ENABLED n'est pas true, les
  // intentions sont préparées (mises en file) mais aucune requête ne part.
  // Un avis ne change jamais le poids affiché : celui-ci vient seulement de la banque.
  const COLLECTION = window.QCM_COLLECTION?.id;
  const scopes = ['fra-qcm-oral', 'cla-qcm-s1', 'dev-qcm-uf1', 'shs-qcm-s1'];
  if (!scopes.includes(COLLECTION)) throw Error('Collection d’avis sur le niveau incompatible.');
  const DB = 'hep-revisions-quick-level-v1' + (COLLECTION === 'fra-qcm-oral' ? '' : '-' + COLLECTION);
  const TRANSPORT_DB = 'hep-revisions-quick-feedback-transport-v1'; // quotas partagés avec les pouces
  const SCHEMA = 'hep-qcm-levels-local/1', CONTRACT = 'hep-qcm-level/1', GAP = 6500, DEBOUNCE = 3000;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const VALUES = { 1: '1 · À maîtriser', 2: '2 · À connaître', 3: '3 · À rencontrer', 4: '4 · Inutile pour l’examen' };
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
  const valueOK = value => Number.isInteger(value) && value >= 1 && value <= 4;
  const shownOK = value => value === null || (Number.isInteger(value) && value >= 1 && value <= 3);
  const validAck = (ack, id) => keys(ack, ['ok', 'submissionId', 'receiptId', 'receivedAt']) && ack.ok === true && ack.submissionId === id && UUID.test(ack.receiptId) && iso(ack.receivedAt);
  function payloadOK(p) {
    return keys(p, ['schema', 'submissionId', 'firstName', 'feedback', 'level', 'client']) && p.schema === CONTRACT && UUID.test(p.submissionId) && string(p.firstName, 80) &&
      keys(p.feedback, ['questionId', 'contentRevision', 'snapshot']) && questionOK(p.feedback) && snapshotOK(p.feedback.snapshot, true) &&
      keys(p.level, ['threadId', 'version', 'value', 'shownWeight']) && UUID.test(p.level.threadId) && versionOK(p.level.version) && valueOK(p.level.value) && shownOK(p.level.shownWeight) &&
      keys(p.client, ['appVersion', 'collection']) && p.client.collection === COLLECTION && string(p.client.appVersion, 32, true) && new TextEncoder().encode(JSON.stringify(p)).length <= 65536;
  }
  const enabled = () => window.CONFIG?.LEVEL_FEEDBACK_ENABLED === true;
  function endpoint() {
    let url;
    try { url = new URL(window.CONFIG?.LEVEL_FEEDBACK_ENDPOINT || window.CONFIG?.FEEDBACK_ENDPOINT); } catch (_) { throw Error('L’envoi est indisponible. Les avis restent sur cet appareil.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('L’adresse d’envoi est indisponible. Les avis restent sur cet appareil.');
    return url.href;
  }
  const empty = () => ({ schema: SCHEMA, collection: COLLECTION, threads: {}, intents: {} });

  // ---------- Stockage durable (un enregistrement par collection, une transaction) ----------
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('collections');
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
      request.onerror = () => { opening = null; reject(Error('Le stockage des avis sur le niveau est indisponible. Aucun avis n’a été confirmé.')); };
      request.onblocked = () => { opening = null; reject(Error('Ferme les anciens onglets pour ouvrir le stockage des avis.')); };
    });
    return opening;
  }
  let channel;
  try { channel = new BroadcastChannel(DB); } catch (_) { /* Le focus actualise aussi. */ }
  const listeners = new Set();
  const notify = () => listeners.forEach(fn => fn());
  if (channel) channel.onmessage = notify;
  async function transaction(write, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let result, error;
      const tx = db.transaction('collections', write ? 'readwrite' : 'readonly'), store = tx.objectStore('collections');
      const request = store.get(COLLECTION);
      request.onsuccess = () => {
        try { const state = request.result || empty(); result = fn(state); if (write) store.put(state, COLLECTION); }
        catch (e) { error = e instanceof DOMException ? Error('L’avis n’a pas pu être enregistré. Libère de la place, puis réessaie.') : e; tx.abort(); }
      };
      tx.oncomplete = () => { resolve(clone(result)); if (write) { notify(); channel?.postMessage('changed'); } };
      tx.onabort = tx.onerror = () => reject(error || Error('L’avis n’a pas pu être enregistré. Libère de la place, puis réessaie.'));
    });
  }
  const read = () => transaction(false, state => state);
  const currentReceived = (state, t) => Object.values(state.intents).some(i => i.payload.level.threadId === t.threadId && i.payload.level.version === t.version && validAck(i.ack, i.payload.submissionId));
  function counts(state) {
    const threads = Object.values(state.threads), received = threads.filter(t => currentReceived(state, t)).length;
    const queued = threads.filter(t => !currentReceived(state, t) && Object.values(state.intents).some(i => i.payload.level.threadId === t.threadId && i.payload.level.version === t.version)).length;
    return { total: threads.length, received, pending: threads.length - received, queued };
  }
  function setLevel(question, value, shownWeight, snapshot) {
    if (!questionOK(question) || !valueOK(value) || !shownOK(shownWeight) || !snapshotOK(snapshot)) fail('Cet avis ne peut pas être conservé : la question est incomplète.');
    return transaction(true, state => {
      const key = keyOf(question);
      const thread = state.threads[key] || { questionId: question.questionId, contentRevision: question.contentRevision, threadId: crypto.randomUUID(), version: 0 };
      if (thread.current?.value === value) return thread; // même choix : rien à renvoyer
      if (thread.version >= 2147483647) fail('La limite de versions est atteinte. Exporte les avis pour les conserver.');
      thread.version++;
      thread.current = { value, shownWeight, snapshot: clone(snapshot), updatedAt: new Date().toISOString() };
      state.threads[key] = thread;
      return thread;
    });
  }
  // Mise en file : une intention gelée par version courante (UUID et corps réutilisés à chaque essai).
  function prepare(firstName, appVersion) {
    if (!string(firstName, 80) || !string(appVersion, 32, true)) fail('Vérifie le prénom avant l’envoi.');
    return transaction(true, state => {
      const ids = [], blocked = [];
      for (const [key, t] of Object.entries(state.threads)) {
        if (currentReceived(state, t)) continue;
        let intent = Object.values(state.intents).find(i => i.payload.level.threadId === t.threadId && i.payload.level.version === t.version);
        if (!intent) {
          const payload = { schema: CONTRACT, submissionId: crypto.randomUUID(), firstName, feedback: { questionId: t.questionId, contentRevision: t.contentRevision, snapshot: clone(t.current.snapshot) }, level: { threadId: t.threadId, version: t.version, value: t.current.value, shownWeight: t.current.shownWeight }, client: { appVersion, collection: COLLECTION } };
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
      if (!t || t.threadId !== i.payload.level.threadId || t.version !== i.payload.level.version) return { kind: 'superseded' };
      if (i.retryAt > now) return { kind: 'wait', retryAt: i.retryAt };
      if (i.lease && i.lease.until > now) return { kind: 'busy' };
      i.lease = { owner, until: now + 60000 };
      return { kind: 'claimed', body: i.body };
    });
  }
  function complete(id, owner, ack, retryAt = 0, lastError = '') {
    return transaction(true, state => {
      const i = state.intents[id];
      if (!i) fail('L’intention d’envoi manque.');
      if (ack) {
        if (!validAck(ack, id)) fail('Le reçu est invalide.');
        if (i.ack && !equal(i.ack, ack)) fail('Deux reçus différents pour le même envoi. Exporte les avis pour les conserver.');
        i.ack = clone(ack);
      }
      if (i.lease?.owner === owner) { i.lease = null; i.retryAt = retryAt; i.lastError = lastError; }
      return counts(state);
    });
  }
  function validate(raw) {
    if (!keys(raw, ['schema', 'collection', 'threads', 'intents']) || raw.schema !== SCHEMA || raw.collection !== COLLECTION || !object(raw.threads) || !object(raw.intents)) fail('Choisis une sauvegarde dédiée aux avis sur le niveau de cette matière.');
    if (Object.keys(raw.threads).length > 10000 || Object.keys(raw.intents).length > 50000) fail('Cette sauvegarde contient trop d’éléments.');
    const threadIDs = new Set(), versions = new Set();
    for (const [key, t] of Object.entries(raw.threads)) {
      if (!keys(t, ['questionId', 'contentRevision', 'threadId', 'version', 'current']) || !questionOK(t) || key !== keyOf(t) || !UUID.test(t.threadId) || threadIDs.has(t.threadId) || !versionOK(t.version) ||
          !keys(t.current, ['value', 'shownWeight', 'snapshot', 'updatedAt']) || !valueOK(t.current.value) || !shownOK(t.current.shownWeight) || !snapshotOK(t.current.snapshot) || !iso(t.current.updatedAt)) fail('Un avis de la sauvegarde est invalide. Rien n’a été remplacé.');
      threadIDs.add(t.threadId);
    }
    for (const [id, i] of Object.entries(raw.intents)) {
      if (!keys(i, ['payload', 'body', 'key', 'createdAt', 'retryAt', 'lease', 'lastError', 'ack']) || !payloadOK(i.payload) || id !== i.payload.submissionId || i.body !== JSON.stringify(i.payload) || !iso(i.createdAt) || !Number.isSafeInteger(i.retryAt) || i.retryAt < 0 || !string(i.lastError, 300) ||
          (i.lease !== null && (!keys(i.lease, ['owner', 'until']) || !UUID.test(i.lease.owner) || !Number.isSafeInteger(i.lease.until))) || (i.ack !== null && !validAck(i.ack, id))) fail('Une intention de la sauvegarde est invalide. Rien n’a été remplacé.');
      const t = raw.threads[i.key], p = i.payload, vk = p.level.threadId + ':' + p.level.version;
      if (!t || i.key !== keyOf(p.feedback) || t.threadId !== p.level.threadId || p.level.version > t.version || versions.has(vk)) fail('Les versions de la sauvegarde sont incohérentes. Rien n’a été remplacé.');
      if (p.level.version === t.version && (!equal(p.feedback.snapshot, t.current.snapshot) || p.level.value !== t.current.value || p.level.shownWeight !== t.current.shownWeight)) fail('Le contenu conservé ne correspond pas à son intention.');
      versions.add(vk);
    }
    return clone(raw);
  }
  function restore(raw) {
    const incoming = validate(raw);
    return transaction(true, state => {
      for (const [key, t] of Object.entries(incoming.threads)) {
        const local = state.threads[key];
        if (local && (local.threadId !== t.threadId || (local.version === t.version && !equal(local, t)))) fail('Conflit entre deux avis. Les données locales restent intactes ; conserve les deux sauvegardes.');
        if (!local || local.version < t.version) state.threads[key] = t;
      }
      for (const [id, i] of Object.entries(incoming.intents)) {
        const local = state.intents[id];
        const conflict = Object.values(state.intents).find(o => o.payload.level.threadId === i.payload.level.threadId && o.payload.level.version === i.payload.level.version && o.payload.submissionId !== id);
        if (conflict || (local && (local.body !== i.body || (local.ack && i.ack && !equal(local.ack, i.ack))))) fail('Conflit d’intentions d’envoi. Les données locales restent intactes ; conserve les deux sauvegardes.');
        if (!local) state.intents[id] = { ...i, lease: null };
        else { if (!local.ack && i.ack) local.ack = i.ack; local.retryAt = Math.max(local.retryAt, i.retryAt); }
      }
      validate(state);
      return counts(state);
    });
  }

  // ---------- Transport groupé (même cadence et mêmes quotas que les pouces) ----------
  let running = null, timer, transportOpening, signature = '', checking = false, checkAgain = false;
  function openTransport() {
    if (!transportOpening) transportOpening = new Promise((resolve, reject) => {
      const request = indexedDB.open(TRANSPORT_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('rate');
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); transportOpening = null; }; resolve(db); };
      request.onerror = request.onblocked = () => { transportOpening = null; reject(Error('Envoi différé : la coordination est indisponible. Les avis restent ici.')); };
    });
    return transportOpening;
  }
  async function rate(reserve, until = 0) {
    const db = await openTransport();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('rate', 'readwrite'), store = tx.objectStore('rate'), request = store.get('next');
      let waitUntil = 0;
      request.onsuccess = () => { const now = Date.now(), next = Math.max(Number(request.result) || 0, until); waitUntil = next > now ? next : 0; store.put(reserve && !waitUntil ? now + GAP : next, 'next'); };
      tx.oncomplete = () => resolve(waitUntil);
      tx.onabort = tx.onerror = () => reject(Error('Envoi différé : la coordination des onglets a échoué. Les avis restent ici.'));
    });
  }
  function retryDelay(response) {
    const value = response.headers.get('Retry-After'), seconds = Number(value);
    if (value && Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 86400) * 1000;
    const date = Date.parse(value);
    if (Number.isFinite(date) && date > Date.now()) return Math.min(date - Date.now(), 86400000);
    return response.status === 429 ? 60000 : 30000;
  }
  const sendListeners = new Set();
  function schedule(delay = DEBOUNCE) {
    clearTimeout(timer);
    if (navigator.onLine !== false) timer = setTimeout(() => { sendGroup(window.HEPFeedback?.name() || '').catch(() => schedule(30000)); }, Math.max(delay, 100));
  }
  function sendGroup(firstName, { exiting = false } = {}) {
    if (running) return running;
    clearTimeout(timer);
    const task = async () => {
      const plan = await prepare(firstName, String(window.CONFIG?.APP_VERSION || 'candidate'));
      let received = 0, stopped = '', waitUntil = 0;
      if (!enabled()) {
        // Le service n'accepte pas encore hep-qcm-level/1 : file d'attente locale, aucun réseau.
        const c = counts(await read());
        return { received, counts: c, stopped: c.pending ? 'En file sur cet appareil : le service ne reçoit pas encore les avis sur le niveau.' : '', waitUntil, held: true };
      }
      const url = endpoint(), owner = crypto.randomUUID();
      for (const id of plan.ids) {
        if (navigator.onLine === false) { stopped = 'Hors ligne : les avis restent ici et repartiront à la reconnexion.'; break; }
        const c = await claim(id, owner);
        if (c.kind === 'received' || c.kind === 'superseded') continue;
        if (c.kind === 'wait') { waitUntil = c.retryAt; stopped = 'Envoi différé, avis conservés.'; break; }
        if (c.kind === 'busy') { waitUntil = Date.now() + 60000; stopped = 'Un autre onglet envoie ces avis.'; break; }
        let slot;
        try { slot = await rate(true); } catch (error) { await complete(id, owner, null, Date.now() + 30000, 'coordination'); throw error; }
        if (slot) { waitUntil = slot; await complete(id, owner, null, slot, 'rate_wait'); break; }
        if (exiting && new TextEncoder().encode(c.body).length > 60000) { await complete(id, owner, null, 0, 'exit_size'); break; }
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(url, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, keepalive: exiting, body: c.body });
          if (response.status !== 200) {
            waitUntil = Date.now() + ([429, 503].includes(response.status) ? retryDelay(response) : 300000);
            await rate(false, waitUntil);
            stopped = response.status === 429 ? 'Limite d’envoi atteinte. Nouvelle tentative prévue ; avis conservés.' : 'Envoi non reçu (' + response.status + '). Les avis restent ici.';
            await complete(id, owner, null, waitUntil, 'http_' + response.status);
            break;
          }
          const ack = await response.json();
          if (!validAck(ack, id)) throw Error('invalid_ack');
          await complete(id, owner, ack); received++;
        } catch (_) {
          waitUntil = Date.now() + 30000;
          await complete(id, owner, null, waitUntil, 'unconfirmed');
          await rate(false, waitUntil);
          stopped = 'Envoi non confirmé. Les avis sont conservés et seront retentés.';
          break;
        } finally { clearTimeout(timeout); }
        if (exiting) break;
      }
      const c = counts(await read());
      if (!stopped && plan.blocked.length) stopped = plan.blocked.length + ' avis incomplet(s), conservé(s). Télécharge une sauvegarde.';
      return { received, counts: c, stopped, waitUntil, held: false };
    };
    running = task().then(result => {
      sendListeners.forEach(fn => fn(result));
      if (result.counts.pending && !exiting && !result.held) schedule(Math.max(3000, result.waitUntil - Date.now() || GAP));
      return result;
    }).finally(() => { running = null; });
    return running;
  }
  async function changed() {
    if (checking) { checkAgain = true; return; }
    checking = true;
    try {
      const state = await read(), next = JSON.stringify(state.threads);
      if (next !== signature) { signature = next; if (counts(state).pending) schedule(); }
    } catch (_) { /* L'interface affiche les erreurs de stockage ; rien n'est envoyé sans enregistrement. */ }
    finally { checking = false; if (checkAgain) { checkAgain = false; changed(); } }
  }
  listeners.add(changed);
  window.addEventListener('online', () => schedule());
  window.addEventListener('focus', changed);
  const exit = () => { sendGroup(window.HEPFeedback?.name() || '', { exiting: true }).catch(() => {}); };
  window.addEventListener('pagehide', exit);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') exit(); else changed(); });

  // ---------- Interface ----------
  let generation = 0, lastMessage = '', activeRefresh = () => {};
  const statusText = (state, thread) => {
    if (!thread) return enabled() ? 'Ton avis sur le niveau part automatiquement à Maxim, comme les pouces. Il ne change pas l’étiquette affichée.' : 'Ton avis sur le niveau est gardé sur cet appareil et partira à Maxim dès que l’envoi sera ouvert. Il ne change pas l’étiquette affichée.';
    const label = VALUES[thread.current.value] + '. ';
    if (currentReceived(state, thread)) return label + 'Avis reçu.';
    return label + (enabled() ? 'Avis enregistré ici ; il part automatiquement à Maxim.' : 'Avis enregistré ici, en file d’envoi : il partira dès que le service l’acceptera.');
  };
  function buttons() {
    return `<section class="quick-level" aria-labelledby="quick-level-title"><span class="quick-vote-label" id="quick-level-title">Pour l’examen, ce savoir est…</span><div class="quick-level-buttons" role="group" aria-labelledby="quick-level-title">${[1, 2, 3, 4].map(v => `<button type="button" class="quick-level-button level-${v}" data-level-value="${v}" aria-pressed="false">${VALUES[v]}</button>`).join('')}</div><p class="help-text quick-vote-state" data-level-status role="status" aria-live="polite">Lecture de ton avis…</p></section>`;
  }
  function archive() {
    return '<section class="settings-card quick-level-archive" aria-labelledby="quick-level-archive-title"><h2 id="quick-level-archive-title">Mes avis sur le niveau</h2><p class="help-text" data-level-count role="status">Lecture des avis enregistrés…</p><p>Ces avis restent sur cet appareil jusqu’à leur réception. Cette sauvegarde dédiée permet de les reprendre dans un autre navigateur.</p><div class="actions"><button type="button" class="btn primary" data-level-send disabled>Envoyer mes avis sur le niveau</button><button type="button" class="btn secondary" data-level-export>Télécharger mes avis sur le niveau</button><button type="button" class="btn secondary" data-level-import>Reprendre mes avis sur le niveau</button><input type="file" id="quick-level-file" accept=".json,application/json" hidden></div><p class="help-text" data-level-archive-status role="status"></p></section>';
  }
  function bind({ question, shownWeight = null, getSnapshot } = {}) {
    const gen = ++generation, root = document.getElementById('app');
    const box = root.querySelector('.quick-level'), send = root.querySelector('[data-level-send]');
    let manualSending = false;
    let error = '';
    const message = (selector, text) => { if (gen === generation) { const node = root.querySelector(selector); if (node) node.textContent = text; } };
    const refresh = async () => {
      try {
        const state = await read();
        if (gen !== generation) return;
        const c = counts(state), thread = question && state.threads[keyOf(question)];
        if (send) send.disabled = !enabled() || manualSending || !c.pending;
        if (box) {
          box.querySelectorAll('[data-level-value]').forEach(b => b.setAttribute('aria-pressed', String(thread?.current.value === Number(b.dataset.levelValue))));
          message('[data-level-status]', error || statusText(state, thread));
        }
        message('[data-level-count]', c.total ? c.total + ' avis sur le niveau · ' + c.received + ' reçu' + (c.received > 1 ? 's' : '') + ' · ' + c.pending + ' à envoyer' + (c.queued ? ' (dont ' + c.queued + ' en file)' : '') + '.' + (enabled() ? '' : ' L’envoi n’est pas encore ouvert : ils restent ici.') + (lastMessage && enabled() ? ' ' + lastMessage : '') : 'Aucun avis sur le niveau pour le moment.');
      } catch (e) { message('[data-level-status]', e.message); message('[data-level-count]', e.message); }
    };
    activeRefresh = refresh;
    box?.querySelectorAll('[data-level-value]').forEach(button => button.addEventListener('click', async () => {
      const snap = getSnapshot(); // copie synchrone de ce qui est affiché
      try { await setLevel(question, Number(button.dataset.levelValue), shownWeight, snap); error = ''; }
      catch (e) { error = e.message; }
      finally { refresh(); }
    }));
    send?.addEventListener('click', async () => {
      if (manualSending || !enabled()) return;
      manualSending = true; send.disabled = true;
      message('[data-level-archive-status]', 'Envoi des avis sur le niveau…');
      try {
        const result = await sendGroup(window.HEPFeedback?.name() || '');
        message('[data-level-archive-status]', result.stopped || (result.counts.pending ? 'Les avis restants sont conservés.' : 'Tous tes avis sur le niveau ont été reçus.'));
      } catch (e) { message('[data-level-archive-status]', e.message); }
      finally { manualSending = false; activeRefresh(); }
    });
    root.querySelector('[data-level-export]')?.addEventListener('click', async () => {
      try {
        const url = URL.createObjectURL(new Blob([JSON.stringify(await read(), null, 2)], { type: 'application/json;charset=utf-8' }));
        const a = document.createElement('a'); a.href = url; a.download = (window.HEPQuickStore?.exportPrefix || 'QCM') + '-avis-niveau-sauvegarde.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
        message('[data-level-archive-status]', 'Sauvegarde des avis sur le niveau préparée.');
      } catch (e) { message('[data-level-archive-status]', e.message); }
    });
    root.querySelector('[data-level-import]')?.addEventListener('click', () => root.querySelector('#quick-level-file').click());
    root.querySelector('#quick-level-file')?.addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      try { if (file.size > 25 * 1024 * 1024) throw Error('Cette sauvegarde est trop volumineuse.'); await restore(JSON.parse(await file.text())); message('[data-level-archive-status]', 'Avis sur le niveau repris.'); refresh(); }
      catch (e) { message('[data-level-archive-status]', e.message); }
      finally { event.target.value = ''; }
    });
    refresh();
  }
  listeners.add(() => activeRefresh());
  sendListeners.add(result => { lastMessage = result.stopped || ''; activeRefresh(); });
  window.addEventListener('focus', () => activeRefresh());
  window.HEPQuickLevel = Object.freeze({ collection: COLLECTION, contract: CONTRACT, values: VALUES, read, setLevel, prepare, claim, complete, validate, restore, counts, keyOf, sendGroup, enabled, buttons, archive, bind, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } });
  changed();
}());
