(function () {
  'use strict';
  const KEY = 'hep-revisions-feedback-send-v1';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const inFlight = new Map();
  class SendError extends Error { constructor(message, code, retryAt = 0) { super(message); this.code = code; this.retryAt = retryAt; } }
  const issue = (message, code) => new SendError(message, code);
  function useful(input) {
    const data = JSON.parse(JSON.stringify({ firstName: input.firstName, feedback: input.feedback, collection: 'fra-qcm-oral' }));
    if (typeof data.firstName !== 'string' || data.firstName.length > 80 || !data.feedback || typeof data.feedback !== 'object') throw issue('Vérifie le prénom et le commentaire avant l’envoi.', 'invalid');
    const f = data.feedback;
    if (typeof f.questionId !== 'string' || !f.questionId || typeof f.contentRevision !== 'string' || !/^[0-9a-f]{12,64}$/i.test(f.contentRevision) || typeof f.category !== 'string' || !f.category || typeof f.comment !== 'string' || !f.comment.trim()) throw issue('Le retour est incomplet. Ton brouillon reste sur cet appareil.', 'invalid');
    if (!f.snapshot || typeof f.snapshot !== 'object') throw issue('Le contenu de la question manque. Rouvre le signalement.', 'invalid');
    for (const field of ['question', 'answer', 'hint', 'module', 'course']) {
      const max = ['module', 'course'].includes(field) ? 80 : 20000;
      if (typeof f.snapshot[field] !== 'string' || f.snapshot[field].length > max) throw issue('Le contenu conservé dépasse la taille permise. Ton brouillon reste ici.', 'too_large');
    }
    return data;
  }
  async function identity(data) {
    if (!window.crypto?.subtle) throw issue('L’envoi nécessite une page sécurisée. Ton brouillon reste ici.', 'unavailable');
    const bytes = new TextEncoder().encode(HEPStore.stable(data));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { schema: 'hep-qcm-feedback-send/1', entries: {} };
      const value = JSON.parse(raw);
      if (value.schema !== 'hep-qcm-feedback-send/1' || !value.entries || Array.isArray(value.entries) || typeof value.entries !== 'object') throw Error();
      return value;
    } catch (_) { throw issue('L’état des envois ne peut pas être lu. Ton brouillon est conservé ; télécharge une sauvegarde.', 'storage'); }
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (_) { throw issue('L’envoi ne peut pas être mémorisé sur cet appareil. Ton brouillon reste ici.', 'storage'); }
  }
  function validAck(ack, id) {
    return typeof id === 'string' && UUID.test(id) && !!ack && ack.ok === true && ack.submissionId === id.toLowerCase() && typeof ack.receiptId === 'string' && UUID.test(ack.receiptId) && typeof ack.receivedAt === 'string' && Number.isFinite(Date.parse(ack.receivedAt)) && new Date(ack.receivedAt).toISOString() === ack.receivedAt;
  }
  async function inspect(input) {
    const key = await identity(useful(input)), entry = load().entries[key];
    return { key, sent: !!entry && validAck(entry.ack, entry.submissionId), sending: inFlight.has(key), pending: !!entry?.payload, retryAt: Number(entry?.retryAt) || 0 };
  }
  function endpoint() {
    const value = window.CONFIG?.FEEDBACK_ENDPOINT;
    if (!value) throw issue('L’envoi à Maxim n’est pas encore disponible. Ton brouillon est conservé.', 'unavailable');
    let url; try { url = new URL(value); } catch (_) { throw issue('L’adresse d’envoi est indisponible. Ton brouillon est conservé.', 'unavailable'); }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw issue('L’adresse d’envoi doit être sécurisée. Ton brouillon est conservé.', 'unavailable');
    return url.href;
  }
  async function send(input) {
    const data = useful(input), key = await identity(data);
    if (inFlight.has(key)) return inFlight.get(key);
    const run = async () => {
      let state = load(), entry = state.entries[key];
      if (entry && validAck(entry.ack, entry.submissionId)) return { key, ack: entry.ack, alreadyReceived: true };
      const url = endpoint();
      if (!entry) {
        const submissionId = crypto.randomUUID();
        const payload = { schema: 'hep-qcm-feedback/1', submissionId, firstName: data.firstName, feedback: data.feedback, client: { appVersion: String(window.CONFIG?.APP_VERSION || ''), collection: data.collection } };
        if (new TextEncoder().encode(JSON.stringify(payload)).length > 65536) throw issue('Ce retour est trop volumineux pour être envoyé. Ton brouillon est conservé.', 'too_large');
        entry = { submissionId, payload, createdAt: new Date().toISOString() }; state.entries[key] = entry; save(state);
      }
      if (!entry.payload || !UUID.test(entry.submissionId) || entry.payload.submissionId !== entry.submissionId || await identity(useful(entry.payload)) !== key) throw issue('L’intention d’envoi ne peut pas être relue. Ton brouillon est conservé.', 'storage');
      if (entry.retryAt > Date.now()) throw new SendError('Attends un instant avant de réessayer. Ton brouillon est conservé.', 'retry_later', entry.retryAt);
      if (navigator.onLine === false) throw issue('Tu es hors ligne. Ton brouillon est conservé ; réessaie une fois connecté.', 'offline');
      let response; const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
      try {
        try { response = await fetch(url, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry.payload) }); }
        catch (_) { throw issue('Envoi non confirmé. Ton brouillon est conservé ; tu peux réessayer.', 'network'); }
        if (response.status !== 200) {
          let retryAt = 0;
          if ([429, 503].includes(response.status)) {
            const seconds = Number(response.headers.get('Retry-After'));
            if (Number.isFinite(seconds) && seconds > 0) retryAt = Date.now() + Math.min(seconds, 3600) * 1000;
            state = load(); state.entries[key] = { ...state.entries[key], retryAt }; save(state);
          }
          const message = response.status === 429 ? 'Trop d’envois pour le moment. Ton brouillon est conservé ; réessaie dans un instant.' : response.status === 503 ? 'Le service d’envoi est momentanément indisponible. Ton brouillon est conservé.' : response.status === 409 ? 'Ce retour ne correspond plus à son intention d’envoi. Ton brouillon est conservé.' : 'Envoi refusé (' + response.status + '). Ton brouillon est conservé ; tu peux réessayer.';
          throw new SendError(message, 'http_' + response.status, retryAt);
        }
        let ack; try { ack = await response.json(); } catch (_) { throw issue('Envoi non confirmé : la confirmation du service est illisible. Ton brouillon reste ici.', 'invalid_ack'); }
        if (!validAck(ack, entry.submissionId)) throw issue('Envoi non confirmé : le service n’a pas fourni de reçu valide. Ton brouillon reste ici.', 'invalid_ack');
        state = load(); state.entries[key] = { submissionId: entry.submissionId, ack }; save(state);
        return { key, ack, alreadyReceived: false };
      } finally { clearTimeout(timeout); }
    };
    const promise = navigator.locks ? navigator.locks.request(KEY, run) : run();
    inFlight.set(key, promise);
    try { return await promise; } finally { inFlight.delete(key); }
  }
  window.HEPFeedbackSend = { inspect, send };
}());
