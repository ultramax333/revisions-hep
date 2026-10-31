(function () {
  'use strict';
  const S = window.HEPQuickStore;
  let running = null;
  function endpoint() {
    let url;
    try { url = new URL(window.CONFIG?.FEEDBACK_ENDPOINT); } catch (_) { throw Error('L’envoi est indisponible. Les avis restent sur cet appareil.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('L’adresse d’envoi est indisponible. Les avis restent sur cet appareil.');
    return url.href;
  }
  function retryDelay(response) {
    const value = response.headers.get('Retry-After'), seconds = Number(value);
    if (value && Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 86400) * 1000;
    const date = Date.parse(value);
    if (Number.isFinite(date) && date > Date.now()) return Math.min(date - Date.now(), 86400000);
    return response.status === 429 ? 60000 : 30000;
  }
  function sendGroup(firstName, onProgress = () => {}) {
    if (running) return running;
    const task = async () => {
      const url = endpoint(), plan = await S.prepare(firstName, String(window.CONFIG?.APP_VERSION || 'candidate'));
      let received = 0, stopped = '', waitUntil = 0;
      // Bound one explicit gesture to 60 requests / 45s. Quotas, failures and
      // abandoned old versions remain durable; retry never starts by itself.
      const start = Date.now(), owner = crypto.randomUUID();
      for (const id of plan.ids.slice(0, 60)) {
        if (Date.now() - start > 45000) { stopped = 'Le groupe est interrompu après 45 secondes. Tu peux reprendre l’envoi.'; break; }
        if (navigator.onLine === false) { stopped = 'Hors ligne : les avis restent sur cet appareil. Réessaie une fois connecté.'; break; }
        const claim = await S.claim(id, owner);
        if (claim.kind === 'received' || claim.kind === 'superseded') continue;
        if (claim.kind === 'wait') { waitUntil = claim.retryAt; stopped = 'Le service demande d’attendre avant de réessayer.'; break; }
        if (claim.kind === 'busy') { stopped = 'Un autre onglet envoie ces avis. Tu pourras reprendre ici si nécessaire.'; break; }
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(url, { method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: claim.body });
          if (response.status !== 200) {
            if ([429, 503].includes(response.status)) waitUntil = Date.now() + retryDelay(response);
            stopped = response.status === 409 ? 'Conflit d’envoi : conserve une sauvegarde des avis. Aucun nouveau reçu.' : response.status === 429 ? 'Limite d’envoi atteinte. Les avis restants sont conservés.' : response.status === 503 ? 'Le service est momentanément indisponible. Les avis restants sont conservés.' : 'Envoi refusé (' + response.status + '). Les avis restants sont conservés.';
            await S.complete(id, owner, null, waitUntil, 'http_' + response.status);
            break;
          }
          const ack = await response.json();
          if (!S.validAck(ack, id)) throw Error('invalid_ack');
          await S.complete(id, owner, ack);
          received++;
          onProgress({ received });
        } catch (_) {
          // Keep the exact body, first name, UUID and version when delivery is in doubt.
          await S.complete(id, owner, null, 0, 'unconfirmed');
          stopped = 'Envoi non confirmé. Les avis sont conservés ; clique de nouveau pour reprendre.';
          break;
        } finally { clearTimeout(timer); }
      }
      const counts = S.counts(await S.read());
      if (!stopped && plan.blocked.length) stopped = plan.blocked.length + ' avis trop volumineux ou incomplet(s), conservé(s). Télécharge une sauvegarde.';
      if (!stopped && counts.pending) stopped = 'Des avis restent à envoyer. Clique de nouveau pour reprendre.';
      return { received, counts, stopped, waitUntil };
    };
    running = task().finally(() => { running = null; });
    return running;
  }
  window.HEPQuickSend = { sendGroup };
}());
