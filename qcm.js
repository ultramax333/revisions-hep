(function () {
  'use strict';
  const collection = window.QCM_COLLECTION || {};
  const IS_ORAL = collection.id === 'fra-qcm-oral', oralNavigation = window.HEPOralNavigation;
  let search = '';
  const expandedThemes = new Set();
  const S = HEPStore, KEY = collection.storageKey || 'hep-revisions-qcm-state-v1', SCOPE = collection.id || 'fra-qcm-pilote';
  const repo = new S.Repository({ getItem: () => localStorage.getItem(KEY), setItem: (_, value) => localStorage.setItem(KEY, value) });
  const app = document.getElementById('app');
  let bank, byId, active = null, view = 'home', displayedRun = null, activeCourse = null;
  const courseCursorKey = 'hep-revisions-qcm-course-position-v1::' + SCOPE;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = value => `<span class="exercise-text">${esc(value)}</span>`;
  const comments = () => S.feedbackThreads(repo.state).filter(item => !item.deleted && item.comment.trim());
  const runKey = q => 'qcm2::' + q.id + '::' + q.qcmRevision;
  const legacyRunKey = q => 'qcm::' + q.id + '::' + q.qcmRevision;
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
    let raw; try { raw = JSON.parse(repo.state.drafts[runKey(q)]?.text || repo.state.drafts[legacyRunKey(q)]?.text || 'null'); } catch (_) { raw = null; }
    const run = { id: typeof raw?.id === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(raw.id) ? raw.id : S.uuid(), answers: {}, order: {}, revealed: {}, index: 0, checked: false, hintUsed: !!raw?.hintUsed, contextUsed: !!raw?.contextUsed };
    for (const step of q.steps) {
      const ids = step.choices.map(c => c.id), order = raw?.order?.[step.id];
      run.order[step.id] = Array.isArray(order) && order.length === 4 && new Set(order).size === 4 && order.every(id => ids.includes(id)) ? order : shuffled(ids);
      if (ids.includes(raw?.answers?.[step.id])) {
        run.answers[step.id] = raw.answers[step.id];
        if (raw?.revealed?.[step.id] === true || (!raw?.revealed && raw?.checked === true)) run.revealed[step.id] = true;
      }
    }
    run.checked = q.steps.every(step => run.revealed[step.id]);
    const firstPending = q.steps.findIndex(step => !run.revealed[step.id]);
    run.index = Number.isInteger(raw?.index) ? Math.min(Math.max(0, raw.index), q.steps.length - 1) : firstPending < 0 ? q.steps.length - 1 : firstPending;
    if (!repo.state.drafts[runKey(q)] || JSON.stringify(raw) !== JSON.stringify(run)) writeRun(q, run);
    return run;
  }
  const sameRun = (left, right) => left && right && left.id === right.id && left.index === right.index && S.stable(left.revealed) === S.stable(right.revealed) && S.stable(left.order) === S.stable(right.order);
  function ingestLocal() {
    try { const saved = localStorage.getItem(KEY); if (saved) repo.ingest(JSON.parse(saved)); } catch (_) { /* Repository.save reports unavailable storage. */ }
  }
  function refreshRunControls() {
    if (view !== 'exercise' || !active || !displayedRun) return;
    const current = readRun(active);
    if (!sameRun(current, displayedRun)) { toast('Cet essai a changé ailleurs. Une nouvelle action l’actualisera ; tes retours précédents restent conservés.'); return; }
    document.querySelectorAll('[data-choice]').forEach(button => { button.setAttribute('aria-pressed', String(current.answers[button.dataset.step] === button.dataset.choice)); });
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
      hint: q.hints.join('\n\n') + '\n\nAvant la rédaction :\n' + bank.assessmentConditions.writingInstruction + '\n' + bank.assessmentConditions.learningInstruction };
  }
  function stepQuestion(q, step) { return { id: q.id + '::qcm::' + step.id, contentRevision: q.qcmRevision }; }
  const seenExplanationsKey = (q, step, run) => 'seen-explanations::' + q.id + '::' + q.qcmRevision + '::' + run.id + '::' + step.id;
  function rememberExplanations(q, step, run) {
    const key = seenExplanationsKey(q, step, run);
    // This monotone marker belongs to this run, even if another tab has moved on.
    // It never changes a choice, grade, navigation position or previous feedback.
    ingestLocal();
    if (repo.state.drafts[key]?.text === 'true') return;
    repo.state.drafts[key] = { text: 'true', updatedAt: new Date().toISOString() };
    repo.save(); changed();
  }
  function stepSnapshot(q, step, run) {
    const ids = run.order[step.id], selected = run.answers[step.id], revealed = !!run.revealed[step.id];
    const explanations = revealed ? ids.filter(id => id === step.correctId || id === selected || repo.state.drafts[seenExplanationsKey(q, step, run)]?.text === 'true' || document.querySelector('.qcm-verdict details')?.open).map(id => {
      const choice = step.choices.find(c => c.id === id);
      return String.fromCharCode(65 + ids.indexOf(id)) + '. ' + (id === step.correctId ? 'Bonne réponse. ' : '') + choice.explanation;
    }).join('\n\n') : '';
    return { module: q.module, course: q.course,
      question: q.title + '\n\n' + step.prompt + '\n\n' + ids.map((id, i) => String.fromCharCode(65 + i) + '. ' + step.choices.find(c => c.id === id).text).join('\n'),
      answer: 'Mon choix : ' + (selected ? String.fromCharCode(65 + ids.indexOf(selected)) + '. ' + step.choices.find(c => c.id === selected).text : 'aucun') + '\n\n' + (revealed ? explanations : 'Correction non affichée.'),
      hint: (run.contextUsed ? 'Situation consultée :\n' + q.context + '\n\nQuestion complète :\n' + q.prompt + '\n\n' + bank.assessmentConditions.writingInstruction + '\n' + bank.assessmentConditions.learningInstruction : '') + (run.hintUsed ? '\n\nRappel consulté :\n' + q.hints.join('\n\n') : '') };
  }
  function toast(message) {
    const node = document.getElementById('toast'); node.textContent = message; node.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 5000);
  }
  function header() {
    if (view === 'exercise' && active) {
      const run = readRun(active);
      const progress = coursePosition(active, run), counter = activeCourse ? `Cours ${activeCourse} · QCM ${progress.index + 1} / ${progress.queue.length}` : `QCM ${run.index + 1} / ${active.steps.length}`;
      return `<header class="qcm-focus-header"><button class="icon-button" data-action="home" aria-label="Exercices">←</button><span class="question-counter">${counter}</span><button class="btn secondary" data-action="open-context" aria-label="Voir la situation">Situation</button><button class="icon-button" data-action="open-hints" aria-label="Un rappel des concepts">?</button></header>`;
    }
    return `<header class="site-header"><button class="brand" data-action="home"><img class="brand-mark" src="icon.svg" alt=""><span><span class="brand-title">${esc(collection.label || 'Essai · QCM guidés')}</span><span class="brand-subtitle">Français · Bloc oral</span></span></button><nav class="header-actions" aria-label="Navigation des QCM"><button class="btn ghost" data-action="home">Exercices</button><button class="btn ghost" data-action="feedback">Mes retours <span class="badge" data-feedback-count>${comments().length}</span></button><button class="icon-button" data-action="settings" aria-label="Sauvegardes des QCM">↗</button></nav></header>`;
  }
  function home() {
    if (IS_ORAL) return oralHome();
    return `<section class="home-hero oral-home-hero"><h1 class="hero-title">Comprendre, puis rédiger</h1><p class="hero-description">D’abord, des QCM pour comprendre les notions et s’entraîner avec une correction expliquée. Ensuite, des exercices du même type pour préparer l’examen : à toi de rédiger ta réponse, sans choix proposés, puis de la comparer au corrigé.</p><p class="help-text">${esc(collection.description || 'Cette démo propose trois exercices de français. Tu peux passer à la rédaction quand tu veux.')}</p></section><section class="exercise-grid">${bank.exercises.map(q => {
      const run = readRun(q), score = q.steps.filter(s => run.answers[s.id] === s.correctId).length;
      return `<article class="course-card exercise-tile"><h2>${esc(q.title)}</h2><p class="help-text">${q.steps.length} QCM${run.checked ? ` · ${score} / ${q.steps.length} lors du dernier essai` : Object.keys(run.revealed).length ? ` · ${Object.keys(run.revealed).length} / ${q.steps.length} réponses` : ''}</p><div class="actions"><button class="btn primary" data-exercise="${q.id}">${Object.keys(run.answers).length ? 'Reprendre les QCM' : 'Essayer les QCM'}</button><a class="btn secondary" href="oral.html#${q.id}">Rédiger sans QCM</a></div></article>`;
    }).join('')}</section><p class="notice">Le résultat des QCM mesure la reconnaissance d’une réponse. La rédaction et sa justification restent à travailler séparément.</p><p class="help-text"><a href="oral.html">Retour au bloc oral</a></p>`;
  }
  // Parcours dérivés : chaque question conserve son exercice, sa révision et son essai.
  const courseKey = q => { const match = /^[CS](\d+)$/.exec(q.course || q.referenceId || ''); return match ? String(Number(match[1])) : null; };
  function courseQueue(key) {
    return bank.families.flatMap(family => bank.exercises.filter(q => q.familyId === family.id && courseKey(q) === key).flatMap(q => q.steps.map((step, index) => ({ q, step, index }))));
  }
  function coursePosition(q, run) {
    const queue = activeCourse ? courseQueue(activeCourse) : [];
    return { queue, index: queue.findIndex(item => item.q.id === q.id && item.step.id === q.steps[run.index].id) };
  }
  function readCourseCursors() {
    try { const value = JSON.parse(localStorage.getItem(courseCursorKey) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch (_) { return {}; }
  }
  function selectCourseEntry(item) {
    active = item.q;
    const run = readRun(active);
    if (run.index !== item.index) { run.index = item.index; writeRun(active, run); }
    const cursors = readCourseCursors();
    cursors[activeCourse] = { exerciseId: active.id, stepId: item.step.id, qcmRevision: active.qcmRevision };
    try { localStorage.setItem(courseCursorKey, JSON.stringify(cursors)); } catch (_) { toast('La position du cours ne peut pas être enregistrée sur cet appareil.'); }
  }
  function openCourse(key) {
    const queue = courseQueue(key); if (!queue.length) return false;
    activeCourse = key;
    const cursor = readCourseCursors()[key];
    const saved = queue.find(item => item.q.id === cursor?.exerciseId && item.step.id === cursor?.stepId && item.q.qcmRevision === cursor?.qcmRevision);
    const pending = saved || queue.find(item => !readRun(item.q).revealed[item.step.id]) || queue[queue.length - 1];
    selectCourseEntry(pending); return true;
  }
  function courseStats(queue) {
    return queue.reduce((stats, item) => { const run = readRun(item.q); if (run.revealed[item.step.id]) { stats.answered++; if (run.answers[item.step.id] === item.step.correctId) stats.score++; } return stats; }, { answered: 0, score: 0 });
  }
  function oralHome() {
    const query = oralNavigation.normalize(search);
    const courses = [...new Set(bank.exercises.map(courseKey).filter(Boolean))].map(key => {
      const queue = courseQueue(key), exercises = [...new Set(queue.map(item => item.q))];
      const dates = exercises.map(q => { const [d, m, y] = String(bank.courseReferences[q.course || q.referenceId]?.date || '').split('.'); return y && m && d ? `${y}${m}${d}` : '99999999'; }).sort();
      const label = `Cours ${key}`;
      const haystack = [label, `Cours${key}`, ...exercises.map(q => { const family = bank.families.find(f => f.id === q.familyId), ref = bank.courseReferences[q.course || q.referenceId]; return [family?.title, family?.theme, q.title, q.prompt, ...q.hints, ...q.steps.map(s => s.prompt), ref?.date].join(' '); })].join(' ');
      return { key, label, queue, date: dates[0], match: !query || oralNavigation.normalize(haystack).includes(query) };
    }).filter(course => course.match).sort((a, b) => a.date.localeCompare(b.date) || Number(a.key) - Number(b.key));
    return `<section class="home-hero oral-home-hero qcm-notions-hero"><h1 class="hero-title">Comprendre, puis rédiger</h1><p class="hero-description">Choisis un cours pour parcourir toutes ses questions, puis entraîne-toi à rédiger sans les choix.</p></section>
      <form class="oral-tools qcm-home-filters" id="qcm-home-filters"><label class="oral-field" for="qcm-search">Rechercher un cours ou une notion<input class="text-input" id="qcm-search" type="search" value="${esc(search)}" placeholder="Ex. : Cours 1, étayage, récit…"></label><button class="btn secondary" type="submit">Rechercher</button>${search ? '<button class="btn ghost" type="button" data-action="clear-search">Tout afficher</button>' : ''}</form>
      <p class="help-text oral-result-count" id="qcm-home-results" role="status" tabindex="-1">${courses.length} cours · ${courses.reduce((n, course) => n + course.queue.length, 0)} QCM</p><section class="exercise-grid qcm-courses" aria-label="Parcours par cours">${courses.map(course => { const stats = courseStats(course.queue); return `<article class="course-card exercise-tile"><h2>${course.label}</h2><p class="help-text">${course.queue.length} QCM${stats.answered ? ` · ${stats.answered} réponse${stats.answered > 1 ? 's' : ''} enregistrée${stats.answered > 1 ? 's' : ''}` : ''}</p><button class="btn primary" data-course="${course.key}" aria-label="${stats.answered || readCourseCursors()[course.key] ? 'Reprendre' : 'Commencer'} ${course.label}">${stats.answered || readCourseCursors()[course.key] ? 'Reprendre' : 'Commencer'} ${course.label}</button></article>`; }).join('') || '<p class="empty-state">Aucun cours ne correspond à cette recherche.</p>'}</section>
      <p class="notice">Le résultat des QCM mesure la reconnaissance d’une réponse. La rédaction et sa justification restent à travailler séparément.</p><p class="help-text"><a href="oral.html">Accéder directement aux exercices rédigés du bloc oral →</a></p>`;
  }
  function stepView(q, step, index, run) {
    const selected = step.choices.find(c => c.id === run.answers[step.id]), correct = step.choices.find(c => c.id === step.correctId), revealed = !!run.revealed[step.id];
    return `<fieldset class="qcm-step" data-step="${step.id}"><legend>${esc(step.prompt)}</legend>${typeof q.context === 'string' && q.context.trim() ? '<button class="qcm-context-cue" data-action="open-context">Clique sur « Situation » pour lire le contexte.</button>' : ''}<div class="qcm-choices">${run.order[step.id].map((id, i) => { const c = step.choices.find(c => c.id === id); return `<button class="qcm-choice ${selected?.id === id ? 'qcm-selected' : ''} ${revealed && id === step.correctId ? 'qcm-correct' : revealed && id === selected?.id ? 'qcm-incorrect' : ''}" data-choice="${id}" data-step="${step.id}" aria-label="${revealed && id === step.correctId ? 'Bonne réponse : ' : ''}${String.fromCharCode(65 + i)}. ${esc(c.text)}" aria-pressed="${selected?.id === id}" ${revealed ? 'disabled' : ''}><span><strong>${String.fromCharCode(65 + i)}.</strong> ${esc(c.text)}</span></button>`; }).join('')}</div>${revealed ? `<div class="qcm-verdict" role="status" tabindex="-1"><strong>${selected.id === step.correctId ? 'Bonne réponse.' : 'À reprendre.'}</strong><p>${text(correct.explanation)}</p>${selected.id !== step.correctId ? `<p><strong>Ton choix :</strong> ${text(selected.explanation)}</p>` : ''}<details><summary>Comprendre les autres propositions</summary>${run.order[step.id].filter(id => id !== step.correctId && id !== selected.id).map(id => { const c = step.choices.find(c => c.id === id), letter = String.fromCharCode(65 + run.order[step.id].indexOf(id)); return `<p><strong>${letter}.</strong> ${text(c.explanation)}</p>`; }).join('')}</details></div>` : ''}</fieldset>`;
  }
  function supportDialogs(q, ref, source) {
    const head = title => `<div class="qcm-dialog-head"><h2>${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="Fermer">×</button></div>`;
    return `<dialog id="qcm-context-dialog" class="qcm-dialog" aria-labelledby="qcm-context-title">${head('<span id="qcm-context-title">La situation</span>')}<p class="exercise-origin">${esc(ref.label)} · ${esc(ref.date)}<br>Passage à relire : ${esc(source.location)}</p><div class="exercise-context">${text(q.context)}</div><h3>La question complète à préparer</h3><p>${text(q.prompt)}</p><h3>Avant de rédiger</h3><p class="help-text">${text(bank.assessmentConditions.writingInstruction)}</p><p class="help-text">${text(bank.assessmentConditions.learningInstruction)}</p></dialog><dialog id="qcm-hint-dialog" class="qcm-dialog" aria-labelledby="qcm-hint-title">${head('<span id="qcm-hint-title">Un rappel des concepts</span>')}${q.hints.map(h => `<p>${text(h)}</p>`).join('')}</dialog>`;
  }
  function exercise() {
    const q = active, run = readRun(q), snap = snapshot(q, run), saved = S.currentFeedback(repo.state, feedbackQuestion(q), snap);
    const categories = ['Consigne', ...q.steps.map((s, i) => 'QCM ' + (i + 1)), 'Aides', 'Passage à la rédaction', 'Autre'];
    const ref = bank.courseReference || bank.courseReferences[q.referenceId], source = q.sources.find(s => s.file.includes('SYNTHESE')) || q.sources[0], step = q.steps[run.index];
    const score = q.steps.filter(s => run.answers[s.id] === s.correctId && run.revealed[s.id]).length;
    const progress = coursePosition(q, run), index = activeCourse ? progress.index : run.index, total = activeCourse ? progress.queue.length : q.steps.length;
    const stats = activeCourse ? courseStats(progress.queue) : { answered: Object.keys(run.revealed).length, score };
    const finished = stats.answered === total;
    const summary = activeCourse ? `Les QCM du Cours ${activeCourse} sont terminés` : 'Les QCM de cet exercice sont terminés';
    return `<section class="question-shell"><article class="question-card"><h1 class="exercise-title">${esc(q.title)}</h1><p class="exercise-origin">${esc(ref.label)} · ${esc(ref.date)}</p>${stepView(q, step, run.index, run)}<button class="btn secondary qcm-report-button" data-action="report-step">Signaler un problème avec cette question</button><details class="feedback-panel" id="step-feedback" hidden><summary>Mon signalement sur cette question</summary>${HEPFeedback.fields()}<label class="field-label" for="step-feedback-category">Catégorie (facultative)</label><select class="select-input" id="step-feedback-category"><option value="">Sans catégorie</option><option>Question</option><option>Propositions</option><option>Correction</option><option>Autre</option></select><label class="field-label" for="step-feedback-comment">Mon commentaire</label><textarea class="feedback-textarea" id="step-feedback-comment" rows="4" maxlength="8000"></textarea><p class="help-text">Enregistré sur cet appareil avec la question et les contenus déjà consultés au moment de l’ouverture du signalement.</p><p class="save-status" data-save-status></p></details><div class="question-navigation">${index > 0 ? '<button class="btn secondary" data-action="previous">← QCM précédent</button>' : ''}${index + 1 < total ? `<button class="btn primary" data-action="next" ${run.revealed[step.id] ? '' : 'disabled'}>QCM suivant →</button>` : ''}</div>${index === total - 1 && finished ? `<section class="qcm-summary"><h2>${summary}</h2><p>${stats.score} réponse${stats.score > 1 ? 's' : ''} correcte${stats.score > 1 ? 's' : ''} sur ${total}. Tu peux maintenant construire ta propre réponse à la question complète.</p></section>` : ''}<div class="actions">${activeCourse ? (finished ? '<button class="btn secondary" data-action="course-first">Revoir le cours depuis le début</button>' : '') : run.checked ? '<button class="btn secondary" data-action="restart">Recommencer les QCM</button>' : ''}<a class="btn ${run.checked ? 'primary' : 'secondary'}" href="oral.html#${q.id}">Rédiger cet exercice sans QCM →</a></div></article><details class="feedback-panel" ${saved?.comment ? 'open' : ''}><summary>Mon retour sur cet essai</summary><label class="field-label" for="feedback-category">Cela concerne…</label><select class="select-input" id="feedback-category">${categories.map(c => `<option ${(saved?.category || 'QCM ' + (run.index + 1)) === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><label class="field-label" for="feedback-comment">Mon commentaire</label><textarea class="feedback-textarea" id="feedback-comment" rows="4" maxlength="8000" placeholder="Ex. : deux propositions me semblent justes ; la correction n’explique pas leur différence…">${esc(saved?.comment || '')}</textarea><p class="help-text">Ton retour conserve les propositions dans l’ordre affiché et leurs explications.</p><p class="save-status" data-save-status></p></details></section>${supportDialogs(q, ref, source)}`;
  }
  function feedback() {
    return `<h1>Mes retours sur les QCM</h1>${HEPFeedback.fields()}${HEPFeedback.archiveLink}<div class="actions"><button class="btn primary" data-action="copy" ${comments().length ? '' : 'disabled'}>Copier les retours</button><button class="btn secondary" data-action="export" ${comments().length ? '' : 'disabled'}>Télécharger les retours</button></div><div class="feedback-list">${comments().sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => `<article class="feedback-item"><span class="pill">${esc(item.category)}</span><h2>${esc(item.snapshot.question.split('\n')[0])}</h2><p class="exercise-text">${esc(item.comment)}</p><button class="btn ghost" data-exercise="${esc(item.questionId.split('::')[0])}">Revoir les QCM →</button></article>`).join('') || '<p class="empty-state">Tu peux laisser un retour dans chaque exercice.</p>'}</div><p class="help-text">Copie tes retours, puis envoie-les à Maxim par message. Aucun envoi automatique.</p>`;
  }
  function settings() {
    return `<h1>Sauvegardes des QCM</h1>${HEPFeedback.archiveLink}<section class="settings-card"><h2>Sur cet appareil</h2><p>Choix, résultats et retours sont conservés ici. Cet essai possède sa propre sauvegarde.</p><div class="actions"><button class="btn primary" data-action="backup">Télécharger une sauvegarde</button><button class="btn secondary" data-action="import">Importer une sauvegarde QCM</button><input id="backup-file" type="file" accept=".json,application/json" hidden></div></section><section class="settings-card"><h2>Google Drive, facultatif</h2><p>Dossier « ${esc(window.CONFIG.DRIVE_FOLDER)} ». La connexion est à renouveler après fermeture.</p><div class="actions">${HEPDrive.connected() ? '<button class="btn primary" data-action="sync">Synchroniser maintenant</button><button class="btn ghost" data-action="disconnect">Déconnecter</button>' : '<button class="btn primary" data-action="connect">Connecter Google Drive</button>'}</div><p data-save-status class="save-status"></p></section>`;
  }
  function render() {
    // Read only the unfiltered view: search results open temporarily, not by preference.
    document.querySelectorAll('details[data-qcm-theme][data-qcm-manual="true"]').forEach(node => {
      if (node.open) expandedThemes.add(node.dataset.qcmTheme); else expandedThemes.delete(node.dataset.qcmTheme);
    });
    app.innerHTML = `<div class="page ${view === 'exercise' ? 'qcm-focus' : ''}">${header()}<div id="qcm-main" tabindex="-1">${view === 'exercise' ? exercise() : view === 'feedback' ? feedback() : view === 'settings' ? settings() : home()}</div><footer class="footer"><span class="save-status" data-save-status></span>${view === 'exercise' ? '<button class="btn ghost small" data-action="feedback">Mes retours</button>' : ''}<a href="oral.html">Bloc oral</a></footer></div>`;
    status(); HEPFeedback.bind();
    document.getElementById('qcm-home-filters')?.addEventListener('submit', event => {
      event.preventDefault(); search = document.getElementById('qcm-search').value.trim(); render();
      document.getElementById('qcm-home-results').focus({ preventScroll: true });
    });
    if (view === 'exercise') {
      const q = active, run = readRun(q), snap = snapshot(q, run);
      displayedRun = run;
      const step = q.steps[run.index];
      document.querySelector('.qcm-verdict details')?.addEventListener('toggle', event => {
        if (event.target.open) rememberExplanations(q, step, run);
      });
      const saveComment = () => { repo.comment(feedbackQuestion(q), document.getElementById('feedback-category').value, document.getElementById('feedback-comment').value, snap); changed(); };
      document.getElementById('feedback-comment').addEventListener('input', saveComment);
      document.getElementById('feedback-category').addEventListener('change', saveComment);
    }
    document.getElementById('backup-file')?.addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 25 * 1024 * 1024) throw new Error('Ce fichier est trop volumineux.');
        const raw = JSON.parse(await file.text());
        if (raw.scope !== SCOPE) throw new Error('Choisis une sauvegarde de cette collection de QCM.');
        repo.import(raw); changed(); render(); toast('Sauvegarde QCM réunie avec tes données.');
      } catch (error) { toast(error.message); }
    });
  }
  function route() {
    let hash; try { hash = decodeURIComponent(location.hash.slice(1)); } catch (_) { hash = ''; }
    activeCourse = null; active = null;
    const course = IS_ORAL && /^cours-(\d+)$/.exec(hash);
    if (course) openCourse(String(Number(course[1])));
    else active = byId.get(hash) || null;
    view = active ? 'exercise' : ['feedback', 'settings'].includes(hash) ? hash : 'home';
    render(); document.getElementById('qcm-main').focus({ preventScroll: true }); window.scrollTo(0, 0);
  }
  function navigate(target) { if (location.hash.slice(1) === target) route(); else location.hash = target; }
  function download(name, value, mime = 'application/json') {
    const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: mime + ';charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  app.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || button.disabled || !bank) return;
    if (button.dataset.course) return navigate('cours-' + button.dataset.course);
    if (button.dataset.exercise) return navigate(button.dataset.exercise);
    const action = button.dataset.action;
    if (action === 'clear-search') { search = ''; render(); document.getElementById('qcm-search').focus({ preventScroll: true }); return; }
    if (['home', 'feedback', 'settings'].includes(action)) return navigate(action === 'home' ? '' : action);

    if (action === 'report-step' && active) {
      const q = active, run = displayedRun, step = q.steps[run.index], panel = document.getElementById('step-feedback');
      if (!panel.hidden) { panel.open = true; document.getElementById('step-feedback-comment').focus(); return; }
      const snap = stepSnapshot(q, step, run), question = stepQuestion(q, step), saved = S.currentFeedback(repo.state, question, snap);
      panel.hidden = false; panel.open = true;
      const field = document.getElementById('step-feedback-comment'), category = document.getElementById('step-feedback-category');
      field.value = saved?.comment || ''; category.value = saved?.category === 'autre' ? '' : saved?.category || '';
      const save = () => { repo.comment(question, category.value, field.value, snap); changed(); };
      field.addEventListener('input', save); category.addEventListener('change', save); field.focus(); return;
    }
    if (action === 'close-dialog') { button.closest('dialog')?.close(); return; }
    if (action === 'open-context' && active) { const q = active; return mutateRun(q, displayedRun, run => { run.contextUsed = true; return run; }, run => { displayedRun = run; document.getElementById('qcm-context-dialog').showModal(); }); }
    if (action === 'open-hints' && active) {
      const q = active;
      return mutateRun(q, displayedRun, run => { run.hintUsed = true; return run; }, run => { displayedRun = run; if (view === 'exercise' && active?.id === q.id) document.getElementById('qcm-hint-dialog').showModal(); });
    }
    if (button.dataset.choice && active) {
      const q = active, expected = displayedRun, step = q.steps[expected.index], choice = button.dataset.choice;
      if (button.dataset.step !== step.id || !step.choices.some(c => c.id === choice)) return;
      return mutateRun(q, expected, run => {
        run.answers[step.id] = choice; run.revealed[step.id] = true;
        run.checked = q.steps.every(s => run.revealed[s.id]); return run;
      }, run => {
        repo.grade({ id: q.id + '::' + step.id, contentRevision: q.qcmRevision }, choice === step.correctId ? 2 : 0, run.id, run.hintUsed);
        changed();
        if (view === 'exercise' && active?.id === q.id) { render(); const verdict = document.querySelector('.qcm-verdict'); verdict.focus({ preventScroll: true }); verdict.scrollIntoView({ block: 'nearest' }); }
      });
    }
    if (action === 'course-first' && activeCourse) { selectCourseEntry(courseQueue(activeCourse)[0]); render(); document.getElementById('qcm-main').focus(); return; }
    if (['next', 'previous'].includes(action) && active) {
      const q = active;
      if (activeCourse) {
        const progress = coursePosition(q, displayedRun), target = progress.queue[progress.index + (action === 'next' ? 1 : -1)];
        if (!target || (action === 'next' && !displayedRun.revealed[q.steps[displayedRun.index].id])) return;
        return mutateRun(q, displayedRun, run => run, () => { selectCourseEntry(target); render(); const field = document.querySelector('.qcm-step'); field.setAttribute('tabindex', '-1'); field.focus({ preventScroll: true }); field.scrollIntoView({ block: 'start' }); });
      }
      return mutateRun(q, displayedRun, run => {
        if (action === 'next' && run.revealed[q.steps[run.index].id]) run.index = Math.min(q.steps.length - 1, run.index + 1);
        if (action === 'previous') run.index = Math.max(0, run.index - 1);
        return run;
      }, () => { if (view === 'exercise' && active?.id === q.id) { render(); const field = document.querySelector('.qcm-step'); field.setAttribute('tabindex', '-1'); field.focus({ preventScroll: true }); field.scrollIntoView({ block: 'start' }); } });
    }
    if (action === 'restart' && active) {
      const q = active;
      return mutateRun(q, displayedRun, () => ({ id: S.uuid(), answers: {}, order: Object.fromEntries(q.steps.map(s => [s.id, shuffled(s.choices.map(c => c.id))])), revealed: {}, index: 0, checked: false, hintUsed: false }), () => { if (view === 'exercise' && active?.id === q.id) { render(); document.querySelector('.qcm-step').scrollIntoView(); } });
    }
    if (action === 'backup') return download('FRA-QCM-sauvegarde.json', { ...repo.state, scope: SCOPE });
    if (action === 'import') return document.getElementById('backup-file').click();
    if (action === 'export') return download('FRA-QCM-retours.json', { ...S.feedbackBundle(repo.state, bank), scope: SCOPE });
    if (action === 'copy') {
      const report = HEPFeedback.report('Retours sur les QCM FRA', comments());
      try { await navigator.clipboard.writeText(report); toast('Retours copiés.'); } catch (_) { download('FRA-QCM-retours.md', report, 'text/markdown'); } return;
    }
    if (action === 'disconnect') { HEPDrive.disconnect(); render(); return; }
    if (['connect', 'sync'].includes(action)) { button.disabled = true; try { if (action === 'connect') await HEPDrive.connect(); else await HEPDrive.sync(); render(); } catch (error) { button.disabled = false; toast(error.message); } }
  });
  window.addEventListener('hashchange', () => { if (bank) route(); });
  window.addEventListener('storage', event => { if (event.key === KEY && event.newValue) { try { repo.ingest(JSON.parse(event.newValue)); status(); refreshRunControls(); } catch (_) { toast('La sauvegarde d’un autre onglet est illisible.'); } } });
  (async () => {
    try {
      if (IS_ORAL && !oralNavigation) throw new Error('Les thèmes du bloc oral sont indisponibles. Recharge la page en ligne.');
      const response = await fetch(collection.bank || 'data/qcm-pilote.json', { cache: 'no-cache' }); if (!response.ok) throw new Error('La banque QCM est indisponible.');
      bank = await response.json(); if (bank.id !== SCOPE || bank.schemaVersion !== 1 || !bank.exercises?.length || (SCOPE === 'fra-qcm-pilote' && bank.exercises.length !== 3)) throw new Error('Format QCM incompatible.');
      byId = new Map(bank.exercises.map(q => [q.id, q]));
      HEPDrive.init(repo, status, () => { if (view !== 'exercise') render(); else refreshRunControls(); }); repo.save(); route();
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    } catch (error) { bank = null; app.innerHTML = `<section class="empty-state"><h1>Les QCM n’ont pas pu s’ouvrir.</h1><p>${esc(error.message)}</p><p>Reconnecte-toi puis recharge la page. Tes données restent dans ce navigateur.</p><a href="oral.html">Retour au bloc oral</a></section>`; }
  })();
}());
