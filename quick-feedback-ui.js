(function () {
  'use strict';
  const S = window.HEPQuickStore;
  let generation = 0, sending = false, unsubscribe;
  let groupMessage = '', activeRefresh = () => {};
  function thumbs() {
    return '<section class="quick-vote" aria-label="Ton avis sur cette question"><span class="quick-vote-label">Cette question…</span><div class="quick-vote-buttons"><button type="button" class="quick-thumb quick-up" data-quick-value="up" aria-pressed="false"><span aria-hidden="true">👍</span> Utile et claire</button><button type="button" class="quick-thumb quick-down" data-quick-value="down" aria-pressed="false"><span aria-hidden="true">👎</span> À revoir</button></div><p class="help-text quick-vote-state" data-quick-vote-status role="status" aria-live="polite">Un clic conserve ton avis ici ; l’envoi se fait en groupe.</p><details data-quick-comment-wrap hidden><summary>Ajouter un commentaire (facultatif)</summary><label class="field-label" for="quick-vote-comment">Ce qui serait à revoir</label><textarea id="quick-vote-comment" class="feedback-textarea" maxlength="8000" rows="3"></textarea><p class="help-text" data-quick-comment-status role="status"></p></details></section>';
  }
  function group() {
    return '<section class="quick-group" aria-label="Envoyer les avis sur les QCM"><h2>Mes avis sur les questions</h2><p class="help-text" data-quick-count role="status">Lecture des avis enregistrés…</p><details class="quick-name"><summary>Ajouter un prénom (facultatif)</summary><label class="field-label" for="quick-first-name">Prénom</label><input id="quick-first-name" data-feedback-first-name class="text-input" maxlength="80" autocomplete="given-name"></details><div class="actions"><button type="button" class="btn primary" data-quick-send disabled>Envoyer mes avis</button><button type="button" class="btn ghost" data-action="avis">Mes avis et sauvegarde</button></div><p class="help-text">Envoi groupé sans compte Google, seulement pour les avis courants non reçus.</p><p class="save-status" data-quick-send-status role="status" aria-live="polite"></p></section>';
  }
  function archive() {
    return '<h1>Mes avis sur les QCM</h1>' + group() + '<section class="settings-card"><h2>Sauvegarder mes avis</h2><p>Ces avis, leurs intentions d’envoi et leurs reçus sont sur cet appareil. Cette sauvegarde dédiée permet de les reprendre après un changement de navigateur. Ils ne sont pas inclus dans la sauvegarde Drive.</p><div class="actions"><button type="button" class="btn secondary" data-quick-export>Télécharger mes avis</button><button type="button" class="btn secondary" data-quick-import>Reprendre mes avis</button><input type="file" id="quick-backup-file" accept=".json,application/json" hidden></div><p class="help-text" data-quick-archive-status role="status"></p></section><section data-quick-list aria-label="Avis conservés"></section><p class="help-text"><button type="button" class="btn ghost" data-action="feedback">Mes autres retours</button></p>';
  }
  function download(value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'HEP-QCM-avis-sauvegarde.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function bind({ question, getSnapshot } = {}) {
    const gen = ++generation;
    unsubscribe?.();
    const root = document.getElementById('app'), voteBox = root.querySelector('.quick-vote');
    const comment = root.querySelector('#quick-vote-comment'), commentWrap = root.querySelector('[data-quick-comment-wrap]');
    let editorVersion = null, ownWrite = false, commentQueue = Promise.resolve(), sequence = 0, voteError = '';
    const message = (selector, text) => { if (gen === generation) { const node = root.querySelector(selector); if (node) node.textContent = text; } };
    const refresh = async () => {
      const seq = ++sequence;
      try {
        const state = await S.read();
        if (gen !== generation || seq !== sequence) return;
        const count = S.counts(state), thread = question && state.threads[S.keyOf(question)];
        message('[data-quick-count]', count.pending + ' avis à envoyer · ' + count.received + ' reçu' + (count.received > 1 ? 's' : '') + '.');
        message('[data-quick-send-status]', sending ? 'Envoi groupé en cours…' : groupMessage);
        root.querySelectorAll('[data-quick-send]').forEach(button => { button.disabled = sending || !count.pending; button.textContent = sending ? 'Envoi en cours…' : 'Envoyer mes avis'; button.setAttribute('aria-busy', String(sending)); });
        if (voteBox) {
          voteBox.querySelectorAll('[data-quick-value]').forEach(button => button.setAttribute('aria-pressed', String(thread?.current.value === button.dataset.quickValue)));
          message('[data-quick-vote-status]', voteError || (thread ? (thread.current.value === 'up' ? '👍 Utile et claire. ' : '👎 À revoir. ') + (S.currentReceived(state, thread) ? 'Avis reçu.' : 'Avis enregistré sur cet appareil, à envoyer en groupe.') : 'Un clic conserve ton avis ici ; l’envoi se fait en groupe.'));
          commentWrap.hidden = !thread || (thread.current.value !== 'down' && !thread.current.comment);
          if (thread && document.activeElement !== comment && !ownWrite) { comment.value = thread.current.comment; editorVersion = thread.version; }
          if (thread && editorVersion === null) editorVersion = thread.version;
        }
        const list = root.querySelector('[data-quick-list]');
        if (list) {
          list.replaceChildren();
          for (const t of Object.values(state.threads).sort((a, b) => b.current.updatedAt.localeCompare(a.current.updatedAt))) {
            const article = document.createElement('article'); article.className = 'feedback-item';
            const title = document.createElement('h2'); title.textContent = t.current.value === 'up' ? '👍 Utile et claire' : '👎 À revoir';
            const status = document.createElement('p'); status.className = 'help-text'; status.textContent = S.currentReceived(state, t) ? 'Avis courant reçu.' : 'Avis courant à envoyer.';
            const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Question et contenus conservés'; details.append(summary);
            for (const text of [t.current.snapshot.question, t.current.snapshot.answer, t.current.snapshot.hint, t.current.comment]) { if (!text) continue; const p = document.createElement('p'); p.className = 'exercise-text'; p.textContent = text; details.append(p); }
            article.append(title, status, details); list.append(article);
          }
          if (!count.total) list.textContent = 'Aucun avis enregistré pour le moment.';
          const old = Object.values(state.intents).filter(i => !S.currentReceived({ intents: { [i.payload.submissionId]: i } }, { threadId: i.payload.vote.threadId, version: i.payload.vote.version }) && state.threads[i.key]?.version !== i.payload.vote.version).length;
          if (old) { const p = document.createElement('p'); p.className = 'help-text'; p.textContent = old + ' ancienne(s) intention(s) non confirmée(s), conservée(s) dans la sauvegarde. Seuls les avis courants sont proposés à l’envoi.'; list.append(p); }
        }
      } catch (error) {
        message('[data-quick-vote-status]', error.message); message('[data-quick-count]', error.message); message('[data-quick-archive-status]', error.message);
      }
    };
    activeRefresh = refresh;
    unsubscribe = S.subscribe(refresh);
    voteBox?.querySelectorAll('[data-quick-value]').forEach(button => button.addEventListener('click', async () => {
      // Snapshot synchronously, before any storage wait or another tab refresh.
      const snap = getSnapshot();
      ownWrite = true;
      try { const t = await S.setVote(question, button.dataset.quickValue, snap); voteError = ''; editorVersion = t.version; if (comment && document.activeElement !== comment) comment.value = t.current.comment; }
      catch (error) { voteError = error.message; }
      finally { ownWrite = false; refresh(); }
    }));
    comment?.addEventListener('input', () => {
      const value = comment.value;
      ownWrite = true;
      commentQueue = commentQueue.then(async () => {
        try { const t = await S.setComment(question, editorVersion, value); editorVersion = t.version; message('[data-quick-comment-status]', 'Commentaire enregistré sur cet appareil.'); }
        catch (error) { message('[data-quick-comment-status]', error.message); }
      }).finally(() => { ownWrite = false; refresh(); });
    });
    const nameField = root.querySelector('#quick-first-name');
    if (nameField) nameField.value = HEPFeedback.name();
    root.querySelector('[data-quick-send]')?.addEventListener('click', async () => {
      if (sending) return;
      sending = true; groupMessage = ''; refresh();
      try {
        const result = await HEPQuickSend.sendGroup(nameField?.value ?? HEPFeedback.name(), progress => message('[data-quick-send-status]', progress.received + ' avis reçu(s) dans ce groupe…'));
        groupMessage = result.received + ' avis reçu(s) dans ce groupe. ' + result.counts.pending + ' restant(s). ' + (result.stopped || 'Tous tes avis courants ont été reçus.') + (result.waitUntil ? ' Réessaie après ' + new Date(result.waitUntil).toLocaleTimeString('fr-CH') + '.' : '');
      } catch (error) { groupMessage = error.message; }
      finally { sending = false; activeRefresh(); }
    });
    root.querySelector('[data-quick-export]')?.addEventListener('click', async () => {
      try { download(await S.read()); message('[data-quick-archive-status]', 'Sauvegarde des avis préparée. Conserve ce fichier avant d’effacer les données du navigateur.'); }
      catch (error) { message('[data-quick-archive-status]', error.message); }
    });
    root.querySelector('[data-quick-import]')?.addEventListener('click', () => root.querySelector('#quick-backup-file').click());
    root.querySelector('#quick-backup-file')?.addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 25 * 1024 * 1024) throw Error('Cette sauvegarde est trop volumineuse.');
        await S.restore(JSON.parse(await file.text()));
        message('[data-quick-archive-status]', 'Avis et reçus repris. Aucun envoi automatique.'); refresh();
      } catch (error) { message('[data-quick-archive-status]', error.message); }
      finally { event.target.value = ''; }
    });
    refresh();
  }
  // Refresh on focus without starting any sender or requiring cross-tab locks.
  window.addEventListener('focus', () => activeRefresh());
  window.HEPQuickUI = { thumbs, group, archive, bind };
}());
