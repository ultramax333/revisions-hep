(function () {
  'use strict';
  const S = window.HEPQuickStore;
  // Shared by all collection tabs. This conservative rate stays below both
  // service quotas (60/minute, 600/hour); other visitors may still cause 429.
  const DB = 'hep-revisions-quick-feedback-transport-v1', GAP = 6500, DEBOUNCE = 3000;
  let running = null, timer, opening, signature = '', checking = false, checkAgain = false;
  const listeners = new Set();
  const notify = value => listeners.forEach(fn => fn(value));
  function endpoint() {
    let url;
    try { url = new URL(window.CONFIG?.FEEDBACK_ENDPOINT); } catch (_) { throw Error('L’envoi est indisponible. Les avis restent sur cet appareil.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('L’adresse d’envoi est indisponible. Les avis restent sur cet appareil.');
    return url.href;
  }
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('rate');
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
      request.onerror = request.onblocked = () => { opening = null; reject(Error('Envoi différé : le stockage de coordination est indisponible. Les avis restent ici.')); };
    });
    return opening;
  }
  async function rate(reserve, until = 0) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('rate', 'readwrite'), store = tx.objectStore('rate'), request = store.get('next');
      let waitUntil = 0;
      request.onsuccess = () => {
        const now = Date.now(), next = Math.max(Number(request.result) || 0, until);
        waitUntil = next > now ? next : 0;
        store.put(reserve && !waitUntil ? now + GAP : next, 'next');
      };
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
  function schedule(delay = DEBOUNCE) {
    clearTimeout(timer);
    if (navigator.onLine !== false) timer = setTimeout(() => { sendGroup(window.HEPFeedback?.name() || '').catch(() => schedule(30000)); }, Math.max(delay, 100));
  }
  function sendGroup(firstName, onProgress = () => {}, { exiting = false } = {}) {
    if (running) return running;
    clearTimeout(timer);
    const task = async () => {
      const url = endpoint(), plan = await S.prepare(firstName, String(window.CONFIG?.APP_VERSION || 'candidate'));
      let received = 0, stopped = '', waitUntil = 0;
      const owner = crypto.randomUUID();
      // Freeze the group once, then send bounded individual messages under the
      // existing service contract. Every retry reuses its durable UUID and body.
      for (const id of plan.ids) {
        if (navigator.onLine === false) { stopped = 'Hors ligne : les avis restent ici et repartiront à la reconnexion.'; break; }
        const claim = await S.claim(id, owner);
        if (claim.kind === 'received' || claim.kind === 'superseded') continue;
        if (claim.kind === 'wait') { waitUntil = claim.retryAt; stopped = 'Envoi différé, avis conservés.'; break; }
        if (claim.kind === 'busy') { waitUntil = Date.now() + 60000; stopped = 'Un autre onglet envoie ces avis.'; break; }
        let slot;
        try { slot = await rate(true); }
        catch (error) { await S.complete(id, owner, null, Date.now() + 30000, 'coordination'); throw error; }
        if (slot) { waitUntil = slot; await S.complete(id, owner, null, slot, 'rate_wait'); break; }
        // Browser keepalive budgets include all in-flight bodies and are small.
        // Oversized exit messages stay pending for the next normal page visit.
        if (exiting && new TextEncoder().encode(claim.body).length > 60000) { await S.complete(id, owner, null, 0, 'exit_size'); break; }
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(url, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, keepalive: exiting, body: claim.body });
          if (response.status !== 200) {
            waitUntil = Date.now() + ([429, 503].includes(response.status) ? retryDelay(response) : 300000);
            await rate(false, waitUntil);
            stopped = response.status === 409 ? 'Conflit d’envoi : conserve une sauvegarde des avis.' : response.status === 429 ? 'Limite d’envoi atteinte. Nouvelle tentative prévue ; avis conservés.' : 'Envoi non reçu (' + response.status + '). Les avis restent ici.';
            await S.complete(id, owner, null, waitUntil, 'http_' + response.status);
            break;
          }
          const ack = await response.json();
          if (!S.validAck(ack, id)) throw Error('invalid_ack');
          await S.complete(id, owner, ack);
          received++;
          onProgress({ received });
        } catch (_) {
          waitUntil = Date.now() + 30000;
          await S.complete(id, owner, null, waitUntil, 'unconfirmed');
          await rate(false, waitUntil);
          stopped = 'Envoi non confirmé. Les avis sont conservés et seront retentés.';
          break;
        } finally { clearTimeout(timeout); }
        // One keepalive request at most, even when multiple exit events fire.
        if (exiting) break;
      }
      const counts = S.counts(await S.read());
      if (!stopped && plan.blocked.length) stopped = plan.blocked.length + ' avis trop volumineux ou incomplet(s), conservé(s). Télécharge une sauvegarde.';
      return { received, counts, stopped, waitUntil };
    };
    running = task().then(result => {
      notify(result);
      if (result.counts.pending && !exiting) schedule(Math.max(3000, result.waitUntil - Date.now() || GAP));
      return result;
    }).finally(() => { running = null; });
    return running;
  }
  async function changed() {
    if (checking) { checkAgain = true; return; }
    checking = true;
    try {
      const state = await S.read(), next = JSON.stringify(state.threads);
      if (next !== signature) { signature = next; if (S.counts(state).pending) schedule(); }
    } catch (_) { /* UI exposes storage failures. Never send unsaved data. */ }
    finally { checking = false; if (checkAgain) { checkAgain = false; changed(); } }
  }
  S.subscribe(changed);
  window.addEventListener('online', () => schedule());
  window.addEventListener('focus', changed);
  const exit = () => { sendGroup(window.HEPFeedback?.name() || '', () => {}, { exiting: true }).catch(() => {}); };
  window.addEventListener('pagehide', exit);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') exit(); else changed(); });
  window.HEPQuickSend = { sendGroup, schedule, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  changed();
}());
