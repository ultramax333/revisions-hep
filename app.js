(function () {
  'use strict';
  const S = HEPStore;
  let storage;
  try { storage = window.localStorage; } catch (_) { storage = { getItem() { throw new Error(); }, setItem() { throw new Error(); } }; }
  const repo = new S.Repository(storage);
  const app = document.getElementById('app');
  let bank, questions, byId, view = 'home', revealed = false, hintUsed = false, search = '', filter = 'all', summary = null;
  const categories = ['Question peu claire', 'Réponse à corriger', 'Indice peu utile', 'Doublon', 'À retirer', 'Autre'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const plain = html => { const node = document.createElement('div'); node.innerHTML = safeHtml(html); return (node.textContent || '').trim(); };
  function safeHtml(html) {
    const template = document.createElement('template'); template.innerHTML = html || '';
    const allowed = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'SPAN', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'SUB', 'SUP']);
    function clean(parent) {
      [...parent.children].forEach(node => {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'MATH'].includes(node.tagName)) { node.remove(); return; }
        clean(node);
        if (!allowed.has(node.tagName)) { node.replaceWith(...node.childNodes); return; }
        const className = node.getAttribute('class');
        [...node.attributes].forEach(attr => node.removeAttribute(attr.name));
        if (node.tagName === 'SPAN' && ['blank', 'cloze-answer'].includes(className)) node.className = className;
      });
    }
    clean(template.content); return template.innerHTML;
  }
  const latestComments = () => S.feedbackThreads(repo.state).filter(item => !item.deleted && item.comment.trim());
  const questionSnapshot = q => ({ question: plain(q.questionHtml), answer: plain(q.answerHtml), hint: q.hint, module: q.module, course: q.course });
  const stats = () => {
    const values = Object.values(S.mastery(repo.state, questions));
    return { seen: values.length, acquired: values.filter(a => a.grade === 2).length, difficult: values.filter(a => a.grade < 2).length };
  };
  const current = () => repo.state.session && byId.get(repo.state.session.ids[repo.state.session.index]);
  function toast(message) {
    const node = document.getElementById('toast'); node.textContent = message; node.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 5000);
  }
  function status() {
    document.querySelectorAll('[data-save-status]').forEach(node => { node.textContent = repo.warning || HEPDrive.status(); });
    document.querySelectorAll('[data-feedback-count]').forEach(node => { node.textContent = latestComments().length; });
    const saved = document.getElementById('feedback-saved');
    if (saved) saved.textContent = repo.warning || 'Retour enregistré sur cet appareil';
  }
  function changed() { status(); HEPDrive.schedule(); }
  function header() {
    return `<header class="site-header"><button class="brand" data-action="home" aria-label="Révisions HEP, accueil"><img class="brand-mark" src="icon.svg" alt=""><span><span class="brand-title">Révisions HEP</span><span class="brand-subtitle">Comprendre, répondre, améliorer</span></span></button><nav class="header-actions" aria-label="Navigation"><button class="btn ghost" data-action="browse">Questions</button><button class="btn ghost" data-action="feedback">Mes retours <span class="badge" data-feedback-count>${latestComments().length}</span></button><button class="icon-button" data-action="settings" aria-label="Sauvegardes et paramètres" title="Sauvegardes">↗</button></nav></header>`;
  }
  function footer() {
    return `<footer class="footer"><span class="save-status" data-save-status>${esc(repo.warning || HEPDrive.status())}</span><button class="btn ghost small" data-action="settings">Sauvegardes</button></footer>`;
  }
  function render(focus = false) {
    let content;
    if (view === 'practice' && !current()) view = 'home';
    if (view === 'home') content = home();
    else if (view === 'practice') content = practice();
    else if (view === 'browse') content = browse();
    else if (view === 'feedback') content = feedback();
    else if (view === 'settings') content = settings();
    else content = summaryView();
    app.innerHTML = `<div class="page">${header()}<div id="main-content" tabindex="-1">${content}</div>${footer()}</div>`;
    bind();
    if (focus) { document.getElementById('main-content').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  }
  function home() {
    const n = stats(), resume = repo.state.session;
    return `<section class="home-hero"><p class="eyebrow">Ton espace de révision</p><h1 class="hero-title">Une question.<br>Le temps de réfléchir.</h1><p class="hero-description">Réponds à ton rythme, ouvre un indice si besoin, puis compare avec la réponse. Une formulation te gêne ? Laisse ton retour directement sur la question.</p><div class="actions">${resume ? '<button class="btn primary" data-action="resume">Reprendre la séance</button>' : '<button class="btn primary" data-action="start">Commencer une séance</button>'}<button class="btn secondary" data-action="browse">Parcourir les questions</button></div></section><section class="stats-grid" aria-label="Ta progression"><div class="stat"><span class="stat-number">${n.acquired}</span><span class="stat-label">acquises selon toi</span></div><div class="stat"><span class="stat-number">${n.difficult}</span><span class="stat-label">à retravailler</span></div><div class="stat"><span class="stat-number">${questions.length - n.seen}</span><span class="stat-label">à découvrir</span></div></section><div class="section-heading"><h2>Français</h2><span class="muted">Dire, lire, écrire I</span></div><section class="course-grid"><article class="course-card"><p class="eyebrow">Cours 01</p><h3 class="course-heading">Enseigner et accompagner le langage</h3><p class="muted">Notions, distinctions et situations d’application.</p><div class="course-meta"><span>${questions.length} questions</span><span>${n.seen} déjà évaluées</span></div><label class="field-label" for="session-count">Taille de la séance</label><select id="session-count" class="select-input"><option value="10" ${repo.state.preferences.count === 10 ? 'selected' : ''}>10 questions</option><option value="20" ${repo.state.preferences.count === 20 ? 'selected' : ''}>20 questions</option><option value="0" ${repo.state.preferences.count === 0 ? 'selected' : ''}>Toutes les questions</option></select><div class="course-actions"><button class="btn primary" data-action="start">Nouvelle séance</button><button class="btn secondary" data-action="difficult" ${n.difficult ? '' : 'disabled'}>Mes difficultés</button></div></article></section><p class="notice">Ce premier jeu est en cours d’amélioration. Tes retours servent à préciser les questions, les réponses et les indices.</p>`;
  }
  function practice() {
    const q = current(), session = repo.state.session, saved = S.currentFeedback(repo.state, q, questionSnapshot(q)), comment = saved && !saved.deleted ? saved.comment : '';
    const draft = repo.state.drafts[q.id]?.text || '';
    const rating = S.attemptsFor(repo.state, [q]).find(item => item.sessionId === session.id);
    return `<section class="question-shell"><div class="question-topline"><button class="btn ghost" data-action="home">← Accueil</button><span class="question-counter">Question ${session.index + 1} / ${session.ids.length}</span><button class="btn ghost" data-action="finish">Terminer</button></div><div class="progress-track" role="progressbar" aria-label="Position dans la séance" aria-valuemin="0" aria-valuemax="${session.ids.length}" aria-valuenow="${session.index + 1}"><div class="progress-fill" style="width:${100 * (session.index + 1) / session.ids.length}%"></div></div><article class="question-card"><p class="eyebrow">Français · Cours 01</p><h1 class="visually-hidden">Question ${session.index + 1}</h1><div class="question-content">${safeHtml(q.questionHtml)}</div>${q.hint ? `<details class="hint-panel" id="hint-panel"><summary>Un indice pour démarrer</summary><p>${esc(q.hint)}</p></details>` : ''}<details class="draft-panel" ${draft ? 'open' : ''}><summary>Écrire ma réponse</summary><label class="visually-hidden" for="draft-answer">Ma réponse personnelle</label><textarea id="draft-answer" class="text-input" rows="4" maxlength="12000" placeholder="Quelques mots, un raisonnement, un exemple…">${esc(draft)}</textarea><p class="help-text">Facultatif. Tu peux aussi répondre à voix haute ou sur papier.</p></details>${revealed ? `<section class="answer-card"><h2 class="answer-title">Réponse proposée</h2><div class="question-content">${safeHtml(q.answerHtml)}</div></section><p class="field-label">Après comparaison, où en es-tu ?</p><div class="rating-row" aria-label="Évaluer ma réponse"><button class="btn ${rating?.grade === 0 ? 'primary' : 'secondary'}" data-grade="0" aria-pressed="${rating?.grade === 0}">À revoir</button><button class="btn ${rating?.grade === 1 ? 'primary' : 'secondary'}" data-grade="1" aria-pressed="${rating?.grade === 1}">Presque</button><button class="btn ${rating?.grade === 2 ? 'primary' : 'good'}" data-grade="2" aria-pressed="${rating?.grade === 2}">Acquis</button></div><p class="help-text">C’est ton autoévaluation ; ton texte n’est pas corrigé automatiquement.</p>` : '<button class="btn primary" data-action="reveal">Voir la réponse</button>'}</article><details class="feedback-panel" ${comment ? 'open' : ''}><summary>Un retour sur cette question${comment ? ' · enregistré' : ' ?'}</summary><p class="muted">Dis ce qui te gêne et, si tu peux, ce qui aiderait à mieux comprendre.</p><label class="field-label" for="feedback-category">Cela concerne…</label><select class="select-input" id="feedback-category">${categories.map(category => `<option ${saved?.category === category ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select><label class="field-label" for="feedback-comment">Ton commentaire</label><textarea class="feedback-textarea" id="feedback-comment" rows="4" maxlength="8000" placeholder="Ex. : le mot de la réponse est déjà dans la question ; je préférerais un exemple à analyser…">${esc(comment)}</textarea><p class="save-status" id="feedback-saved" aria-live="polite">${comment ? 'Retour enregistré sur cet appareil' : 'Enregistrement automatique sur cet appareil'}</p><p class="help-text">Les retours restent privés. Exporte-les depuis « Mes retours » pour les transmettre.</p></details><div class="question-navigation"><button class="btn secondary" data-action="previous" ${session.index ? '' : 'disabled'}>← Précédente</button><button class="btn primary" data-action="next">${session.index === session.ids.length - 1 ? 'Bilan de la séance' : 'Suivante →'}</button></div></section>`;
  }
  function filteredQuestions() {
    const progress = S.mastery(repo.state, questions), commented = new Set(latestComments().map(item => item.questionId));
    return questions.filter(q => (!search || (plain(q.questionHtml) + ' ' + plain(q.answerHtml)).toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))) && (filter === 'all' || (filter === 'difficult' && progress[q.id] && progress[q.id].grade < 2) || (filter === 'feedback' && commented.has(q.id))));
  }
  function questionRows() {
    const list = filteredQuestions(), progress = S.mastery(repo.state, questions);
    return `<p class="muted small">${list.length} question${list.length > 1 ? 's' : ''}</p><div class="question-list">${list.map(q => `<button class="question-list-item" data-open="${esc(q.id)}"><span>${esc(plain(q.questionHtml))}</span><span class="tag">${progress[q.id] ? ['À revoir', 'Presque', 'Acquis'][progress[q.id].grade] : 'À découvrir'}</span></button>`).join('') || '<p class="empty-state">Aucune question ne correspond à ce filtre.</p>'}</div>`;
  }
  function browse() {
    return `<div class="section-heading"><div><p class="eyebrow">Français · Cours 01</p><h1>Toutes les questions</h1></div></div><div class="toolbar"><label class="visually-hidden" for="search">Rechercher une question</label><input type="search" class="search-input" id="search" placeholder="Rechercher une notion ou un exemple" value="${esc(search)}"><label class="visually-hidden" for="filter">Filtrer les questions</label><select class="select-input" id="filter"><option value="all" ${filter === 'all' ? 'selected' : ''}>Toutes</option><option value="difficult" ${filter === 'difficult' ? 'selected' : ''}>À retravailler</option><option value="feedback" ${filter === 'feedback' ? 'selected' : ''}>Avec un retour</option></select></div><div id="question-rows">${questionRows()}</div>`;
  }
  function feedback() {
    const items = latestComments().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return `<div class="section-heading"><div><p class="eyebrow">Améliorer ensemble</p><h1>Mes retours <span class="badge">${items.length}</span></h1></div></div><p class="muted">Chaque commentaire garde la question, la réponse et l’indice tels que tu les as vus. Tu peux copier le rapport ici dans notre discussion pour préparer les corrections.</p><div class="actions"><button class="btn primary" data-action="copy-feedback" ${items.length ? '' : 'disabled'}>Copier les retours</button><button class="btn secondary" data-action="export-feedback" ${items.length ? '' : 'disabled'}>Télécharger les retours</button></div><div class="feedback-list">${items.map(item => `<article class="feedback-item"><div class="feedback-item-header"><span class="pill">${esc(item.category)}</span><span class="muted small">${esc(new Date(item.updatedAt).toLocaleDateString('fr-CH'))}</span></div><h2>${esc(item.snapshot.question)}</h2><p style="white-space:pre-wrap">${esc(item.comment)}</p>${byId.has(item.questionId) ? `<button class="btn ghost" data-open="${esc(item.questionId)}">Revoir la question actuelle →</button>` : '<p class="help-text">Cette question n’est plus dans le jeu actuel. Son retour est conservé.</p>'}</article>`).join('') || '<div class="empty-state"><h2>Un détail à améliorer ?</h2><p>Ouvre « Un retour sur cette question ? » pendant une séance. Tu retrouveras tes commentaires ici.</p><button class="btn secondary" data-action="browse">Parcourir les questions</button></div>'}</div>`;
  }
  function settings() {
    return `<p class="eyebrow">Tes données</p><h1>Sauvegardes</h1><section class="settings-card"><h2>Sur cet appareil</h2><p>Les réponses personnelles, les autoévaluations et les commentaires s’enregistrent dans ce navigateur. Une sauvegarde téléchargée permet de les conserver ou de les réunir avec celles d’un autre appareil.</p><div class="actions"><button class="btn primary" data-action="backup">Télécharger une sauvegarde</button><button class="btn secondary" data-action="import">Importer une sauvegarde</button><input id="import-file" type="file" accept="application/json,.json" hidden></div><p class="help-text">L’import réunit les données ; il ne remplace pas tes retours existants. Un navigateur privé ou l’effacement des données du site supprime sa sauvegarde locale.</p></section><section class="settings-card"><h2>Google Drive, si tu le souhaites</h2><p>Retrouve tes retours et ta progression entre tes appareils en les connectant au même compte Google. Un dossier « Révisions HEP » distinct du quiz de français reçoit les sauvegardes.</p><div class="actions">${HEPDrive.connected() ? '<button class="btn primary" data-action="sync">Synchroniser maintenant</button><button class="btn ghost" data-action="disconnect">Déconnecter</button>' : '<button class="btn primary" data-action="connect">Connecter Google Drive</button>'}</div><p class="save-status" data-save-status>${esc(HEPDrive.status())}</p><p class="help-text">La connexion Google est à renouveler après fermeture. Les commentaires ne sont pas envoyés automatiquement à un agent ou à GitHub.</p></section><section class="settings-card"><h2>À propos de ce premier jeu</h2><p>Les questions proviennent du lot de révision FRA 01 existant. Le site permet de le tester et de préciser les corrections avant de refaire le contenu.</p><p class="small muted">Révisions HEP · ${esc(CONFIG.APP_VERSION)}</p></section>`;
  }
  function summaryView() {
    const a = summary || { count: 0, reviewed: 0, grades: [0, 0, 0] };
    return `<section class="review-summary"><p class="eyebrow">Séance terminée</p><h1>Un pas de plus.</h1><p class="hero-description">Tu as évalué ${a.reviewed} question${a.reviewed > 1 ? 's' : ''} sur ${a.count}. Tes retours et tes réponses personnelles sont conservés.</p><div class="stats-grid"><div class="stat"><span class="stat-number">${a.grades[0]}</span><span class="stat-label">à revoir</span></div><div class="stat"><span class="stat-number">${a.grades[1]}</span><span class="stat-label">presque</span></div><div class="stat"><span class="stat-number">${a.grades[2]}</span><span class="stat-label">acquises</span></div></div><div class="actions"><button class="btn primary" data-action="home">Retour à l’accueil</button><button class="btn secondary" data-action="feedback">Relire mes retours</button></div></section>`;
  }
  function navigate(name) { view = name; render(true); }
  function start(mode = 'all', ids) {
    let list = ids || questions.filter(q => mode !== 'difficult' || (S.mastery(repo.state, questions)[q.id]?.grade < 2)).map(q => q.id);
    if (!ids) {
      list = [...list];
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      if (repo.state.preferences.count) list = list.slice(0, repo.state.preferences.count);
    }
    if (!list.length) { toast('Aucune question à retravailler pour le moment.'); return; }
    repo.setSession({ id: S.uuid(), ids: list, index: 0, mode, startedAt: new Date().toISOString() });
    revealed = false; hintUsed = false; changed(); navigate('practice');
  }
  function finish() {
    const session = repo.state.session;
    if (!session) return navigate('home');
    const attempts = S.attemptsFor(repo.state, questions).filter(a => a.sessionId === session.id);
    summary = { count: session.ids.length, reviewed: attempts.length, grades: [0, 1, 2].map(grade => attempts.filter(a => a.grade === grade).length) };
    repo.setSession(null); changed(); navigate('summary');
  }
  function move(delta) {
    const session = repo.state.session;
    if (session.index + delta >= session.ids.length) return finish();
    session.index = Math.max(0, session.index + delta); repo.setSession(session);
    revealed = false; hintUsed = false; changed(); render(true);
  }
  function download(filename, value, mime = 'application/json') {
    const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: mime + ';charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  function feedbackText() {
    const bundle = S.feedbackBundle(repo.state, bank);
    return '# Retours Révisions HEP\n\n' + bundle.feedback.map((item, i) => `## ${i + 1}. ${item.category}\n\nQuestion : ${item.snapshot.question}\n\nRéponse : ${item.snapshot.answer}\n\nIndice : ${item.snapshot.hint || '(aucun)'}\n\nMon retour : ${item.comment}\n\nRéférence : ${item.questionId} · révision ${item.contentRevision}\n`).join('\n');
  }
  function saveComment() {
    const q = current(), field = document.getElementById('feedback-comment');
    if (!q || !field) return;
    repo.comment(q, document.getElementById('feedback-category').value, field.value, questionSnapshot(q));
    changed();
  }
  function bind() {
    document.getElementById('session-count')?.addEventListener('change', event => { repo.state.preferences.count = Number(event.target.value); repo.save(); changed(); });
    document.getElementById('hint-panel')?.addEventListener('toggle', event => { if (event.target.open) hintUsed = true; });
    document.getElementById('draft-answer')?.addEventListener('input', event => { repo.state.drafts[current().id] = { text: event.target.value, updatedAt: new Date().toISOString() }; repo.save(); changed(); });
    document.getElementById('feedback-comment')?.addEventListener('input', saveComment);
    document.getElementById('feedback-category')?.addEventListener('change', saveComment);
    document.getElementById('search')?.addEventListener('input', event => { search = event.target.value; document.getElementById('question-rows').innerHTML = questionRows(); });
    document.getElementById('filter')?.addEventListener('change', event => { filter = event.target.value; document.getElementById('question-rows').innerHTML = questionRows(); });
    document.getElementById('import-file')?.addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 25 * 1024 * 1024) throw new Error('Ce fichier est trop volumineux.');
        repo.import(JSON.parse(await file.text())); changed(); render(); toast('Sauvegarde réunie avec tes données.');
      } catch (error) { toast(error.message || 'Cette sauvegarde ne peut pas être importée.'); }
    });
  }
  app.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || button.disabled || !bank) return;
    if (button.dataset.open) { start('browse', [button.dataset.open]); return; }
    if (button.dataset.grade !== undefined) {
      if (!revealed || !current()) return;
      repo.grade(current(), Number(button.dataset.grade), repo.state.session.id, hintUsed); changed(); render(); return;
    }
    const action = button.dataset.action;
    if (['home', 'browse', 'feedback', 'settings'].includes(action)) return navigate(action);
    if (action === 'resume') { revealed = false; hintUsed = false; return navigate('practice'); }
    if (action === 'start') return start();
    if (action === 'difficult') return start('difficult');
    if (action === 'reveal') { revealed = true; render(); return; }
    if (action === 'next') return move(1);
    if (action === 'previous') return move(-1);
    if (action === 'finish') return finish();
    if (action === 'backup') { download('revisions-hep-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json', repo.state); return; }
    if (action === 'import') return document.getElementById('import-file').click();
    if (action === 'export-feedback') { download('revisions-hep-retours.json', S.feedbackBundle(repo.state, bank)); return; }
    if (action === 'copy-feedback') {
      try { await navigator.clipboard.writeText(feedbackText()); toast('Retours copiés. Tu peux les coller dans notre discussion.'); }
      catch (_) { download('revisions-hep-retours.md', feedbackText(), 'text/markdown'); toast('Rapport téléchargé.'); }
      return;
    }
    if (action === 'disconnect') { HEPDrive.disconnect(); render(); return; }
    if (action === 'connect' || action === 'sync') {
      button.disabled = true;
      try { if (action === 'connect') await HEPDrive.connect(); else await HEPDrive.sync(); render(); }
      catch (error) { toast(error.message); button.disabled = false; }
    }
  });
  window.addEventListener('storage', event => {
    if (event.key !== S.KEY || !event.newValue) return;
    try { repo.ingest(JSON.parse(event.newValue)); status(); } catch (_) { toast('Une sauvegarde d’un autre onglet est illisible.'); }
  });
  async function init() {
    try {
      const response = await fetch('data/questions.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('La banque de questions ne peut pas être chargée.');
      bank = await response.json();
      if (bank.schemaVersion !== 1 || !Array.isArray(bank.questions) || !bank.questions.length) throw new Error('La banque de questions est incompatible.');
      questions = bank.questions; byId = new Map(questions.map(q => [q.id, q]));
      if (repo.state.session && repo.state.session.ids.some(id => !byId.has(id))) {
        const session = repo.state.session, id = session.ids[session.index]; session.ids = session.ids.filter(id => byId.has(id));
        session.index = Math.max(0, session.ids.indexOf(id)); repo.setSession(session.ids.length ? session : null);
      }
      HEPDrive.init(repo, status, () => { if (view !== 'practice') render(); });
      repo.save(); render();
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    } catch (error) {
      app.innerHTML = `<div class="page"><section class="empty-state"><h1>Les questions n’ont pas pu s’ouvrir.</h1><p>${esc(error.message)}</p><p>Reconnecte-toi puis recharge la page. Les données déjà enregistrées restent dans ce navigateur.</p><button class="btn primary" id="reload">Réessayer</button></section></div>`;
      document.getElementById('reload').onclick = () => location.reload();
    }
  }
  init();
}());
