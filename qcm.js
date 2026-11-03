(function () {
  'use strict';
  const collection = window.QCM_COLLECTION || {};
  const IS_ORAL = collection.id === 'fra-qcm-oral', GROUPED_COURSES = ['fra-qcm-oral', 'cla-qcm-s1', 'dev-qcm-uf1', 'shs-qcm-s1'].includes(collection.id), oralNavigation = window.HEPOralNavigation;
  const canWrite = q => q.hasWrittenExercise === true || (q.hasWrittenExercise === undefined && IS_ORAL);
  const writingHome = collection.hasWriting === true || IS_ORAL;
  const exportPrefix = collection.exportPrefix || 'FRA-QCM';
  const referenceLabel = ref => IS_ORAL ? ref.label : [collection.subject, collection.block, ref.label].filter(Boolean).join(' · ');
  const hintText = q => q.hints.join('\n\n') + '\n\nPassages à relire :\n' + q.sources.map(source => source.file + ' — ' + source.location).join('\n');
  let search = '';
  const expandedThemes = new Set();
  const S = HEPStore, KEY = collection.storageKey || 'hep-revisions-qcm-state-v1', SCOPE = collection.id || 'fra-qcm-pilote';
  const repo = new S.Repository({ getItem: () => localStorage.getItem(KEY), setItem: (_, value) => localStorage.setItem(KEY, value) });
  const app = document.getElementById('app');
  let bank, byId, active = null, view = 'home', displayedRun = null, activeCourse = null, activeMix = null, stepFeedback = null;
  const quickSeen = new Map();
  let withoutChoices = false, scIndex = 0, displayedSC = null, displayedSCNavigation = '', scPending = Promise.resolve();
  const scStore = window.HEPSansChoixStore?.create({ repo, scope: SCOPE, ingest: ingestLocal, changed, store: S });
  const visibleRun = q => withoutChoices ? { index: scIndex, id: 'sans-choix::' + q.id + '::' + q.qcmRevision + '::' + q.steps[scIndex].id } : readRun(q);
  const stepDone = item => withoutChoices ? !!scStore.read(item.q, item.step).selfEvaluation : !!readRun(item.q).revealed[item.step.id];
  const questionLabel = () => withoutChoices ? 'questions sans les choix' : 'QCM';
  function modeControls() {
    if (!GROUPED_COURSES) return '';
    return `<div class="qcm-mode-switch" role="group" aria-label="Mode de révision"><button class="btn ${withoutChoices ? 'secondary' : 'primary'}" data-action="mode-qcm" aria-pressed="${!withoutChoices}">QCM</button><button class="btn ${withoutChoices ? 'primary' : 'secondary'}" data-action="mode-sc" aria-pressed="${withoutChoices}">Sans les choix</button></div>`;
  }
  let levelsEnabled = false, levelFilter = 'essentiel', ancientOnly = false, emptyPathMessage = '';
  const runCache = new Map(), mixExpansionCache = new Map();
  const mixKey = 'hep-revisions-qcm-mixed-position-v1::' + SCOPE;
  const courseCursorKey = 'hep-revisions-qcm-course-position-v1::' + SCOPE;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const text = value => `<span class="exercise-text">${esc(value)}</span>`;
  const needsContext = step => step?.requiresContext === true;
  const comments = () => S.feedbackThreads(repo.state).filter(item => !item.deleted && item.comment.trim());
  const runKey = q => 'qcm2::' + q.id + '::' + q.qcmRevision;
  const legacyRunKey = q => 'qcm::' + q.id + '::' + q.qcmRevision;
  const feedbackQuestion = q => ({ id: q.id + '::qcm', contentRevision: q.qcmRevision });
  function status() {
    document.querySelectorAll('[data-save-status]').forEach(node => { node.textContent = repo.warning || HEPDrive.status(); });
    document.querySelectorAll('[data-feedback-count]').forEach(node => { node.textContent = comments().length; });
    updatePanelDrive();
  }
  function changed() { status(); HEPDrive.schedule(); }
  function updatePanelDrive() {
    const button = document.querySelector('[data-action="panel-drive"]');
    if (button && button.dataset.busy !== 'true') {
      button.disabled = false;
      button.textContent = HEPDrive.connected() ? 'Synchroniser Drive ici' : 'Connecter Drive ici';
    }
  }
  function bindStepSend(question, snap, field, category, panel, saveDraft) {
    const button = panel.querySelector('[data-action="send-step"]'), message = panel.querySelector('[data-send-status]'), nameField = document.getElementById('feedback-first-name');
    const binding = { sending: false, sequence: 0, timer: null };
    const current = () => ({ collection: SCOPE, firstName: nameField?.value || '', feedback: { questionId: question.id, contentRevision: question.contentRevision, category: category.value || 'autre', comment: field.value, snapshot: snap } });
    const attached = () => panel.isConnected && stepFeedback === binding;
    binding.refresh = async override => {
      const sequence = ++binding.sequence; clearTimeout(binding.timer);
      if (!attached() || binding.sending) return;
      if (!field.value.trim()) { button.disabled = true; button.textContent = 'Envoyer à Maxim'; message.textContent = 'Brouillon : écris ton commentaire avant de l’envoyer.'; return; }
      try {
        if (!window.HEPFeedbackSend) throw new Error('L’envoi à Maxim n’est pas encore disponible. Ton brouillon est conservé.');
        const state = await HEPFeedbackSend.inspect(current());
        if (!attached() || sequence !== binding.sequence || binding.sending) return;
        const wait = Math.max(0, Math.ceil((state.retryAt - Date.now()) / 1000));
        button.disabled = state.sent || state.sending || wait > 0;
        button.textContent = state.sent ? 'Envoyé' : state.sending ? 'Envoi en cours…' : state.pending ? 'Réessayer l’envoi' : 'Envoyer à Maxim';
        message.textContent = state.sent ? 'Envoi reçu.' : override || (wait ? 'Réessaie dans ' + wait + ' secondes. Ton brouillon est conservé.' : state.pending ? 'Envoi non confirmé. Ton brouillon est conservé ; tu peux réessayer.' : 'Brouillon enregistré sur cet appareil. Prêt à envoyer à Maxim.');
        if (wait) binding.timer = setTimeout(() => binding.refresh(), Math.min(wait * 1000, 1000));
      } catch (error) { if (attached() && sequence === binding.sequence && !binding.sending) { button.disabled = false; button.textContent = 'Envoyer à Maxim'; message.textContent = error.message; } }
    };
    binding.send = async () => {
      if (binding.sending || !field.value.trim()) return;
      saveDraft();
      if (repo.warning) { message.textContent = 'Le brouillon n’a pas pu être sauvegardé. Télécharge une sauvegarde avant de l’envoyer.'; return; }
      const input = current(), sentContent = JSON.stringify(input);
      binding.sending = true; button.disabled = true; button.textContent = 'Envoi en cours…'; button.setAttribute('aria-busy', 'true'); message.textContent = 'Envoi à Maxim en cours…';
      let nextMessage;
      try {
        await HEPFeedbackSend.send(input);
        if (JSON.stringify(current()) !== sentContent) nextMessage = 'Le retour envoyé a été reçu. Tes modifications restent à envoyer.';
      } catch (error) { nextMessage = JSON.stringify(current()) === sentContent ? error.message : 'Le précédent envoi n’est pas confirmé. Tes modifications restent en brouillon.'; }
      finally { binding.sending = false; button.removeAttribute('aria-busy'); if (attached()) binding.refresh(nextMessage); }
    };
    nameField?.addEventListener('input', () => binding.refresh());
    stepFeedback = binding; binding.refresh(); return binding;
  }
  const levelStorageKey = name => (withoutChoices ? 'sc-level-' : 'qcm-level-') + name + '::' + SCOPE + '::' + levelFilter + (ancientOnly ? '::anciens' : '');
  const selectedLevelKey = () => (withoutChoices ? 'sc-selected-level::' : 'qcm-selected-level::') + SCOPE;
  const selectedAncientKey = () => (withoutChoices ? 'sc-selected-ancient::' : 'qcm-selected-ancient::') + SCOPE;
  function restoreAncientChoice() {
    try { ancientOnly = JSON.parse(repo.state.drafts[selectedAncientKey()]?.text || 'false') === true; } catch (_) { ancientOnly = false; }
  }
  const ancientBadge = step => step.ancienExamen ? '<span class="pill">Ancien examen</span>' : '';
  const snapshotPrompt = step => (step.ancienExamen ? 'Ancien examen\n\n' : '') + step.prompt;
  const emptySelection = () => ancientOnly ? 'Aucune question d’ancien examen ne correspond à ce cours ou mélange, au niveau et au mode choisis. Désactive Anciens examens, choisis Tout ou le mode QCM.' : 'Aucune question disponible pour ce parcours. Choisis Tout ou le mode QCM.';
  function writeNavigation(key, value) {
    ingestLocal();
    const previous = repo.state.drafts[key];
    repo.state.drafts[key] = { text: JSON.stringify(value), updatedAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString() };
    repo.save(); changed();
  }
  function restoreLevelChoice() {
    let saved; try { saved = JSON.parse(repo.state.drafts[selectedLevelKey()]?.text || 'null'); } catch (_) { saved = null; }
    levelFilter = saved === 'tout' ? 'tout' : 'essentiel';
  }
  const stepEligible = step => (!ancientOnly || !!step.ancienExamen) && (!withoutChoices || step.sansChoix === true) && (!levelsEnabled || levelFilter === 'tout' || step.level === 'essentiel');
  const exerciseEntries = q => q.steps.map((step, index) => ({ q, step, index })).filter(item => stepEligible(item.step));
  function levelControls() {
    if (!GROUPED_COURSES) return '';
    return `<div class="qcm-mode-switch" role="group" aria-label="Filtres du parcours">${levelsEnabled ? `<button type="button" class="btn secondary" data-level-filter="essentiel" aria-pressed="${levelFilter === 'essentiel'}">Essentiel</button><button type="button" class="btn secondary" data-level-filter="tout" aria-pressed="${levelFilter === 'tout'}">Tout</button>` : ''}<button type="button" class="btn ${ancientOnly ? 'primary' : 'secondary'}" data-action="ancient-filter" aria-pressed="${ancientOnly}">Anciens examens</button></div>`;
  }
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
    const key = runKey(q), source = repo.state.drafts[key]?.text || repo.state.drafts[legacyRunKey(q)]?.text || 'null';
    const cached = runCache.get(key);
    if (cached?.source === source) return JSON.parse(JSON.stringify(cached.run));
    let raw; try { raw = JSON.parse(source); } catch (_) { raw = null; }
    const run = { id: typeof raw?.id === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(raw.id) ? raw.id : S.uuid(), answers: {}, order: {}, revealed: {}, index: 0, checked: false, hintUsed: !!raw?.hintUsed, contextUsed: !!raw?.contextUsed };
    if (typeof raw?.restartOf === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(raw.restartOf) && raw.restartOf !== run.id) run.restartOf = raw.restartOf;
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
    // Reading statistics must never create or refresh a persisted attempt.
    runCache.set(key, { source, run: JSON.parse(JSON.stringify(run)) });
    return run;
  }
  function openRun(q) {
    const run = readRun(q);
    if (repo.state.drafts[runKey(q)]?.text !== JSON.stringify(run)) writeRun(q, run);
    return run;
  }
  const sameRun = (left, right) => left && right && left.id === right.id && left.index === right.index && S.stable(left.answers) === S.stable(right.answers) && S.stable(left.revealed) === S.stable(right.revealed) && S.stable(left.order) === S.stable(right.order);
  function ingestLocal() {
    try { const saved = localStorage.getItem(KEY); if (saved) repo.ingest(JSON.parse(saved)); } catch (_) { /* Repository.save reports unavailable storage. */ }
  }
  function refreshRunControls() {
    if (view !== 'exercise' || !active || !displayedRun) return;
    if (withoutChoices) {
      if (scStore.read(active, active.steps[scIndex]).token !== displayedSC?.token) toast('Cette réponse a changé ailleurs. Une nouvelle action l’actualisera ; tes saisies restent conservées.');
      return;
    }
    const current = readRun(active);
    if (!sameRun(current, displayedRun)) { toast('Cet essai a changé ailleurs. Une nouvelle action l’actualisera ; tes retours précédents restent conservés.'); return; }
    document.querySelectorAll('[data-choice]').forEach(button => { button.setAttribute('aria-pressed', String(current.answers[button.dataset.step] === button.dataset.choice)); });
  }
  async function mutateRun(q, expected, change, after) {
    const perform = () => {
      ingestLocal();
      const current = readRun(q);
      if (!sameRun(current, expected)) {
        if (view === 'exercise' && active?.id === q.id) {
          if (levelsEnabled) {
            if (activeMix) openMix();
            else if (activeCourse) openCourse(activeCourse);
          }
          render();
        }
        toast('L’essai a changé ailleurs. Il a été actualisé sans rétablir les anciens choix.'); return;
      }
      const next = change(current); writeRun(q, next);
      if (after) after(next);
      else refreshRunControls();
    };
    if (navigator.locks) await navigator.locks.request(SCOPE + '-edit', perform);
    else perform();
  }
  function snapshot(q, run) { return quickSnapshot(q, q.steps[run.index], run); }
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
  function stepSnapshot(q, step, run) { return withoutChoices ? scSnapshot(q, step, run) : quickSnapshot(q, step, run); }
  function quickSnapshot(q, step, run) {
    // Track panels actually opened in this tab, separately from attempt/hint flags.
    // No hidden correct answer is serialized before correction is displayed.
    const seen = quickSeen.get(run.id) || { context: false, hints: false, explanations: new Set() };
    const ids = run.order[step.id], selected = run.answers[step.id], revealed = !!run.revealed[step.id];
    const explanations = revealed ? ids.filter(id => id === step.correctId || id === selected || seen.explanations.has(step.id) || document.querySelector('.qcm-verdict details')?.open).map(id => {
      const choice = step.choices.find(c => c.id === id);
      return String.fromCharCode(65 + ids.indexOf(id)) + '. ' + (id === step.correctId ? 'Bonne réponse. ' : '') + choice.explanation;
    }).join('\n\n') : '';
    return { question: snapshotPrompt(step) + '\n\n' + ids.map((id, i) => String.fromCharCode(65 + i) + '. ' + step.choices.find(c => c.id === id).text).join('\n'),
      answer: 'Mon choix : ' + (selected ? String.fromCharCode(65 + ids.indexOf(selected)) + '. ' + step.choices.find(c => c.id === selected).text : 'aucun') + '\n\n' + (revealed ? explanations : 'Correction non affichée.'),
      hint: (seen.context ? 'Situation consultée :\n' + q.context : '') + (seen.hints ? '\n\nRappel consulté :\n' + hintText(q) : ''), module: q.module, course: q.course };
  }
  function markQuickSeen(run, kind, step) {
    const seen = quickSeen.get(run.id) || { context: false, hints: false, explanations: new Set() };
    if (kind === 'explanations') seen.explanations.add(step.id); else seen[kind] = true;
    quickSeen.set(run.id, seen);
  }
  function toast(message) {
    const node = document.getElementById('toast'); node.textContent = message; node.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 5000);
  }
  function header() {
    if (view === 'exercise' && active) {
      const run = visibleRun(active);
      const progress = coursePosition(active, run), counter = activeMix ? `Tout mélanger · QCM ${progress.index + 1} / ${progress.queue.length}` : activeCourse ? `${esc(courseLabel(activeCourse))} · QCM ${progress.index + 1} / ${progress.queue.length}` : `QCM ${run.index + 1} / ${active.steps.length}`;
      return `<header class="qcm-focus-header"><button class="icon-button" data-action="home" aria-label="Exercices">←</button><span class="question-counter">${withoutChoices ? 'Sans les choix · ' + counter.replace(/QCM/g, 'Question') : counter}</span>${needsContext(active.steps[run.index]) ? '<button class="btn secondary" data-action="open-context" aria-label="Voir la situation">Situation</button>' : ''}<button class="icon-button" data-action="open-hints" aria-label="Un rappel des concepts">?</button></header>`;
    }
    return `<header class="site-header"><button class="brand" data-action="home"><img class="brand-mark" src="icon.svg" alt=""><span><span class="brand-title">${esc(withoutChoices ? (collection.subject || '') + ' · Sans les choix' : collection.label || 'Essai · QCM guidés')}</span><span class="brand-subtitle">${esc(collection.subtitle || 'Français · Bloc oral')}</span></span></button><nav class="header-actions" aria-label="Navigation des QCM"><button class="btn ghost" data-action="home">Exercices</button><button class="btn ghost" data-action="avis">Mes avis</button><button class="btn ghost" data-action="feedback">Mes retours <span class="badge" data-feedback-count>${comments().length}</span></button><button class="icon-button" data-action="settings" aria-label="Sauvegardes des QCM">↗</button></nav></header>`;
  }
  function home() {
    if (GROUPED_COURSES) return oralHome();
    return `<section class="home-hero oral-home-hero"><h1 class="hero-title">Comprendre, puis rédiger</h1><p class="hero-description">D’abord, des QCM pour comprendre les notions et s’entraîner avec une correction expliquée. Ensuite, des exercices du même type pour préparer l’examen : à toi de rédiger ta réponse, sans choix proposés, puis de la comparer au corrigé.</p><p class="help-text">${esc(collection.description || 'Cette démo propose trois exercices de français. Tu peux passer à la rédaction quand tu veux.')}</p></section><section class="exercise-grid">${bank.exercises.map(q => {
      const run = readRun(q), score = q.steps.filter(s => run.answers[s.id] === s.correctId).length;
      return `<article class="course-card exercise-tile"><h2>${esc(q.title)}</h2><p class="help-text">${q.steps.length} QCM${run.checked ? ` · ${score} / ${q.steps.length} lors du dernier essai` : Object.keys(run.revealed).length ? ` · ${Object.keys(run.revealed).length} / ${q.steps.length} réponses` : ''}</p><div class="actions"><button class="btn primary" data-exercise="${q.id}">${Object.keys(run.answers).length ? 'Reprendre les QCM' : 'Essayer les QCM'}</button><a class="btn secondary" href="oral.html#${q.id}">Rédiger sans QCM</a></div></article>`;
    }).join('')}</section><p class="notice">Le résultat des QCM mesure la reconnaissance d’une réponse. La rédaction et sa justification restent à travailler séparément.</p><p class="help-text"><a href="oral.html">Retour au bloc oral</a></p>`;
  }
  // Parcours dérivés : chaque question conserve son exercice, sa révision et son essai.
  const courseKey = q => { if (typeof q.courseGroupKey === 'string') return q.courseGroupKey; const match = /^[CS](\d+)$/.exec(q.referenceId || q.course || ''); return match ? String(Number(match[1])) : null; };
  const groupDefinitions = () => bank.courseGroups || [...new Set(bank.exercises.map(courseKey).filter(Boolean))].map(key => ({ key, label: 'Cours ' + key }));
  const courseLabel = key => groupDefinitions().find(group => group.key === key)?.label || 'Cours ' + key;
  function orderedCourseEntries() {
    if (!bank.navigationOrder) return bank.families.flatMap(family => bank.exercises.filter(q => q.familyId === family.id).flatMap(q => q.steps.map((step, index) => ({ q, step, index }))));
    const entries = new Map(bank.exercises.flatMap(q => q.steps.map((step, index) => [JSON.stringify([q.id, step.id]), { q, step, index }])));
    return bank.navigationOrder.map(ref => entries.get(JSON.stringify([ref.exerciseId, ref.stepId])));
  }
  function courseQueue(key) {
    return orderedCourseEntries().filter(item => courseKey(item.q) === key && stepEligible(item.step));
  }
  function coursePosition(q, run) {
    const queue = activeMix ? mixedQueue(activeMix) : activeCourse ? courseQueue(activeCourse) : [];
    return { queue, index: queue.findIndex(item => item.q.id === q.id && item.step.id === q.steps[run.index].id) };
  }
  function scNavigationVersion() {
    return activeMix ? repo.state.drafts[levelStorageKey('mixed-position-v2')]?.text || '' : S.stable(readCourseCursors()[activeCourse] || null);
  }
  function readCourseCursors() {
    try {
      const scoped = withoutChoices || levelsEnabled || ancientOnly;
      const fallback = !withoutChoices && !ancientOnly && levelFilter === 'tout' ? localStorage.getItem(courseCursorKey) : null;
      const source = scoped ? repo.state.drafts[levelStorageKey('course-position')]?.text || fallback : localStorage.getItem(courseCursorKey);
      const value = JSON.parse(source || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
  }
  function selectCourseEntry(item) {
    active = item.q;
    if (withoutChoices) scIndex = item.index;
    else {
      const run = readRun(active); run.index = item.index;
      if (repo.state.drafts[runKey(active)]?.text !== JSON.stringify(run)) writeRun(active, run);
    }
    const cursors = readCourseCursors();
    cursors[activeCourse] = { exerciseId: active.id, stepId: item.step.id, qcmRevision: active.qcmRevision };
    try { if (withoutChoices || levelsEnabled || ancientOnly) writeNavigation(levelStorageKey('course-position'), cursors); else localStorage.setItem(courseCursorKey, JSON.stringify(cursors)); } catch (_) { toast('La position du cours ne peut pas être enregistrée sur cet appareil.'); }
  }
  function openCourse(key) {
    const queue = courseQueue(key);
    if (!queue.length) { showEmptyPath(emptySelection()); return false; }
    activeCourse = key;
    const cursor = readCourseCursors()[key];
    const saved = queue.find(item => item.q.id === cursor?.exerciseId && item.step.id === cursor?.stepId && item.q.qcmRevision === cursor?.qcmRevision);
    const pending = saved || queue.find(item => !stepDone(item)) || queue[queue.length - 1];
    selectCourseEntry(pending); return true;
  }
  function showEmptyPath(message) {
    active = null; activeCourse = null; activeMix = null; view = 'home'; emptyPathMessage = message;
  }
  function courseStats(queue) {
    if (withoutChoices) return queue.reduce((stats, item) => {
      const record = scStore.read(item.q, item.step);
      if (record.selfEvaluation) { stats.answered++; if (record.selfEvaluation === 'known') stats.score++; }
      return stats;
    }, { answered: 0, score: 0 });
    return queue.reduce((stats, item) => { const run = readRun(item.q); if (run.revealed[item.step.id]) { stats.answered++; if (run.answers[item.step.id] === item.step.correctId) stats.score++; } return stats; }, { answered: 0, score: 0 });
  }
  const entryRef = item => ({ exerciseId: item.q.id, stepId: item.step.id, qcmRevision: item.q.qcmRevision });
  const entryKey = item => JSON.stringify([item.exerciseId, item.stepId, item.qcmRevision]);
  function compactMix(mix) {
    const members = [], positions = new Map();
    const ref = item => {
      const key = JSON.stringify([item.exerciseId, item.qcmRevision]);
      if (!positions.has(key)) { positions.set(key, members.length); members.push([item.exerciseId, item.qcmRevision]); }
      return [positions.get(key), item.stepId];
    };
    const order = mix.order.map(ref), cursor = ref(mix.cursor || mix.order[0]);
    return { version: 2, id: mix.id, members, order, cursor };
  }
  function expandedMix(value) {
    if (value?.version !== 2) return value;
    if (!Array.isArray(value.members) || !value.members.length || !value.members.every(m => Array.isArray(m) && m.length === 2 && m.every(x => typeof x === 'string')) || !Array.isArray(value.order)) throw Error('Mélange incompatible.');
    const ref = item => {
      if (!Array.isArray(item) || item.length !== 2 || !Number.isInteger(item[0]) || !value.members[item[0]] || typeof item[1] !== 'string') throw Error('Position incompatible.');
      const [exerciseId, qcmRevision] = value.members[item[0]];
      return { exerciseId, qcmRevision, stepId: item[1] };
    };
    return { version: 1, id: value.id, order: value.order.map(ref), cursor: ref(value.cursor) };
  }
  function allEntries() { return bank.exercises.flatMap(exerciseEntries); }
  function mixedQueue(mix) {
    const entries = new Map(allEntries().map(item => [entryKey(entryRef(item)), item]));
    return mix.order.map(ref => entries.get(entryKey(ref)));
  }
  function readMix() {
    let value;
    try {
      const scoped = withoutChoices || levelsEnabled || ancientOnly;
      const fallback = !withoutChoices && !ancientOnly && levelFilter === 'tout' ? localStorage.getItem(mixKey) : null;
      const source = scoped ? repo.state.drafts[levelStorageKey('mixed-position-v2')]?.text || repo.state.drafts[levelStorageKey('mixed-position')]?.text || fallback : localStorage.getItem(mixKey);
      value = expandedMix(JSON.parse(source || 'null'));
    } catch (_) { return null; }
    const entries = allEntries().map(item => entryKey(entryRef(item)));
    if (!entries.length) return null;
    if (value?.version !== 1 || typeof value.id !== 'string' || !Array.isArray(value.order) || value.order.length > entries.length || !value.order.length) return null;
    const keys = value.order.map(ref => entryKey(ref || {}));
    if (new Set(keys).size !== keys.length || !keys.every(key => entries.includes(key))) return null;
    let order = value.order;
    if (keys.length < entries.length) {
      // Append newly exported compatible questions; keep the previous order/cursor.
      const signature = JSON.stringify([value, entries]);
      if (!mixExpansionCache.has(signature)) mixExpansionCache.set(signature, [...order, ...shuffled(allEntries().map(entryRef).filter(ref => !keys.includes(entryKey(ref))))]);
      order = mixExpansionCache.get(signature);
    }
    return { version: 1, id: value.id, order, cursor: keys.includes(entryKey(value.cursor || {})) ? value.cursor : order[0] };
  }
  function saveMix() {
    try {
      if (withoutChoices || levelsEnabled || ancientOnly) {
        const compact = compactMix(activeMix);
        if (JSON.stringify(compact).length > 12000) throw Error('Mélange trop volumineux.');
        // Separate key prevents an older client overwriting the extended mixture.
        writeNavigation(levelStorageKey('mixed-position-v2'), compact);
      } else localStorage.setItem(mixKey, JSON.stringify(activeMix));
    } catch (_) { toast('Le mélange ne peut pas être enregistré sur cet appareil.'); }
  }
  function openMix(fresh = false) {
    const entries = allEntries();
    if (!entries.length) { showEmptyPath(emptySelection()); return false; }
    activeCourse = null;
    activeMix = !fresh && readMix() || { version: 1, id: S.uuid(), order: shuffled(entries.map(entryRef)) };
    const queue = mixedQueue(activeMix);
    const target = queue.find(item => entryKey(entryRef(item)) === entryKey(activeMix.cursor || {})) || queue[0];
    selectMixedEntry(target);
  }
  function selectMixedEntry(item) {
    active = item.q;
    if (withoutChoices) scIndex = item.index;
    else {
      const run = readRun(active); run.index = item.index;
      if (repo.state.drafts[runKey(active)]?.text !== JSON.stringify(run)) writeRun(active, run);
    }
    activeMix.cursor = entryRef(item); saveMix();
  }
  function oralHome() {
    const query = oralNavigation.normalize(search);
    const courses = groupDefinitions().map(group => {
      const key = group.key;
      const queue = courseQueue(key), exercises = bank.exercises.filter(q => courseKey(q) === key);
      const dates = exercises.map(q => { const [d, m, y] = String(bank.courseReferences[q.referenceId || q.course]?.date || '').split('.'); return y && m && d ? `${y}${m}${d}` : '99999999'; }).sort();
      const label = group.label;
      const courseAlias = collection.id === 'shs-qcm-s1' ? label.replace(/\s+/g, '') : `Cours${key}`;
      const haystack = [bank.blocks?.find(block => block.key === group.block)?.label, label, courseAlias, ...exercises.map(q => { const family = bank.families.find(f => f.id === q.familyId), ref = bank.courseReferences[q.referenceId || q.course]; return [family?.title, family?.theme, q.title, q.prompt, ...q.hints, ...q.steps.map(s => s.prompt), ref?.date].join(' '); })].join(' ');
      return { key, label, block: group.block, queue, date: dates[0] || '99999999', match: !query || oralNavigation.normalize(haystack).includes(query) };
    }).filter(course => course.match);
    const total = allEntries().length, mix = readMix();
    return `<div class="quiz-help-entry"><button type="button" class="btn quiz-help-button" data-quiz-help>Comment utiliser ce quiz ?</button></div>${modeControls()}${levelControls()}${emptyPathMessage ? `<p class="notice" role="status">${esc(emptyPathMessage)}</p>` : ''}<section class="qcm-mix-start" aria-label="Toutes les questions"><div><button class="btn primary" data-action="mix" ${total ? '' : 'disabled'}>Tout mélanger</button><p class="help-text">${total ? total + ' ' + questionLabel() + ' en ordre aléatoire. Réponses conservées.' : esc(emptySelection())}</p></div>${mix ? '<button class="btn ghost" data-action="new-mix">Nouveau mélange</button>' : ''}</section>
      ${window.HEPQuickUI?.group() || ''}<section class="qcm-subject" aria-labelledby="qcm-subject-title"><h1 id="qcm-subject-title">${esc(collection.subject || 'Français')}</h1><section class="qcm-block" aria-labelledby="qcm-block-title"><h2 id="qcm-block-title">${esc(collection.block || 'Bloc oral')}</h2><p class="hero-description">${withoutChoices ? 'Écris ou pense ta réponse, puis affiche la réponse attendue et déclare « Je savais » ou « À revoir ». Les résultats QCM restent séparés.' : 'Des QCM avec une correction expliquée, à ton rythme.'}${writingHome && !withoutChoices ? ' Les exercices rédigés du bloc oral ont aussi leur <a href="oral.html">accès direct à la rédaction</a>.' : ''}</p>
      <form class="oral-tools qcm-home-filters" id="qcm-home-filters"><label class="oral-field" for="qcm-search">Rechercher un cours ou une notion<input class="text-input" id="qcm-search" type="search" value="${esc(search)}" placeholder="${esc(collection.searchPlaceholder || 'Ex. : Cours 1, étayage, récit…')}"></label><button class="btn secondary" type="submit">Rechercher</button>${search ? '<button class="btn ghost" type="button" data-action="clear-search">Tout afficher</button>' : ''}</form>
      <p class="help-text oral-result-count" id="qcm-home-results" role="status" tabindex="-1">${courses.length} cours · ${courses.reduce((n, course) => n + course.queue.length, 0)} ${questionLabel()}</p><div class="exercise-grid qcm-courses" role="group" aria-label="Parcours par cours">${renderCourseBlocks(courses, course => { const stats = courseStats(course.queue); return `<article class="course-card exercise-tile"><h3>${esc(course.label)}</h3><p class="help-text">${course.queue.length} ${questionLabel()}${stats.answered ? ` · ${stats.answered} ${withoutChoices ? 'autoévaluation' : 'réponse'}${stats.answered > 1 ? 's' : ''} enregistrée${stats.answered > 1 ? 's' : ''}` : ''}</p><button class="btn primary" data-course="${esc(course.key)}" ${course.queue.length ? '' : 'disabled'} aria-label="${esc(course.queue.length ? (stats.answered || readCourseCursors()[course.key] ? 'Reprendre' : 'Commencer') + ' ' + course.label : 'Aucune question disponible pour ' + course.label + '. ' + emptySelection())}">${course.queue.length ? (stats.answered || readCourseCursors()[course.key] ? 'Reprendre' : 'Commencer') : 'Aucune question'}</button></article>`; }) || '<p class="empty-state">Aucun cours ne correspond à cette recherche.</p>'}</div></section></section>
      ${writingHome && !withoutChoices ? '<p class="notice">Le résultat des QCM mesure la reconnaissance d’une réponse. La rédaction et sa justification restent à travailler séparément.</p>' : ''}`;
  }
  function renderCourseBlocks(courses, card) {
    if (!bank.blocks) return courses.map(card).join('');
    return bank.blocks.map(block => {
      const entries = courses.filter(course => course.block === block.key);
      return entries.length ? `<section class="qcm-discipline" aria-label="${esc(block.label)}"><h3>${esc(block.label)}</h3><div class="exercise-grid">${entries.map(card).join('')}</div></section>` : '';
    }).join('');
  }
  function scSnapshot(q, step, run) {
    const record = displayedSC, seen = quickSeen.get(run.id) || {};
    const response = document.getElementById('sc-response')?.value ?? record.response;
    const correct = record.revealed ? step.choices.find(choice => choice.id === step.correctId) : null;
    return {
      question: 'Sans les choix\n\n' + snapshotPrompt(step),
      answer: 'Ma réponse personnelle :\n' + (response || 'Réponse pensée ou non écrite.') + '\n\n' + (correct ? 'Réponse attendue :\n' + correct.text + '\n\n' + correct.explanation : 'Réponse attendue non affichée.') + (record.selfEvaluation ? '\n\nAutoévaluation déclarée : ' + (record.selfEvaluation === 'known' ? 'Je savais' : 'À revoir') : ''),
      hint: (seen.context ? 'Situation consultée :\n' + q.context : '') + (seen.hints ? '\n\nRappel consulté :\n' + hintText(q) : ''), module: q.module, course: q.course
    };
  }
  function scExercise() {
    const q = active, step = q.steps[scIndex], record = scStore.read(q, step), run = visibleRun(q);
    const ref = bank.courseReference || bank.courseReferences[q.referenceId], source = q.sources.find(s => s.file.includes('SYNTHESE')) || q.sources[0];
    const progress = coursePosition(q, run), stats = courseStats(progress.queue), total = progress.queue.length;
    const correct = record.revealed ? step.choices.find(choice => choice.id === step.correctId) : null;
    const alternatives = scStore.alternatives(q, step);
    return `<section class="question-shell"><article class="question-card">${levelControls()}<p class="exercise-origin">${esc(referenceLabel(ref))}${ref.date ? ' · ' + esc(ref.date) : ''}</p><fieldset class="qcm-step sc-step" tabindex="-1"><legend>${esc(step.prompt)}</legend>${ancientBadge(step)}${needsContext(step) ? '<button class="qcm-context-cue" data-action="open-context">Clique sur « Situation » pour lire le contexte.</button>' : ''}<label class="field-label" for="sc-response">Ma réponse (facultative)</label><p class="help-text">Écris ici ou réponds dans ta tête, puis compare avec la réponse attendue.</p><textarea class="feedback-textarea sc-response" id="sc-response" rows="4" maxlength="8000">${esc(record.response)}</textarea><p class="save-status" id="sc-response-status" role="status" aria-live="polite">${repo.warning ? esc(repo.warning) : record.token ? 'Réponse conservée sur cet appareil.' : 'La réponse écrite est facultative.'}</p><button class="btn secondary" data-action="sc-refresh" id="sc-refresh" hidden>Recharger cette question</button>${correct ? `<section class="sc-expected" tabindex="-1" aria-labelledby="sc-expected-title"><h2 id="sc-expected-title">Réponse attendue</h2><p>${text(correct.text)}</p><p>${text(correct.explanation)}</p></section><div class="actions sc-self-evaluation" role="group" aria-label="Mon autoévaluation"><button class="btn ${record.selfEvaluation === 'known' ? 'primary' : 'secondary'}" data-action="sc-known" aria-pressed="${record.selfEvaluation === 'known'}">Je savais</button><button class="btn ${record.selfEvaluation === 'review' ? 'primary' : 'secondary'}" data-action="sc-review" aria-pressed="${record.selfEvaluation === 'review'}">À revoir</button></div><p class="help-text" role="status">${record.selfEvaluation ? 'Autoévaluation déclarée : ' + (record.selfEvaluation === 'known' ? 'Je savais.' : 'À revoir.') : 'Choisis « Je savais » ou « À revoir » pour poursuivre. Aucune note automatique.'}</p>` : '<button class="btn primary" data-action="sc-reveal">Voir la réponse</button>'}</fieldset>${alternatives.length ? `<details class="sc-alternatives"><summary>Autres réponses conservées (${alternatives.length})</summary><p class="help-text">Ces saisies d’autres onglets ou reprises restent disponibles. Tu peux en copier le texte.</p>${alternatives.map(item => `<p>${text(item.response)}</p>`).join('')}</details>` : ''}${window.HEPQuickUI?.thumbs() || ''}<button class="btn secondary qcm-report-button" data-action="report-step">Signaler un problème avec cette question</button>${scReportPanel()}<div class="question-navigation">${progress.index > 0 ? '<button class="btn secondary" data-action="previous">← Question précédente</button>' : ''}${progress.index + 1 < total ? `<button class="btn primary" data-action="next" ${record.selfEvaluation ? '' : 'disabled'}>Question suivante →</button>` : ''}</div>${progress.index === total - 1 && total > 0 && stats.answered === total ? `<section class="qcm-summary"><h2>Parcours Sans les choix terminé</h2><p>Autoévaluations déclarées : ${stats.score} « Je savais » ; ${stats.answered - stats.score} « À revoir ». Elles restent distinctes des résultats QCM.</p>${window.HEPQuickUI?.group() || ''}</section>` : ''}<div class="actions"><button class="btn secondary" data-action="${activeMix ? 'mix-first' : 'course-first'}">Revoir ${activeMix ? 'le mélange' : 'le cours'} depuis le début</button></div></article></section>${supportDialogs(q, step, ref, source)}`;
  }
  function scReportPanel() {
    return `<details class="feedback-panel" id="step-feedback" hidden><summary>Mon signalement sur cette question Sans les choix</summary>${HEPFeedback.fields(true)}<label class="field-label" for="step-feedback-category">Catégorie (facultative)</label><select class="select-input" id="step-feedback-category"><option value="">Sans catégorie</option><option>Question</option><option>Réponse attendue</option><option>Aides</option><option>Autre</option></select><label class="field-label" for="step-feedback-comment">Mon commentaire</label><textarea class="feedback-textarea" id="step-feedback-comment" rows="4" maxlength="8000"></textarea><p class="help-text">Le signalement conserve le mode, la question, ta réponse et uniquement les contenus déjà affichés à son ouverture.</p><div class="actions"><button class="btn primary" data-action="send-step" disabled>Envoyer à Maxim</button></div><p class="save-status" data-send-status role="status" aria-live="polite">Brouillon sur cet appareil.</p><p class="help-text">L’envoi à Maxim ne demande pas de compte Google.</p><details><summary>Sauvegarde personnelle avec Drive (facultative)</summary><button class="btn secondary" data-action="panel-drive">${HEPDrive.connected() ? 'Synchroniser Drive ici' : 'Connecter Drive ici'}</button><p class="save-status" data-save-status></p></details></details>`;
  }
  function bindSCResponse() {
    const q = active, step = q.steps[scIndex], field = document.getElementById('sc-response'), message = document.getElementById('sc-response-status');
    let expected = { ...displayedSC };
    field.addEventListener('input', () => {
      const response = field.value;
      displayedSC = { ...displayedSC, response };
      message.textContent = 'Enregistrement de la réponse…';
      scPending = scPending.catch(() => {}).then(async () => {
        try {
          const result = await scStore.update(q, step, expected, { response });
          if (result.ok) expected = result.current;
          if (!field.isConnected) return;
          if (result.ok) {
            displayedSC = { ...result.current, response: field.value };
            message.textContent = result.current.saved ? 'Réponse conservée sur cet appareil.' : repo.warning;
          } else {
            message.textContent = result.retained?.saved ? 'Une autre réponse a changé ailleurs. Ta saisie est conservée séparément ; recharge cette question pour choisir quoi reprendre.' : 'La réponse a changé ailleurs. Ta saisie reste visible ; conserve-la avant de recharger.';
            document.getElementById('sc-refresh').hidden = false;
          }
        } catch (error) {
          try { scStore.retain(q, step, expected, response); } catch (_) { /* The complete text stays in the field. */ }
          if (field.isConnected) { message.textContent = error.message; document.getElementById('sc-refresh').hidden = false; }
        }
      });
    });
  }
  function stepView(q, step, index, run) {
    const selected = step.choices.find(c => c.id === run.answers[step.id]), correct = step.choices.find(c => c.id === step.correctId), revealed = !!run.revealed[step.id];
    return `<fieldset class="qcm-step" data-step="${step.id}"><legend>${esc(step.prompt)}</legend>${ancientBadge(step)}${needsContext(step) ? '<button class="qcm-context-cue" data-action="open-context">Clique sur « Situation » pour lire le contexte.</button>' : ''}<div class="qcm-choices">${run.order[step.id].map((id, i) => { const c = step.choices.find(c => c.id === id); return `<button class="qcm-choice ${selected?.id === id ? 'qcm-selected' : ''} ${revealed && id === step.correctId ? 'qcm-correct' : revealed && id === selected?.id ? 'qcm-incorrect' : ''}" data-choice="${id}" data-step="${step.id}" aria-label="${revealed && id === step.correctId ? 'Bonne réponse : ' : ''}${String.fromCharCode(65 + i)}. ${esc(c.text)}" aria-pressed="${selected?.id === id}" ${revealed ? 'disabled' : ''}><span><strong>${String.fromCharCode(65 + i)}.</strong> ${esc(c.text)}</span></button>`; }).join('')}</div>${revealed ? `<div class="qcm-verdict" role="status" tabindex="-1"><strong>${selected.id === step.correctId ? 'Bonne réponse.' : 'À reprendre.'}</strong><p>${text(correct.explanation)}</p>${selected.id !== step.correctId ? `<p><strong>Ton choix :</strong> ${text(selected.explanation)}</p>` : ''}<details><summary>Comprendre les autres propositions</summary>${run.order[step.id].filter(id => id !== step.correctId && id !== selected.id).map(id => { const c = step.choices.find(c => c.id === id), letter = String.fromCharCode(65 + run.order[step.id].indexOf(id)); return `<p><strong>${letter}.</strong> ${text(c.explanation)}</p>`; }).join('')}</details></div>` : ''}</fieldset>`;
  }
  function supportDialogs(q, step, ref, source) {
    const head = title => `<div class="qcm-dialog-head"><h2>${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="Fermer">×</button></div>`;
    return `${needsContext(step) ? `<dialog id="qcm-context-dialog" class="qcm-dialog" aria-labelledby="qcm-context-title">${head('<span id="qcm-context-title">La situation</span>')}<p class="exercise-origin">${esc(referenceLabel(ref))} · ${esc(ref.date)}<br>Passage à relire : ${esc(source.location)}</p><div class="exercise-context">${text(q.context)}</div></dialog>` : ''}<dialog id="qcm-hint-dialog" class="qcm-dialog" aria-labelledby="qcm-hint-title">${head('<span id="qcm-hint-title">Un rappel des concepts</span>')}${q.hints.map(h => `<p>${text(h)}</p>`).join('')}<p class="help-text">Passages à relire :<br>${q.sources.map(source => esc(source.file) + ' — ' + esc(source.location)).join('<br>')}</p></dialog>`;
  }
  function exercise() {
    const q = active, run = readRun(q), snap = snapshot(q, run), saved = S.currentFeedback(repo.state, feedbackQuestion(q), snap);
    const categories = ['Consigne', ...q.steps.map((s, i) => 'QCM ' + (i + 1)), 'Aides', ...(canWrite(q) ? ['Passage à la rédaction'] : []), 'Autre'];
    const ref = bank.courseReference || bank.courseReferences[q.referenceId], source = q.sources.find(s => s.file.includes('SYNTHESE')) || q.sources[0], step = q.steps[run.index];
    const score = q.steps.filter(s => run.answers[s.id] === s.correctId && run.revealed[s.id]).length;
    const progress = coursePosition(q, run), index = activeCourse || activeMix ? progress.index : run.index, total = activeCourse || activeMix ? progress.queue.length : q.steps.length;
    const stats = activeCourse || activeMix ? courseStats(progress.queue) : { answered: Object.keys(run.revealed).length, score };
    const finished = stats.answered === total;
    const summary = activeMix ? 'Tous les QCM du mélange sont terminés' : activeCourse ? `Les QCM de ${esc(courseLabel(activeCourse))} sont terminés` : 'Les QCM de cet exercice sont terminés';
    return `<section class="question-shell"><article class="question-card">${levelControls()}<p class="exercise-origin">${esc(referenceLabel(ref))}${ref.date ? ' · ' + esc(ref.date) : ''}</p>${stepView(q, step, run.index, run)}${window.HEPQuickUI?.thumbs() || ''}<button class="btn secondary qcm-report-button" data-action="report-step">Signaler un problème avec cette question</button><details class="feedback-panel" id="step-feedback" hidden><summary>Mon signalement sur cette question</summary>${HEPFeedback.fields(true)}<label class="field-label" for="step-feedback-category">Catégorie (facultative)</label><select class="select-input" id="step-feedback-category"><option value="">Sans catégorie</option><option>Question</option><option>Propositions</option><option>Correction</option><option>Autre</option></select><label class="field-label" for="step-feedback-comment">Mon commentaire</label><textarea class="feedback-textarea" id="step-feedback-comment" rows="4" maxlength="8000"></textarea><p class="help-text">Le brouillon conserve la question et les contenus consultés au moment de l’ouverture du signalement.</p><div class="actions"><button class="btn primary" data-action="send-step" disabled>Envoyer à Maxim</button></div><p class="save-status" data-send-status role="status" aria-live="polite">Brouillon sur cet appareil.</p><p class="help-text">L’envoi à Maxim ne demande pas de compte Google.</p><details><summary>Sauvegarde personnelle avec Drive (facultative)</summary><p class="help-text">Connecte Drive ici pour sauvegarder depuis cet onglet. La connexion ne se transmet pas aux autres onglets et se termine au rechargement. Elle est indépendante de l’envoi à Maxim.</p><button class="btn secondary" data-action="panel-drive">${HEPDrive.connected() ? 'Synchroniser Drive ici' : 'Connecter Drive ici'}</button><p class="save-status" data-save-status></p></details></details><div class="question-navigation">${index > 0 ? '<button class="btn secondary" data-action="previous">← QCM précédent</button>' : ''}${index + 1 < total ? `<button class="btn primary" data-action="next" ${run.revealed[step.id] ? '' : 'disabled'}>QCM suivant →</button>` : ''}</div>${index === total - 1 && finished ? `<section class="qcm-summary"><h2>${summary}</h2><p>${stats.score} réponse${stats.score > 1 ? 's' : ''} correcte${stats.score > 1 ? 's' : ''} sur ${total}. Tu peux revoir les questions et leurs explications.</p>${window.HEPQuickUI?.group() || ''}</section>` : ''}<div class="actions">${activeMix ? (finished ? '<button class="btn secondary" data-action="mix-first">Revoir le mélange depuis le début</button>' : '') : activeCourse ? '<button class="btn secondary" data-action="course-first">Revoir le cours depuis le début</button>' : run.checked ? '<button class="btn secondary" data-action="restart">Recommencer les QCM</button>' : ''}${canWrite(q) ? `<a class="btn ${run.checked ? 'primary' : 'secondary'}" href="oral.html#${q.id}">Rédiger cet exercice sans QCM →</a>` : ''}</div></article><details class="feedback-panel" ${saved?.comment ? 'open' : ''}><summary>Mon retour sur cet essai</summary><label class="field-label" for="feedback-category">Cela concerne…</label><select class="select-input" id="feedback-category">${categories.map(c => `<option ${(saved?.category || 'QCM ' + (run.index + 1)) === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><label class="field-label" for="feedback-comment">Mon commentaire</label><textarea class="feedback-textarea" id="feedback-comment" rows="4" maxlength="8000" placeholder="Ex. : deux propositions me semblent justes ; la correction n’explique pas leur différence…">${esc(saved?.comment || '')}</textarea><p class="help-text">Ton retour conserve les propositions dans l’ordre affiché et leurs explications.</p><p class="save-status" data-save-status></p></details></section>${supportDialogs(q, step, ref, source)}`;
  }
  function feedback() {
    return `<h1>Mes retours sur les QCM</h1>${HEPFeedback.fields()}${HEPFeedback.archiveLink}<div class="actions"><button class="btn primary" data-action="copy" ${comments().length ? '' : 'disabled'}>Copier les retours</button><button class="btn secondary" data-action="export" ${comments().length ? '' : 'disabled'}>Télécharger les retours</button></div><div class="feedback-list">${comments().sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => `<article class="feedback-item"><span class="pill">${esc(item.category)}</span><h2>${esc(item.snapshot.question.split('\n')[0])}</h2><p class="exercise-text">${esc(item.comment)}</p><button class="btn ghost" data-exercise="${esc(item.questionId.split('::')[0])}">Revoir les QCM →</button></article>`).join('') || '<p class="empty-state">Tu peux laisser un retour dans chaque exercice.</p>'}</div><p class="help-text">Copie tes retours, puis envoie-les à Maxim par message. Aucun envoi automatique.</p>`;
  }
  function settings() {
    return `<h1>Sauvegardes de la collection</h1>${HEPFeedback.archiveLink}<section class="settings-card"><h2>Sur cet appareil</h2><p>Les choix et résultats QCM, les réponses et autoévaluations Sans les choix, leurs parcours et les retours sont conservés séparément dans la sauvegarde de cette collection.</p><div class="actions"><button class="btn primary" data-action="backup">Télécharger une sauvegarde</button><button class="btn secondary" data-action="import">Importer une sauvegarde QCM</button><input id="backup-file" type="file" accept=".json,application/json" hidden></div></section><section class="settings-card"><h2>Google Drive, facultatif</h2><p>Dossier « ${esc(window.CONFIG.DRIVE_FOLDER)} ». La connexion vaut pour cet onglet et doit être renouvelée après rechargement.</p><div class="actions">${HEPDrive.connected() ? '<button class="btn primary" data-action="sync">Synchroniser maintenant</button><button class="btn ghost" data-action="disconnect">Déconnecter</button>' : '<button class="btn primary" data-action="connect">Connecter Google Drive</button>'}</div><p data-save-status class="save-status"></p></section>`;
  }
  function render() {
    stepFeedback = null;
    // Read only the unfiltered view: search results open temporarily, not by preference.
    document.querySelectorAll('details[data-qcm-theme][data-qcm-manual="true"]').forEach(node => {
      if (node.open) expandedThemes.add(node.dataset.qcmTheme); else expandedThemes.delete(node.dataset.qcmTheme);
    });
    app.innerHTML = `<div class="page ${view === 'exercise' ? 'qcm-focus' : GROUPED_COURSES && view === 'home' ? 'qcm-oral-home' : ''}">${header()}<div id="qcm-main" tabindex="-1">${view === 'exercise' ? (withoutChoices ? scExercise() : exercise()) : view === 'feedback' ? feedback() : view === 'settings' ? settings() : view === 'avis' ? (window.HEPQuickUI?.archive() || '') : home()}</div><footer class="footer"><span class="save-status" data-save-status></span>${view === 'exercise' ? '<button class="btn ghost small" data-action="avis">Mes avis</button><button class="btn ghost small" data-action="feedback">Mes retours</button>' : ''}<a href="index.html">Matières</a>${writingHome ? '<a href="oral.html">Exercices rédigés du bloc oral</a>' : ''}</footer></div>`;
    if (view === 'exercise' && withoutChoices) { displayedRun = visibleRun(active); displayedSC = scStore.read(active, active.steps[scIndex]); displayedSCNavigation = scNavigationVersion(); }
    status(); HEPFeedback.bind();
    window.HEPQuickUI?.bind(view === 'exercise' ? { question: { questionId: stepQuestion(active, active.steps[visibleRun(active).index]).id, contentRevision: active.qcmRevision }, mode: withoutChoices ? 'sans-choix' : 'qcm', getSnapshot: () => withoutChoices ? scSnapshot(active, active.steps[displayedRun.index], displayedRun) : quickSnapshot(active, active.steps[displayedRun.index], displayedRun) } : {});
    document.getElementById('qcm-home-filters')?.addEventListener('submit', event => {
      event.preventDefault(); search = document.getElementById('qcm-search').value.trim(); render();
      document.getElementById('qcm-home-results').focus({ preventScroll: true });
    });
    if (view === 'exercise' && withoutChoices) bindSCResponse();
    if (view === 'exercise' && !withoutChoices) {
      const q = active, run = readRun(q), snap = snapshot(q, run);
      displayedRun = run;
      const step = q.steps[run.index];
      document.querySelector('.qcm-verdict details')?.addEventListener('toggle', event => {
        if (event.target.open) { rememberExplanations(q, step, run); markQuickSeen(run, 'explanations', step); }
      });
      const saveComment = () => { const snap = snapshot(q, displayedRun || run); repo.comment(feedbackQuestion(q), document.getElementById('feedback-category').value, document.getElementById('feedback-comment').value, snap); changed(); };
      document.getElementById('feedback-comment').addEventListener('input', saveComment);
      document.getElementById('feedback-category').addEventListener('change', saveComment);
    }
    document.getElementById('backup-file')?.addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 25 * 1024 * 1024) throw new Error('Ce fichier est trop volumineux.');
        const raw = JSON.parse(await file.text());
        if (raw.scope !== SCOPE) throw new Error('Choisis une sauvegarde de cette collection de QCM.');
        repo.import(raw); changed(); route(); toast('Sauvegarde QCM réunie avec tes données.');
      } catch (error) { toast(error.message); }
    });
  }
  function route() {
    let hash; try { hash = decodeURIComponent(location.hash.slice(1)); } catch (_) { hash = ''; }
    withoutChoices = GROUPED_COURSES && (hash === 'sans-choix' || hash.startsWith('sans-choix/'));
    if (withoutChoices) {
      if (!scStore) throw Error('Le mode Sans les choix n’est pas disponible. Recharge la page en ligne.');
      hash = hash.slice('sans-choix'.length).replace(/^\//, '');
    }
    if (levelsEnabled) restoreLevelChoice();
    restoreAncientChoice();
    activeCourse = null; activeMix = null; active = null; scIndex = 0; emptyPathMessage = '';
    const course = GROUPED_COURSES && /^cours-([0-9]+(?:-[0-9]+)?)$/.exec(hash);
    if (GROUPED_COURSES && hash === 'tout-melanger') openMix();
    else if (course) openCourse(IS_ORAL ? String(Number(course[1])) : course[1]);
    else active = byId.get(hash) || null;
    if (active && (levelsEnabled || withoutChoices || ancientOnly) && !activeCourse && !activeMix) {
      const target = active, entries = withoutChoices ? courseQueue(courseKey(target)).filter(item => item.q.id === target.id) : exerciseEntries(target), run = visibleRun(target);
      if (entries.length) { activeCourse = courseKey(target); selectCourseEntry(entries.find(item => item.index === run.index) || entries[0]); }
      else if (ancientOnly) showEmptyPath(emptySelection());
      else openCourse(courseKey(target));
    }
    if (active && !withoutChoices) openRun(active);
    view = active ? 'exercise' : ['feedback', 'settings', 'avis'].includes(hash) ? hash : 'home';
    render(); document.getElementById('qcm-main').focus({ preventScroll: true }); window.scrollTo(0, 0);
  }
  function navigate(target) {
    const destination = withoutChoices ? 'sans-choix' + (target ? '/' + target : '') : target;
    if (location.hash.slice(1) === destination) route(); else location.hash = destination;
  }
  function download(name, value, mime = 'application/json') {
    const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: mime + ';charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  app.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || button.disabled || !bank) return;
    if (withoutChoices) { await scPending; if (!button.isConnected || button.disabled) return; }
    if (button.dataset.action === 'mode-sc' || button.dataset.action === 'mode-qcm') {
      const destination = button.dataset.action === 'mode-sc' ? 'sans-choix' : '';
      if (location.hash.slice(1) === destination) route(); else location.hash = destination;
      return;
    }
    if (button.dataset.action === 'ancient-filter' && GROUPED_COURSES) {
      ancientOnly = !ancientOnly; writeNavigation(selectedAncientKey(), ancientOnly); route(); return;
    }
    if (button.dataset.levelFilter && levelsEnabled) {
      const next = button.dataset.levelFilter;
      if (!['essentiel', 'tout'].includes(next) || next === levelFilter) return;
      // Read the other filter's independent cursor/mixture without changing an answer.
      levelFilter = next; writeNavigation(selectedLevelKey(), next); route(); return;
    }
    if (GROUPED_COURSES && ['mix', 'new-mix'].includes(button.dataset.action)) {
      if (button.dataset.action === 'new-mix') openMix(true);
      return navigate('tout-melanger');
    }
    if (button.dataset.course) return navigate('cours-' + button.dataset.course);
    if (button.dataset.exercise) return navigate(button.dataset.exercise);
    const action = button.dataset.action;
    if (action === 'clear-search') { search = ''; render(); document.getElementById('qcm-search').focus({ preventScroll: true }); return; }
    if (['home', 'feedback', 'settings', 'avis'].includes(action)) return navigate(action === 'home' ? '' : action);

    if (action === 'report-step' && active) {
      const q = active, run = displayedRun, step = q.steps[run.index], panel = document.getElementById('step-feedback');
      if (!panel.hidden) { panel.open = true; document.getElementById('step-feedback-comment').focus(); return; }
      const snap = stepSnapshot(q, step, run), question = stepQuestion(q, step), saved = S.currentFeedback(repo.state, question, snap);
      panel.hidden = false; panel.open = true;
      const field = document.getElementById('step-feedback-comment'), category = document.getElementById('step-feedback-category');
      field.value = saved?.comment || ''; category.value = saved?.category === 'autre' ? '' : saved?.category || '';
      let binding;
      const save = () => { repo.comment(question, category.value || 'autre', field.value, snap); changed(); binding?.refresh(); };
      binding = bindStepSend(question, snap, field, category, panel, save);
      field.addEventListener('input', save); category.addEventListener('change', save); field.focus(); return;
    }
    if (action === 'send-step') return stepFeedback?.send();
    if (action === 'panel-drive') {
      button.disabled = true; button.dataset.busy = 'true';
      try { if (HEPDrive.connected()) await HEPDrive.sync(); else await HEPDrive.connect(); }
      catch (error) { toast(error.message); }
      finally { button.dataset.busy = 'false'; status(); }
      return;
    }
    if (withoutChoices && active && ['sc-reveal', 'sc-known', 'sc-review', 'next', 'previous', 'sc-refresh'].includes(action)) {
      if (action === 'sc-refresh') { route(); return; }
      const q = active, step = q.steps[scIndex], expected = displayedSC;
      const progress = coursePosition(q, displayedRun), target = progress.queue[progress.index + (action === 'previous' ? -1 : 1)];
      if (['next', 'previous'].includes(action) && (!target || (action === 'next' && !expected.selfEvaluation))) return;
      if (['sc-known', 'sc-review'].includes(action) && !expected.revealed) return;
      const patch = action === 'sc-reveal' ? { revealed: true } : action === 'sc-known' ? { selfEvaluation: 'known' } : action === 'sc-review' ? { selfEvaluation: 'review' } : null;
      try {
        // Navigation also checks the displayed version, but creates no answer.
        ingestLocal();
        const expectedNavigation = displayedSCNavigation;
        const result = patch ? await scStore.update(q, step, expected, patch) : await scStore.exclusive(() => {
          ingestLocal();
          if (!button.isConnected || !withoutChoices || active?.id !== q.id || active.steps[scIndex].id !== step.id) return { ok: false, departed: true };
          if (scStore.read(q, step).token !== expected.token || scNavigationVersion() !== expectedNavigation) return { ok: false };
          if (activeMix) selectMixedEntry(target); else selectCourseEntry(target);
          return { ok: true };
        });
        if (result.departed || !button.isConnected) return;
        if (!result.ok) {
          if (activeMix) openMix(); else if (activeCourse) openCourse(activeCourse);
          render(); toast('Le parcours ou la réponse a changé ailleurs. Il a été actualisé sans accepter cette action périmée.'); return;
        }
        render();
        if (result.current?.saved === false) toast(repo.warning);
        const focus = document.querySelector(action === 'sc-reveal' ? '.sc-expected' : '.qcm-step');
        focus?.focus({ preventScroll: true }); focus?.scrollIntoView({ block: 'nearest' });
      } catch (error) { toast(error.message); }
      return;
    }
    if (action === 'close-dialog') { button.closest('dialog')?.close(); return; }
    if (withoutChoices && active && ['open-context', 'open-hints'].includes(action)) {
      if (action === 'open-context' && !needsContext(active.steps[scIndex])) return;
      document.getElementById(action === 'open-context' ? 'qcm-context-dialog' : 'qcm-hint-dialog').showModal();
      markQuickSeen(displayedRun, action === 'open-context' ? 'context' : 'hints'); return;
    }
    if (action === 'open-context' && active && needsContext(active.steps[displayedRun?.index])) { const q = active; return mutateRun(q, displayedRun, run => { run.contextUsed = true; return run; }, run => { displayedRun = run; document.getElementById('qcm-context-dialog').showModal(); markQuickSeen(run, 'context'); }); }
    if (action === 'open-hints' && active) {
      const q = active;
      return mutateRun(q, displayedRun, run => { run.hintUsed = true; return run; }, run => { displayedRun = run; if (view === 'exercise' && active?.id === q.id) { document.getElementById('qcm-hint-dialog').showModal(); markQuickSeen(run, 'hints'); } });
    }
    if (button.dataset.choice && active) {
      const q = active, expected = displayedRun, step = q.steps[expected.index], choice = button.dataset.choice;
      if (expected.revealed[step.id] || button.dataset.step !== step.id || !step.choices.some(c => c.id === choice)) return;
      return mutateRun(q, expected, run => {
        run.answers[step.id] = choice; run.revealed[step.id] = true;
        run.checked = q.steps.every(s => run.revealed[s.id]); return run;
      }, run => {
        repo.grade({ id: q.id + '::' + step.id, contentRevision: q.qcmRevision }, choice === step.correctId ? 2 : 0, run.id, run.hintUsed);
        changed();
        if (view === 'exercise' && active?.id === q.id) { render(); const verdict = document.querySelector('.qcm-verdict'); verdict.focus({ preventScroll: true }); verdict.scrollIntoView({ block: 'nearest' }); }
      });
    }
    if (action === 'mix-first' && activeMix) { selectMixedEntry(mixedQueue(activeMix)[0]); render(); document.getElementById('qcm-main').focus(); return; }
    if (action === 'course-first' && activeCourse) { selectCourseEntry(courseQueue(activeCourse)[0]); render(); document.getElementById('qcm-main').focus(); return; }
    if (['next', 'previous'].includes(action) && active) {
      const q = active;
      if (activeCourse || activeMix) {
        const progress = coursePosition(q, displayedRun), target = progress.queue[progress.index + (action === 'next' ? 1 : -1)];
        if (!target || (action === 'next' && !displayedRun.revealed[q.steps[displayedRun.index].id])) return;
        return mutateRun(q, displayedRun, run => run, () => { if (activeMix) selectMixedEntry(target); else selectCourseEntry(target); render(); const field = document.querySelector('.qcm-step'); field.setAttribute('tabindex', '-1'); field.focus({ preventScroll: true }); field.scrollIntoView({ block: 'start' }); });
      }
      return mutateRun(q, displayedRun, run => {
        if (action === 'next' && run.revealed[q.steps[run.index].id]) run.index = Math.min(q.steps.length - 1, run.index + 1);
        if (action === 'previous') run.index = Math.max(0, run.index - 1);
        return run;
      }, () => { if (view === 'exercise' && active?.id === q.id) { render(); const field = document.querySelector('.qcm-step'); field.setAttribute('tabindex', '-1'); field.focus({ preventScroll: true }); field.scrollIntoView({ block: 'start' }); } });
    }
    if (action === 'restart' && active) {
      const q = active;
      return mutateRun(q, displayedRun, run => ({ id: S.uuid(), restartOf: run.id, answers: {}, order: Object.fromEntries(q.steps.map(s => [s.id, shuffled(s.choices.map(c => c.id))])), revealed: {}, index: 0, checked: false, hintUsed: false }), () => { if (view === 'exercise' && active?.id === q.id) { render(); document.querySelector('.qcm-step').scrollIntoView(); } });
    }
    if (action === 'backup') return download(exportPrefix + '-sauvegarde.json', { ...repo.state, scope: SCOPE });
    if (action === 'import') return document.getElementById('backup-file').click();
    if (action === 'export') return download(exportPrefix + '-retours.json', { ...S.feedbackBundle(repo.state, bank), scope: SCOPE });
    if (action === 'copy') {
      const report = HEPFeedback.report('Retours sur les QCM ' + (collection.subject || 'Français'), comments());
      try { await navigator.clipboard.writeText(report); toast('Retours copiés.'); } catch (_) { download(exportPrefix + '-retours.md', report, 'text/markdown'); } return;
    }
    if (action === 'disconnect') { HEPDrive.disconnect(); render(); return; }
    if (['connect', 'sync'].includes(action)) { button.disabled = true; try { if (action === 'connect') await HEPDrive.connect(); else await HEPDrive.sync(); render(); } catch (error) { button.disabled = false; toast(error.message); } }
  });
  window.addEventListener('hashchange', () => { if (bank) route(); });
  window.addEventListener('pagehide', () => {
    if (!withoutChoices || !active || !displayedSC) return;
    const field = document.getElementById('sc-response'), step = active.steps[scIndex];
    // A queued lock request may not run before this page is destroyed.
    if (field && field.value !== scStore.read(active, step).response) {
      try { scStore.retain(active, step, displayedSC, field.value); } catch (_) { /* Quota warnings already request an export. */ }
    }
  });
  window.addEventListener('storage', event => { if (event.key === KEY && event.newValue) { try { repo.ingest(JSON.parse(event.newValue)); status(); refreshRunControls(); } catch (_) { toast('La sauvegarde d’un autre onglet est illisible.'); } } });
  (async () => {
    try {
      if (IS_ORAL && !oralNavigation) throw new Error('Les thèmes du bloc oral sont indisponibles. Recharge la page en ligne.');
      const response = await fetch(collection.bank || 'data/qcm-pilote.json', { cache: 'no-cache' }); if (!response.ok) throw new Error('La banque QCM est indisponible.');
      bank = await response.json(); if (bank.id !== SCOPE || bank.schemaVersion !== 1 || !bank.exercises?.length || (SCOPE === 'fra-qcm-pilote' && bank.exercises.length !== 3)) throw new Error('Format QCM incompatible.');
      if (GROUPED_COURSES && !IS_ORAL && !Array.isArray(bank.courseGroups)) throw new Error('Parcours QCM absents.');
      if (bank.courseGroups && (!Array.isArray(bank.courseGroups) || !bank.courseGroups.length || new Set(bank.courseGroups.map(g => g.key)).size !== bank.courseGroups.length || !bank.courseGroups.every(g => typeof g.key === 'string' && /^[0-9]+(?:-[0-9]+)?$/.test(g.key) && typeof g.label === 'string') || !bank.exercises.every(q => bank.courseGroups.some(g => g.key === q.courseGroupKey) && typeof q.hasWrittenExercise === 'boolean'))) throw new Error('Parcours QCM incompatibles.');
      if (bank.navigationOrder) {
        const expected = new Set(bank.exercises.flatMap(q => q.steps.map(step => JSON.stringify([q.id, step.id]))));
        if (!Array.isArray(bank.navigationOrder) || bank.navigationOrder.length !== expected.size || new Set(bank.navigationOrder.map(ref => JSON.stringify([ref.exerciseId, ref.stepId]))).size !== expected.size || !bank.navigationOrder.every(ref => expected.has(JSON.stringify([ref.exerciseId, ref.stepId])))) throw new Error('Ordre de parcours incompatible.');
      }
      byId = new Map(bank.exercises.map(q => [q.id, q]));
      levelsEnabled = GROUPED_COURSES && bank.exercises.every(q => q.steps.every(step => ['essentiel', 'approfondissement'].includes(step.level)));
      if (levelsEnabled) restoreLevelChoice();
      HEPDrive.init(repo, status, () => { if (view !== 'exercise') render(); else refreshRunControls(); }); repo.save(); route();
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    } catch (error) { bank = null; app.innerHTML = `<section class="empty-state"><h1>Les QCM n’ont pas pu s’ouvrir.</h1><p>${esc(error.message)}</p><p>Reconnecte-toi puis recharge la page. Tes données restent dans ce navigateur.</p><a href="index.html">Retour aux matières</a></section>`; }
  })();
}());
