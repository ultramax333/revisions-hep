(function () {
  'use strict';
  const S = HEPStore, KEY = 'hep-revisions-qcm-state-v1', SCOPE = 'fra-qcm-pilote';
  const repo = new S.Repository({ getItem: () => localStorage.getItem(KEY), setItem: (_, value) => localStorage.setItem(KEY, value) });
  const app = document.getElementById('app');
  let bank, byId, active = null, view = 'home', displayedRun = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = value => `<span class="exercise-text">${esc(value)}</span>`;
  const comments = () => S.feedbackThreads(repo.state).filter(item => !item.deleted && item.comment.trim());
  const runKey = q => 'qcm::' + q.id + '::' + q.qcmRevision;
  const feedbackQuestion = q => ({ id: q.id + '::qcm', contentRevision: q.qcmRevision });
  function status() {
    document.querySelectorAll('[data-save-status]').forEach(node => { node.textContent = repo.warning || HEPDrive.status(); });
    document.querySelectorAll('[data-feedback-count]').forEach(node => { node.textContent = comments().length; });
  }
  function changed() { status(); HEPDrive.schedule(); }
  function writeRun(q, run) {
    const key = runKey(q), previous = repo.state.drafts[key];
    repo.state.drafts[key] = { text: JSON.stringify(run), updatedAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString() };
    repo.save(); changed();
  }
  function shuffled(ids) {
    const result = [...ids];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  function readRun(q) {
    let raw; try { raw = JSON.parse(repo.state.drafts[runKey(q)]?.text || 'null'); } catch (_) { raw = null; }
    const run = { id: typeof raw?.id === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(raw.id) ? raw.id : S.uuid(), answers: {}, order: {}, checked: false, hintUsed: !!raw?.hintUsed };
    for (const step of q.steps) {
      const ids = step.choices.map(c => c.id), order = raw?.order?.[step.id];
      run.order[step.id] = Array.isArray(order) && order.length === 4 && new Set(order).size === 4 && order.every(id => ids.includes(id)) ? order : shuffled(ids);
      if (ids.includes(raw?.answers?.[step.id])) run.answers[step.id] = raw.answers[step.id];
    }
    run.checked = !!raw?.checked && q.steps.every(step => run.answers[step.id]);
    if (JSON.stringify(raw) !== JSON.stringify(run)) writeRun(q, run);
    return run;
  }
  const sameRun = (left, right) => left && right && left.id === right.id && left.checked === right.checked && S.stable(left.order) === S.stable(right.order);
  function ingestLocal() {
    try { const saved = localStorage.getItem(KEY); if (saved) repo.ingest(JSON.parse(saved)); } catch (_) { /* Repository.save reports unavailable storage. */ }
  }
  function refreshRunControls() {
    if (view !== 'exercise' || !active || !displayedRun) return;
    const current = readRun(active);
    if (!sameRun(current, displayedRun)) { toast('Cet essai a changé ailleurs. Une nouvelle action l’actualisera ; tes retours précédents restent conservés.'); return; }
    document.querySelectorAll('.qcm-choice input').forEach(input => { input.checked = current.answers[input.name] === input.value; });
  }
  async function mutateRun(q, expected, change, after) {
    const perform = () => {
      ingestLocal();
      const current = readRun(q);
      if (!sameRun(current, expected)) {
        if (view === 'exercise' && active?.id === q.id) render();
        toast('L’essai a changé ailleurs. Il a été actualisé sans rétablir les anciens choix.'); return;
      }
      const next = change(current); writeRun(q, next);
      if (after) after(next);
      else refreshRunControls();
    };
    if (navigator.locks) await navigator.locks.request(SCOPE + '-edit', perform);
    else perform();
  }
  function snapshot(q, run) {
    return { module: q.module, course: q.course,
      question: q.title + '\n\n' + q.context + '\n\n' + q.prompt + '\n\n' + q.steps.map((s, i) => `${i + 1}. ${s.prompt}\n` + run.order[s.id].map((id, j) => `${String.fromCharCode(65 + j)}. ${s.choices.find(c => c.id === id).text}`).join('\n')).join('\n\n'),
      answer: q.steps.map((s, i) => `${i + 1}. ${s.prompt}\n` + run.order[s.id].map((id, j) => { const c = s.choices.find(c => c.id === id); return `${String.fromCharCode(65 + j)}. ${c.text}\n${id === s.correctId ? 'Réponse correcte. ' : ''}${c.explanation}`; }).join('\n')).join('\n\n'),
      hint: q.hints.join('\n\n') };
  }
  function toast(message) {
    const node = document.getElementById('toast'); node.textContent = message; node.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 5000);
  }
  function header() {
    return `<header class="site-header"><button class="brand" data-action="home"><img class="brand-mark" src="icon.svg" alt=""><span><span class="brand-title">Essai · QCM guidés</span><span class="brand-subtitle">Français · Bloc oral</span></span></button><nav class="header-actions" aria-label="Navigation des QCM"><button class="btn ghost" data-action="home">Exercices</button><button class="btn ghost" data-action="feedback">Mes retours <span class="badge" data-feedback-count>${comments().length}</span></button><button class="icon-button" data-action="settings" aria-label="Sauvegardes des QCM">↗</button></nav></header>`;
  }
  function home() {
    return `<section class="home-hero oral-home-hero"><h1 class="hero-title">Comprendre, puis rédiger</h1><p class="hero-description">Trois exercices à essayer. Pour chacun, plusieurs QCM préparent le raisonnement de la question complète. Quatre propositions, une seule réponse correcte.</p><p class="help-text">Les corrections expliquent les différences entre les propositions. Ensuite, passe à la rédaction sans choix de réponses.</p></section><section class="exercise-grid">${bank.exercises.map(q => {
      const run = readRun(q), score = q.steps.filter(s => run.answers[s.id] === s.correctId).length;
      return `<article class="course-card exercise-tile"><h2>${esc(q.title)}</h2><p class="help-text">${q.steps.length} QCM${run.checked ? ` · ${score} / ${q.steps.length} lors du dernier essai` : ''}</p><div class="actions"><button class="btn primary" data-exercise="${q.id}">${Object.keys(run.answers).length ? 'Reprendre les QCM' : 'Essayer les QCM'}</button><a class="btn secondary" href="oral.html#${q.id}">Rédiger sans QCM</a></div></article>`;
    }).join('')}</section><p class="notice">Le résultat des QCM mesure la reconnaissance d’une réponse. La rédaction et sa justification restent à travailler séparément.</p><p class="help-text"><a href="oral.html">Retour au bloc oral</a></p>`;
  }
  function stepView(q, step, index, run) {
    const selected = step.choices.find(c => c.id === run.answers[step.id]), correct = step.choices.find(c => c.id === step.correctId);
    return `<fieldset class="qcm-step" data-step="${step.id}"><legend>${index + 1}. ${esc(step.prompt)}</legend><div class="qcm-choices">${run.order[step.id].map((id, i) => { const c = step.choices.find(c => c.id === id); return `<label class="qcm-choice ${run.checked && id === step.correctId ? 'qcm-correct' : run.checked && id === selected?.id ? 'qcm-incorrect' : ''}"><input type="radio" name="${step.id}" value="${id}" ${selected?.id === id ? 'checked' : ''} ${run.checked ? 'disabled' : ''}><span><strong>${String.fromCharCode(65 + i)}.</strong> ${esc(c.text)}</span></label>`; }).join('')}</div>${run.checked ? `<div class="qcm-verdict" role="status"><strong>${selected.id === step.correctId ? 'Réponse correcte.' : 'À reprendre.'}</strong><p>${text(selected.explanation)}</p>${selected.id !== step.correctId ? `<p><strong>Réponse attendue :</strong> ${text(correct.text)} ${text(correct.explanation)}</p>` : ''}<details><summary>Comprendre les quatre propositions</summary>${run.order[step.id].map((id, i) => { const c = step.choices.find(c => c.id === id); return `<p><strong>${String.fromCharCode(65 + i)}${id === step.correctId ? ' · correcte' : ''}.</strong> ${text(c.explanation)}</p>`; }).join('')}</details></div>` : ''}</fieldset>`;
  }
  function exercise() {
    const q = active, run = readRun(q), snap = snapshot(q, run), saved = S.currentFeedback(repo.state, feedbackQuestion(q), snap);
    const categories = ['Consigne', ...q.steps.map((s, i) => 'QCM ' + (i + 1)), 'Aides', 'Passage à la rédaction', 'Autre'];
    const ref = bank.courseReference, source = q.sources.find(s => s.file.includes('SYNTHESE')) || q.sources[0];
    return `<section class="question-shell"><button class="btn ghost" data-action="home">← Les 3 exercices</button><article class="question-card"><p class="eyebrow">Entraînement guidé · ${q.steps.length} QCM</p><h1 class="exercise-title">${esc(q.title)}</h1><p class="exercise-origin"><span>${esc(ref.label)} · ${esc(ref.date)}</span><span>Passage à relire : ${esc(source.location)}</span></p><div class="exercise-context">${text(q.context)}</div><details class="hint-panel"><summary>La question complète à préparer</summary><p>${text(q.prompt)}</p></details><details class="hint-panel" id="qcm-hint"><summary>Un rappel des concepts</summary>${q.hints.map(h => `<p>${text(h)}</p>`).join('')}</details><p class="help-text">Choisis une réponse par question, puis vérifie l’ensemble. Les propositions changent de place à chaque nouvel essai.</p>${q.steps.map((s, i) => stepView(q, s, i, run)).join('')}<div class="actions">${run.checked ? '<button class="btn secondary" data-action="restart">Recommencer les QCM</button>' : '<button class="btn primary" data-action="check">Vérifier mes réponses</button>'}<a class="btn ${run.checked ? 'primary' : 'secondary'}" href="oral.html#${q.id}">Rédiger cet exercice sans QCM →</a></div><p class="help-text">La rédaction s’ouvre dans le bloc oral, avec sa propre réponse et son autoévaluation. Les choix du QCM ne s’y affichent pas.</p></article><details class="feedback-panel" ${saved?.comment ? 'open' : ''}><summary>Mon retour sur cet essai</summary><label class="field-label" for="feedback-category">Cela concerne…</label><select class="select-input" id="feedback-category">${categories.map(c => `<option ${saved?.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><label class="field-label" for="feedback-comment">Mon commentaire</label><textarea class="feedback-textarea" id="feedback-comment" rows="4" maxlength="8000" placeholder="Ex. : deux propositions me semblent justes ; la correction n’explique pas leur différence…">${esc(saved?.comment || '')}</textarea><p class="help-text">Ton retour conserve les propositions dans l’ordre affiché et leurs explications.</p><p class="save-status" data-save-status></p></details></section>`;
  }
  function feedback() {
    return `<h1>Mes retours sur les QCM</h1><div class="actions"><button class="btn primary" data-action="copy" ${comments().length ? '' : 'disabled'}>Copier les retours</button><button class="btn secondary" data-action="export" ${comments().length ? '' : 'disabled'}>Télécharger les retours</button></div><div class="feedback-list">${comments().sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => `<article class="feedback-item"><span class="pill">${esc(item.category)}</span><h2>${esc(item.snapshot.question.split('\n')[0])}</h2><p class="exercise-text">${esc(item.comment)}</p><button class="btn ghost" data-exercise="${esc(item.questionId.split('::')[0])}">Revoir les QCM →</button></article>`).join('') || '<p class="empty-state">Tu peux laisser un retour dans chaque exercice.</p>'}</div><p class="help-text">Les retours restent privés. Copie-les dans notre discussion pour nous les transmettre.</p>`;
  }
  function settings() {
    return `<h1>Sauvegardes des QCM</h1><section class="settings-card"><h2>Sur cet appareil</h2><p>Choix, résultats et retours sont conservés ici. Cet essai possède sa propre sauvegarde.</p><div class="actions"><button class="btn primary" data-action="backup">Télécharger une sauvegarde</button><button class="btn secondary" data-action="import">Importer une sauvegarde QCM</button><input id="backup-file" type="file" accept=".json,application/json" hidden></div></section><section class="settings-card"><h2>Google Drive, facultatif</h2><p>Dossier « Révisions HEP — Essai QCM ». La connexion est à renouveler après fermeture.</p><div class="actions">${HEPDrive.connected() ? '<button class="btn primary" data-action="sync">Synchroniser maintenant</button><button class="btn ghost" data-action="disconnect">Déconnecter</button>' : '<button class="btn primary" data-action="connect">Connecter Google Drive</button>'}</div><p data-save-status class="save-status"></p></section>`;
  }
  function render() {
    app.innerHTML = `<div class="page">${header()}<div id="qcm-main" tabindex="-1">${view === 'exercise' ? exercise() : view === 'feedback' ? feedback() : view === 'settings' ? settings() : home()}</div><footer class="footer"><span class="save-status" data-save-status></span><a href="oral.html">Bloc oral</a></footer></div>`;
    status();
    if (view === 'exercise') {
      const q = active, run = readRun(q), snap = snapshot(q, run);
      displayedRun = run;
      document.querySelectorAll('.qcm-choice input').forEach(input => input.addEventListener('change', () => { mutateRun(q, run, current => { current.answers[input.name] = input.value; return current; }); }));
      document.getElementById('qcm-hint').addEventListener('toggle', event => { if (event.target.open) mutateRun(q, run, current => { current.hintUsed = true; return current; }); });
      const saveComment = () => { repo.comment(feedbackQuestion(q), document.getElementById('feedback-category').value, document.getElementById('feedback-comment').value, snap); changed(); };
      document.getElementById('feedback-comment').addEventListener('input', saveComment);
      document.getElementById('feedback-category').addEventListener('change', saveComment);
    }
    document.getElementById('backup-file')?.addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 25 * 1024 * 1024) throw new Error('Ce fichier est trop volumineux.');
        const raw = JSON.parse(await file.text());
        if (raw.scope !== SCOPE) throw new Error('Choisis une sauvegarde de l’essai QCM.');
        repo.import(raw); changed(); render(); toast('Sauvegarde QCM réunie avec tes données.');
      } catch (error) { toast(error.message); }
    });
  }
  function route() {
    let hash; try { hash = decodeURIComponent(location.hash.slice(1)); } catch (_) { hash = ''; }
    active = byId.get(hash) || null; view = active ? 'exercise' : ['feedback', 'settings'].includes(hash) ? hash : 'home';
    render(); document.getElementById('qcm-main').focus({ preventScroll: true }); window.scrollTo(0, 0);
  }
  function navigate(target) { if (location.hash.slice(1) === target) route(); else location.hash = target; }
  function download(name, value, mime = 'application/json') {
    const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: mime + ';charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  app.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || button.disabled || !bank) return;
    if (button.dataset.exercise) return navigate(button.dataset.exercise);
    const action = button.dataset.action;
    if (['home', 'feedback', 'settings'].includes(action)) return navigate(action === 'home' ? '' : action);
    if (action === 'check' && active) {
      const q = active, expected = displayedRun;
      return mutateRun(q, expected, run => run, run => {
        const missing = q.steps.find(s => !run.answers[s.id]);
        if (missing) { toast('Choisis une proposition pour chaque QCM avant de vérifier.'); document.querySelector(`[data-step="${missing.id}"] input`)?.focus(); return; }
        run.checked = true; writeRun(q, run);
        q.steps.forEach(s => repo.grade({ id: q.id + '::' + s.id, contentRevision: q.qcmRevision }, run.answers[s.id] === s.correctId ? 2 : 0, run.id, run.hintUsed));
        changed();
        if (view === 'exercise' && active?.id === q.id) { render(); document.querySelector('.qcm-verdict').scrollIntoView({ block: 'center' }); }
      });
    }
    if (action === 'restart' && active) {
      const q = active;
      return mutateRun(q, displayedRun, () => ({ id: S.uuid(), answers: {}, order: Object.fromEntries(q.steps.map(s => [s.id, shuffled(s.choices.map(c => c.id))])), checked: false, hintUsed: false }), () => { if (view === 'exercise' && active?.id === q.id) { render(); document.querySelector('.qcm-step').scrollIntoView(); } });
    }
    if (action === 'backup') return download('FRA-QCM-sauvegarde.json', { ...repo.state, scope: SCOPE });
    if (action === 'import') return document.getElementById('backup-file').click();
    if (action === 'export') return download('FRA-QCM-retours.json', { ...S.feedbackBundle(repo.state, bank), scope: SCOPE });
    if (action === 'copy') {
      const report = '# Retours sur les QCM FRA\n\n' + comments().map((item, i) => `## ${i + 1}. ${item.category}\n\n${item.snapshot.question}\n\nEXPLICATIONS\n${item.snapshot.answer}\n\nAIDES\n${item.snapshot.hint}\n\nMON RETOUR\n${item.comment}\n\nRéférence : ${item.questionId} · ${item.contentRevision}`).join('\n\n');
      try { await navigator.clipboard.writeText(report); toast('Retours copiés.'); } catch (_) { download('FRA-QCM-retours.md', report, 'text/markdown'); } return;
    }
    if (action === 'disconnect') { HEPDrive.disconnect(); render(); return; }
    if (['connect', 'sync'].includes(action)) { button.disabled = true; try { if (action === 'connect') await HEPDrive.connect(); else await HEPDrive.sync(); render(); } catch (error) { button.disabled = false; toast(error.message); } }
  });
  window.addEventListener('hashchange', () => { if (bank) route(); });
  window.addEventListener('storage', event => { if (event.key === KEY && event.newValue) { try { repo.ingest(JSON.parse(event.newValue)); status(); refreshRunControls(); } catch (_) { toast('La sauvegarde d’un autre onglet est illisible.'); } } });
  (async () => {
    try {
      const response = await fetch('data/qcm-pilote.json', { cache: 'no-cache' }); if (!response.ok) throw new Error('La banque QCM est indisponible.');
      bank = await response.json(); if (bank.id !== SCOPE || bank.schemaVersion !== 1 || bank.exercises?.length !== 3) throw new Error('Format QCM incompatible.');
      byId = new Map(bank.exercises.map(q => [q.id, q]));
      HEPDrive.init(repo, status, () => { if (view !== 'exercise') render(); else refreshRunControls(); }); repo.save(); route();
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    } catch (error) { bank = null; app.innerHTML = `<section class="empty-state"><h1>Les QCM n’ont pas pu s’ouvrir.</h1><p>${esc(error.message)}</p><p>Reconnecte-toi puis recharge la page. Tes données restent dans ce navigateur.</p><a href="oral.html">Retour au bloc oral</a></section>`; }
  })();
}());
