(function () {
  'use strict';
  const OPTIONS = window.EXERCISE_PAGE || {};
  const IS_ORAL = OPTIONS.scope === 'fra-oral';
  const S = HEPStore, KEY = OPTIONS.storageKey || 'hep-revisions-exercices-state-v1', SCOPE = OPTIONS.scope || 'fra01-pilote';
  const app = document.getElementById('app');
  // Reuse the tested repository without sharing the legacy bank's storage key.
  const storage = { getItem: () => localStorage.getItem(KEY), setItem: (_, value) => localStorage.setItem(KEY, value) };
  const repo = new S.Repository(storage);
  let bank, exercises, byId, view = 'overview', activeId = '', revealed = false;
  let selectedTheme = '', search = '', seriesCount = 4;
  const collectionName = IS_ORAL ? 'bloc oral' : 'pilote';
  // Navigation groups only: the pedagogical families and their identifiers stay intact.
  const ORAL_THEME_GROUPS = [
    { label: 'Repères et enseignement', themes: ['Fondements', 'Curriculum', 'Genres', 'Oral et écrit'] },
    { label: 'Acquisition et diversité', themes: ['Acquisition', 'Hétérogénéité'] },
    { label: 'Développement et langue', themes: ['Développement', 'Syntaxe'] },
    { label: 'Interactions et étayage', themes: ['Étayer', 'Interaction', 'Oralité'] },
    { label: 'Récits et compréhension', themes: ['Récit', 'Compréhension'] },
    { label: 'Dispositifs et régulation', themes: ['Argumentation', 'Dispositifs', 'Évaluer et réguler'] }
  ];
  const themeFor = family => ORAL_THEME_GROUPS.find(group => group.themes.includes(family.theme))?.label || family.theme;

  const categories = ['Consigne', 'Indice', 'Correction', 'Critères de réussite', 'Difficulté', 'Autre'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const text = value => `<span class="exercise-text">${esc(value)}</span>`;
  const comments = () => S.feedbackThreads(repo.state).filter(item => !item.deleted && item.comment.trim());
  const keyFor = (q, part) => q.id + '::' + q.contentRevision + '::' + part;
  const draft = key => repo.state.drafts[key]?.text || '';
  function writeDraft(key, value) {
    const previous = repo.state.drafts[key];
    repo.state.drafts[key] = { text: value, updatedAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString() };
    repo.save(); changed();
  }
  function criteriaState(q) {
    try { const result = JSON.parse(draft(keyFor(q, 'criteres')) || '{}'); return result && typeof result === 'object' && !Array.isArray(result) ? result : {}; }
    catch (_) { return {}; }
  }
  function snapshot(q) {
    return { module: q.module, course: q.course,
      question: q.title + '\n\n' + q.context + '\n\n' + q.prompt + '\n\nConditions de rédaction :\n' + bank.assessmentConditions.writingInstruction + '\n' + bank.assessmentConditions.learningInstruction + '\n' + bank.assessmentConditions.comparisonInstruction + '\n' + bank.assessmentConditions.providedDocumentsStatus + '\n' + bank.assessmentConditions.source.file + ' · ' + bank.assessmentConditions.source.location,
      answer: q.answer.summary + '\n\n' + q.answer.steps.map(s => s.title + '\n' + s.text).join('\n\n') + '\n\nPoints à vérifier :\n' + q.answer.pitfalls.join('\n') + '\n\nCritères :\n' + q.criteria.map(c => c.text).join('\n'),
      hint: q.hints.map((hint, i) => 'Indice ' + (i + 1) + ' : ' + hint).join('\n\n') };
  }
  function toast(message) {
    const node = document.getElementById('toast'); node.textContent = message; node.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.hidden = true; }, 5000);
  }
  function status() {
    document.querySelectorAll('[data-save-status]').forEach(node => { node.textContent = repo.warning || HEPDrive.status(); });
    document.querySelectorAll('[data-feedback-count]').forEach(node => { node.textContent = comments().length; });
    const node = document.getElementById('feedback-status');
    if (node) node.textContent = repo.warning || 'Retour enregistré sur cet appareil';
  }
  function changed() { status(); HEPDrive.schedule(); }
  function header() {
    if (IS_ORAL) return `<header class="site-header"><button class="brand" data-action="overview" aria-label="Accueil du bloc oral"><img class="brand-mark" src="icon.svg" alt=""><span><span class="brand-title">Français · Bloc oral</span><span class="brand-subtitle">Notions, situations et entraînement</span></span></button><nav class="header-actions" aria-label="Navigation du bloc oral"><button class="btn ghost" data-action="overview">Les notions</button><button class="btn ghost" data-action="retours">Mes retours <span class="badge" data-feedback-count>${comments().length}</span></button><button class="icon-button" data-action="sauvegardes" aria-label="Sauvegardes du bloc oral">↗</button></nav></header>`;
    return `<header class="site-header"><button class="brand" data-action="overview" aria-label="Accueil des six exercices"><img class="brand-mark" src="icon.svg" alt=""><span><span class="brand-title">Exercices pilotes</span><span class="brand-subtitle">Français · Cours 01</span></span></button><nav class="header-actions" aria-label="Navigation du pilote"><button class="btn ghost" data-action="overview">Les 6 exercices</button><button class="btn ghost" data-action="retours">Mes retours <span class="badge" data-feedback-count>${comments().length}</span></button><button class="icon-button" data-action="sauvegardes" aria-label="Sauvegardes du ${collectionName}">↗</button></nav></header>`;
  }
  function overview() {
    if (IS_ORAL) return oralOverview();
    const progress = S.mastery(repo.state, exercises), resume = repo.state.session;
    return `<section class="home-hero"><p class="eyebrow">Séance test · FRA 01</p><h1 class="hero-title">Analyser.<br>Expliquer. Essayer.</h1><p class="hero-description">Six exercices pour utiliser les notions du cours. Prends le temps de répondre, demande une aide si nécessaire, puis compare ton raisonnement au corrigé proposé.</p><div class="actions"><button class="btn primary" data-action="begin">${resume ? 'Reprendre le pilote' : 'Commencer par le premier exercice'}</button></div><p class="help-text">Choisis librement un exercice ci-dessous. Tu peux en faire un seul puis revenir plus tard : tes réponses sont conservées. Cette page contient uniquement le pilote.</p></section><section class="exercise-grid" aria-label="Les six exercices">${exercises.map((q, i) => `<article class="course-card exercise-tile"><span class="eyebrow">${String(i + 1).padStart(2, '0')} · ${esc(q.kind)}</span><h2>${esc(q.title)}</h2><span class="pill">${progress[q.id] ? ['À retravailler', 'À consolider', 'Critères remplis'][progress[q.id].grade] : 'À essayer'}</span><button class="btn secondary" data-exercise="${esc(q.id)}">Ouvrir l’exercice ${i + 1} →</button></article>`).join('')}</section><p class="notice">Le corrigé est une proposition de révision. Ton bilan repose sur ta propre comparaison, sans correction automatique de ton texte. Un passage te gêne ? Laisse un retour dans l’exercice.</p><p class="help-text"><a href="./">Retour à l’accueil général de Révisions HEP</a></p>`;
  }
  function filteredFamilies() {
    const query = search.toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return bank.families.filter(family => {
      const haystack = [family.title, family.theme, themeFor(family), ...exercises.filter(q => q.familyId === family.id).map(q => [q.title, q.prompt, ...q.hints].join(' '))].join(' ').toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return (!selectedTheme || themeFor(family) === selectedTheme) && (!query || haystack.includes(query));
    });
  }
  function oralFamily(family, progress) {
    return `<article class="oral-family"><h2>${esc(family.title)}</h2><div class="oral-variants">${exercises.filter(q => q.familyId === family.id).map(q => {
      const grade = progress[q.id] ? ['À retravailler', 'À consolider', 'Critères remplis'][progress[q.id].grade] : 'À essayer';
      return `<button class="btn secondary" data-exercise="${esc(q.id)}" title="${esc(q.title)}" aria-label="Situation ${q.variant} : ${esc(q.title)} · ${esc(grade)}"><span>Situation ${q.variant}</span><span class="small">${esc(grade)}</span></button>`;
    }).join('')}</div></article>`;
  }
  function oralOverview() {
    const families = filteredFamilies(), progress = S.mastery(repo.state, exercises);
    const themes = [...ORAL_THEME_GROUPS.map(group => group.label), ...bank.families.map(themeFor)].filter((theme, index, values) => values.indexOf(theme) === index && bank.families.some(f => themeFor(f) === theme));
    const groups = themes.map(theme => ({ theme, families: families.filter(f => themeFor(f) === theme) })).filter(group => group.families.length);
    return `<section class="home-hero oral-home-hero"><h1 class="hero-title">Réviser le bloc oral</h1><p class="hero-description">${exercises.length} situations · ${bank.families.length} capacités. Ouvre un thème ou lance une courte série.</p>${repo.state.session ? `<button class="btn primary" data-action="begin">${repo.state.session.mode === 'oral-serie' ? 'Reprendre ma série' : 'Reprendre l’exercice en cours'}</button>` : ''}</section>
      <p class="help-text"><a href="qcm.html">Essayer les QCM guidés · 3 exercices →</a></p>
      <div class="oral-tools"><form class="oral-filters" id="oral-filters"><label class="oral-field" for="oral-theme">Thème<select class="select-input" id="oral-theme"><option value="">Tout le bloc oral</option>${themes.map(theme => `<option ${selectedTheme === theme ? 'selected' : ''}>${esc(theme)}</option>`).join('')}</select></label><label class="oral-field" for="oral-search">Rechercher<input class="text-input" id="oral-search" type="search" value="${esc(search)}" placeholder="Ex. : lexique, récit, bilinguisme…"></label><button class="btn secondary" type="submit">Afficher les notions</button></form>
      <section class="oral-series"><label class="oral-field" for="series-count">Ma série d’entraînement<select class="select-input" id="series-count">${[[4,'4 exercices'],[8,'8 exercices'],[12,'12 exercices'],[0,'Toutes les notions affichées']].map(([n,label]) => `<option value="${n}" ${seriesCount === n ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button class="btn primary" data-action="start-series" ${families.length ? '' : 'disabled'}>Lancer une série</button><p class="help-text">Une situation par capacité ; les variantes les moins travaillées passent en premier.</p></section></div>
      <p class="help-text oral-result-count">${families.length} capacité${families.length > 1 ? 's' : ''} · ${groups.length} thème${groups.length > 1 ? 's' : ''}</p><section class="oral-groups" aria-label="Thèmes et situations">${groups.map(group => `<details class="oral-group" ${selectedTheme || search ? 'open' : ''}><summary><span>${esc(group.theme)}</span><span class="oral-group-count">${group.families.length} capacités</span></summary><div class="oral-group-content">${group.families.map(family => oralFamily(family, progress)).join('')}</div></details>`).join('') || '<p class="empty-state">Aucune notion ne correspond à cette recherche.</p>'}</section>
      ${bank.limitations?.length ? `<details class="hint-panel"><summary>Ce que cet entraînement permet de travailler</summary><ul>${bank.limitations.map(value => `<li>${esc(value)}</li>`).join('')}</ul></details>` : ''}<p class="help-text"><a href="exercices.html">Retrouver les six exercices pilotes</a> · <a href="./">Accueil Révisions HEP</a></p>`;
  }
  function shuffle(items) {
    const values = [...items];
    for (let i = values.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [values[i], values[j]] = [values[j], values[i]]; }
    return values;
  }
  function startSeries() {
    const ids = shuffle(filteredFamilies()).map(family => {
      const variants = shuffle(exercises.filter(q => q.familyId === family.id));
      variants.sort((a,b) => S.attemptsFor(repo.state,[a]).length - S.attemptsFor(repo.state,[b]).length);
      return variants[0].id;
    }).slice(0, seriesCount || undefined);
    if (!ids.length) return;
    repo.setSession({ id: S.uuid(), startedAt: new Date().toISOString(), mode: 'oral-serie', ids, index: 0 });
    changed(); navigate(ids[0]);
  }
  function correction(q) {
    const values = criteriaState(q);
    return `<section class="answer-card"><p class="eyebrow">Comparer et comprendre</p><h2 class="answer-title">Corrigé proposé</h2><p>${text(q.answer.summary)}</p>${q.answer.steps.map(step => `<div class="correction-step"><h3>${esc(step.title)}</h3><p>${text(step.text)}</p></div>`).join('')}<details class="correction-pitfalls"><summary>Points à vérifier dans mon raisonnement</summary><ul>${q.answer.pitfalls.map(value => `<li>${esc(value)}</li>`).join('')}</ul></details></section><section class="criteria-panel"><h2>Je compare ma réponse</h2><p class="help-text">Pour chaque critère, indique ce qui figurait dans ta réponse. Tu peux ensuite la compléter.</p>${q.criteria.map((criterion, i) => `<div class="criterion-row"><label class="field-label" for="criterion-${i}">${esc(criterion.text)}</label><select class="select-input" id="criterion-${i}" data-criterion="${esc(criterion.id)}"><option value="" disabled ${![0, 1, 2].includes(values[criterion.id]) ? 'selected' : ''}>À évaluer</option><option value="0" ${values[criterion.id] === 0 ? 'selected' : ''}>À retravailler</option><option value="1" ${values[criterion.id] === 1 ? 'selected' : ''}>Partiellement</option><option value="2" ${values[criterion.id] === 2 ? 'selected' : ''}>Oui, présent et justifié</option></select></div>`).join('')}<p class="save-status" id="criteria-status" aria-live="polite">${q.criteria.every(c => [0, 1, 2].includes(values[c.id])) ? 'Ton bilan est enregistré.' : 'Ton bilan sera enregistré lorsque tous les critères seront renseignés.'}</p></section>`;
  }
  function writingConditions() {
    const conditions = bank.assessmentConditions;
    return `<aside class="writing-conditions"><p class="help-text">${text(conditions.writingInstruction)}</p><details class="hint-panel"><summary>Repères pour cet entraînement</summary><p>${text(conditions.learningInstruction)}</p><p>${text(conditions.comparisonInstruction)}</p><p>${text(conditions.providedDocumentsStatus)}</p><p class="exercise-origin">${esc(conditions.source.file)} · ${esc(conditions.source.location)}</p></details></aside>`;
  }
  function courseReference(q) {
    const reference = bank.courseReferences?.[q.referenceId] || bank.courseReference;
    if (!reference) return '';
    const synthesis = q.sources?.find(source => source.file.includes('SYNTHESE') && source.file.endsWith('.docx'));
    const reading = synthesis || q.sources?.find(source => /cours|seminaire|séminaire|diaporama/i.test(source.file)) || q.sources?.[0];
    const family = bank.families?.find(item => item.id === q.familyId);
    return `<p class="exercise-origin"><span>${esc(reference.label)} · ${esc(reference.date)}</span>${reading ? `<span>${synthesis ? 'À relire dans la synthèse' : 'Repère dans le support'} : ${esc(reading.location)}</span>` : ''}${family?.operation ? `<span>À travailler : ${esc(family.operation)}</span>` : ''}</p>`;
  }
  function exerciseView() {
    const q = byId.get(activeId), ids = IS_ORAL ? repo.state.session.ids : exercises.map(item => item.id), index = ids.indexOf(q.id);
    const saved = S.currentFeedback(repo.state, q, snapshot(q));
    const comment = saved && !saved.deleted ? saved.comment : '';
    return `<section class="question-shell"><div class="question-topline"><button class="btn ghost" data-action="overview">← ${IS_ORAL ? 'Les notions' : 'Les 6 exercices'}</button><span class="question-counter">Exercice ${index + 1} / ${ids.length}</span></div><div class="progress-track" role="progressbar" aria-label="Position dans la série" aria-valuemin="1" aria-valuemax="${ids.length}" aria-valuenow="${index + 1}"><div class="progress-fill" style="width:${100 * (index + 1) / ids.length}%"></div></div><article class="question-card"><p class="eyebrow">${esc(q.kind)}</p><h1 class="exercise-title">${esc(q.title)}</h1>${courseReference(q)}<div class="exercise-context">${text(q.context)}</div><div class="exercise-prompt question-content">${text(q.prompt)}</div>${writingConditions()}<details class="hint-panel" id="hint-one"><summary>Une première piste</summary><p>${text(q.hints[0])}</p><details class="second-hint" id="hint-two"><summary>J’ai besoin d’une aide plus précise</summary><p>${text(q.hints[1])}</p></details></details><section class="exercise-response"><label class="field-label" for="exercise-answer">Ma réponse</label><textarea class="text-input" id="exercise-answer" rows="6" maxlength="12000" placeholder="Ton analyse, les indices qui l’appuient, ton explication…">${esc(draft(keyFor(q, 'reponse')))}</textarea><p class="help-text">Tu peux aussi répondre sur papier ou à voix haute. L’écriture ici est facultative.</p></section>${revealed ? correction(q) : '<button class="btn primary" data-action="reveal">Comparer avec le corrigé</button>'}</article><details class="feedback-panel" ${comment ? 'open' : ''}><summary>Mon retour sur cet exercice${comment ? ' · enregistré' : ''}</summary><p class="muted">Qu’est-ce qui t’a aidé ? Qu’est-ce qui serait à changer ?</p><label class="field-label" for="feedback-category">Cela concerne…</label><select class="select-input" id="feedback-category">${categories.map(category => `<option ${saved?.category === category ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select><label class="field-label" for="feedback-comment">Mon commentaire</label><textarea class="feedback-textarea" id="feedback-comment" rows="4" maxlength="8000" placeholder="Ex. : le deuxième indice donne la réponse ; le corrigé ne m’aide pas à comprendre cette étape…">${esc(comment)}</textarea><p class="save-status" id="feedback-status" aria-live="polite">${comment ? 'Retour enregistré sur cet appareil' : 'Enregistrement automatique dès la saisie'}</p></details><div class="question-navigation"><button class="btn secondary" data-exercise="${index ? ids[index - 1] : ''}" ${index ? '' : 'disabled'}>← Précédent</button>${index + 1 < ids.length ? `<button class="btn primary" data-exercise="${esc(ids[index + 1])}">Exercice suivant →</button>` : `<button class="btn primary" data-action="finish">Terminer ${IS_ORAL ? 'la série' : 'le pilote'}</button>`}</div></section>`;
  }
  function feedbackView() {
    const items = comments().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return `<div class="section-heading"><h1>Mes retours sur le ${collectionName}</h1></div><p class="muted">Chaque commentaire conserve l’énoncé, les indices, le corrigé et les critères de cet exercice. Copie-les ici pour nous les transmettre dans la discussion HEP.</p><div class="actions"><button class="btn primary" data-action="copy" ${items.length ? '' : 'disabled'}>Copier les retours du ${collectionName}</button><button class="btn secondary" data-action="export" ${items.length ? '' : 'disabled'}>Télécharger les retours</button></div><div class="feedback-list">${items.map(item => `<article class="feedback-item"><div class="feedback-item-header"><span class="pill">${esc(item.category)}</span><span class="small muted">${esc(new Date(item.updatedAt).toLocaleDateString('fr-CH'))}</span></div><h2>${esc(item.snapshot.question.split('\n')[0])}</h2><p class="exercise-text">${esc(item.comment)}</p>${byId.has(item.questionId) ? `<button class="btn ghost" data-exercise="${esc(item.questionId)}">Revoir l’exercice actuel →</button>` : '<p class="help-text">Le retour de cette ancienne version est conservé.</p>'}</article>`).join('') || '<p class="empty-state">Tes retours apparaîtront ici. Tu peux en laisser un avant ou après avoir ouvert le corrigé.</p>'}</div>`;
  }
  function settings() {
    return `<h1>Sauvegardes du ${collectionName}</h1><section class="settings-card"><h2>Sur cet appareil</h2><p>Tes réponses, tes bilans par critère et tes retours s’enregistrent dans ce navigateur. Les données de cet entraînement sont séparées de celles des anciennes questions.</p><div class="actions"><button class="btn primary" data-action="backup">Télécharger une sauvegarde</button><button class="btn secondary" data-action="import">Importer une sauvegarde du ${collectionName}</button><input id="backup-file" type="file" accept=".json,application/json" hidden></div><p class="help-text">L’import réunit tes données. L’effacement des données du navigateur supprime la copie locale.</p></section><section class="settings-card"><h2>Google Drive, facultatif</h2><p>Connecte le même compte sur tes appareils pour réunir tes retours. Les sauvegardes de ces exercices utilisent leur propre dossier « ${IS_ORAL ? 'Révisions HEP — Bloc oral' : 'Révisions HEP — Exercices'} ».</p><div class="actions">${HEPDrive.connected() ? '<button class="btn primary" data-action="sync">Synchroniser maintenant</button><button class="btn ghost" data-action="disconnect">Déconnecter</button>' : '<button class="btn primary" data-action="connect">Connecter Google Drive</button>'}</div><p class="save-status" data-save-status>${esc(HEPDrive.status())}</p><p class="help-text">Les commentaires ne sont pas transmis automatiquement aux agents. La connexion Google est à renouveler après fermeture.</p></section>`;
  }
  function summary() {
    const progress = Object.values(S.mastery(repo.state, exercises));
    return `<section class="review-summary"><p class="eyebrow">Bilan du ${collectionName}</p><h1>Qu’est-ce que ces exercices t’ont apporté ?</h1><p class="hero-description">Tu as renseigné tous les critères de ${progress.length} exercice${progress.length > 1 ? 's' : ''} sur ${exercises.length}.</p><div class="stats-grid">${[0, 1, 2].map((grade, i) => `<div class="stat"><span class="stat-number">${progress.filter(a => a.grade === grade).length}</span><span class="stat-label">${['à retravailler', 'à consolider', 'critères remplis'][i]}</span></div>`).join('')}</div><p class="muted">Tes réponses et tes retours sont conservés. Tu peux reprendre un exercice ou nous transmettre tes commentaires.</p><div class="actions"><button class="btn primary" data-action="retours">Relire mes retours</button><button class="btn secondary" data-action="overview">${IS_ORAL ? 'Revoir les notions' : 'Revoir les six exercices'}</button></div></section>`;
  }
  function render(focus = false) {
    const content = view === 'exercise' ? exerciseView() : view === 'retours' ? feedbackView() : view === 'sauvegardes' ? settings() : view === 'bilan' ? summary() : overview();
    app.innerHTML = `<div class="page">${header()}<div id="main-content" tabindex="-1">${content}</div><footer class="footer"><span class="save-status" data-save-status>${esc(repo.warning || HEPDrive.status())}</span><button class="btn ghost small" data-action="sauvegardes">Sauvegardes du ${collectionName}</button></footer></div>`;
    bind();
    if (focus) { document.getElementById('main-content').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  }
  function openExercise(id) {
    if (!byId.has(id)) return;
    activeId = id; view = 'exercise'; revealed = false;
    const previous = repo.state.session;
    const session = previous && (!IS_ORAL || previous.ids.includes(id)) ? previous : { id: S.uuid(), startedAt: new Date().toISOString(), mode: IS_ORAL ? 'oral-libre' : 'pilot', ids: exercises.map(q => q.id) };
    if (!IS_ORAL) session.ids = exercises.map(q => q.id);
    session.index = session.ids.indexOf(id);
    repo.setSession(session); changed(); render(true);
  }
  function route() {
    let hash; try { hash = decodeURIComponent(location.hash.slice(1)); } catch (_) { hash = ''; }
    if (byId.has(hash)) return openExercise(hash);
    view = ['retours', 'sauvegardes', 'bilan'].includes(hash) ? hash : 'overview'; activeId = ''; revealed = false; render(true);
  }
  function navigate(target) {
    const hash = target === 'overview' ? '' : target;
    if (location.hash.slice(1) === hash) route(); else location.hash = hash;
  }
  function download(name, value, mime = 'application/json') {
    const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: mime + ';charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function bundle() { return { ...S.feedbackBundle(repo.state, bank), scope: SCOPE }; }
  function report() {
    return (IS_ORAL ? '# Retours sur le bloc oral FRA\n\n' : '# Retours sur les exercices pilotes FRA 01\n\n') + bundle().feedback.map((item, i) => `## ${i + 1}. ${item.category}\n\n${item.snapshot.question}\n\nIndices :\n${item.snapshot.hint}\n\nCorrigé et critères :\n${item.snapshot.answer}\n\nMON RETOUR : ${item.comment}\n\nRéférence : ${item.questionId} · ${item.contentRevision}\n`).join('\n');
  }
  function bind() {
    document.getElementById('oral-filters')?.addEventListener('submit', event => {
      event.preventDefault(); selectedTheme = document.getElementById('oral-theme').value;
      search = document.getElementById('oral-search').value.trim(); render();
    });
    document.getElementById('series-count')?.addEventListener('change', event => { seriesCount = Number(event.target.value); });
    if (view === 'exercise') {
      const q = byId.get(activeId);
      document.getElementById('exercise-answer').addEventListener('input', event => writeDraft(keyFor(q, 'reponse'), event.target.value));
      ['hint-one', 'hint-two'].forEach(id => document.getElementById(id).addEventListener('toggle', event => {
        if (event.target.open && repo.state.session) writeDraft(keyFor(q, 'aide-' + repo.state.session.id), 'true');
      }));
      const saveComment = () => { repo.comment(q, document.getElementById('feedback-category').value, document.getElementById('feedback-comment').value, snapshot(q)); changed(); };
      document.getElementById('feedback-comment').addEventListener('input', saveComment);
      document.getElementById('feedback-category').addEventListener('change', saveComment);
      document.querySelectorAll('[data-criterion]').forEach(node => node.addEventListener('change', event => {
        const values = criteriaState(q); values[event.target.dataset.criterion] = Number(event.target.value);
        writeDraft(keyFor(q, 'criteres'), JSON.stringify(values));
        if (q.criteria.every(c => [0, 1, 2].includes(values[c.id]))) {
          const scores = q.criteria.map(c => values[c.id]);
          repo.grade(q, Math.min(...scores), repo.state.session.id, draft(keyFor(q, 'aide-' + repo.state.session.id)) === 'true');
          document.getElementById('criteria-status').textContent = 'Ton bilan est enregistré.'; changed();
        }
      }));
    }
    document.getElementById('backup-file')?.addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      try {
        if (file.size > 25 * 1024 * 1024) throw new Error('Ce fichier est trop volumineux.');
        const raw = JSON.parse(await file.text());
        if (raw.scope !== SCOPE) throw new Error(IS_ORAL ? 'Choisis une sauvegarde du bloc oral FRA.' : 'Choisis une sauvegarde des exercices pilotes FRA 01.');
        repo.import(raw); changed(); render(); toast(`Sauvegarde du ${collectionName} réunie avec tes données.`);
      } catch (error) { toast(error.message); }
    });
  }
  app.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button || button.disabled || !bank) return;
    if (button.dataset.exercise) return navigate(button.dataset.exercise);
    const action = button.dataset.action;
    if (action === 'start-series') return startSeries();
    if (['overview', 'retours', 'sauvegardes'].includes(action)) return navigate(action);
    if (action === 'begin') return navigate(repo.state.session?.ids[repo.state.session.index] || exercises[0].id);
    if (action === 'reveal') { revealed = true; render(); document.querySelector('.answer-card').scrollIntoView({ block: 'start', behavior: 'instant' }); return; }
    if (action === 'finish') { repo.setSession(null); changed(); navigate('bilan'); return; }
    if (action === 'backup') return download((IS_ORAL ? 'FRA-oral-sauvegarde.json' : 'exercices-FRA01-sauvegarde.json'), { ...repo.state, scope: SCOPE });
    if (action === 'import') return document.getElementById('backup-file').click();
    if (action === 'export') return download((IS_ORAL ? 'FRA-oral-retours.json' : 'exercices-FRA01-retours.json'), bundle());
    if (action === 'copy') {
      try { await navigator.clipboard.writeText(report()); toast('Retours copiés. Colle-les dans notre discussion HEP.'); }
      catch (_) { download((IS_ORAL ? 'FRA-oral-retours.md' : 'exercices-FRA01-retours.md'), report(), 'text/markdown'); toast('Rapport téléchargé.'); }
      return;
    }
    if (action === 'disconnect') { HEPDrive.disconnect(); render(); return; }
    if (action === 'connect' || action === 'sync') {
      button.disabled = true;
      try { if (action === 'connect') await HEPDrive.connect(); else await HEPDrive.sync(); render(); }
      catch (error) { toast(error.message); button.disabled = false; }
    }
  });
  window.addEventListener('hashchange', () => { if (bank) route(); });
  window.addEventListener('storage', event => {
    if (event.key !== KEY || !event.newValue) return;
    try { repo.ingest(JSON.parse(event.newValue)); status(); } catch (_) { toast('La sauvegarde d’un autre onglet est illisible.'); }
  });
  async function init() {
    try {
      const response = await fetch(OPTIONS.bankUrl || 'data/exercices-fra01.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('Les exercices n’ont pas pu être chargés.');
      bank = await response.json();
      if (bank.schemaVersion !== 1 || bank.id !== SCOPE || !Array.isArray(bank.exercises) || (!IS_ORAL && bank.exercises.length !== 6) || (IS_ORAL && (!bank.families?.length || !bank.exercises.length))) throw new Error('Le format des exercices est incompatible.');
      exercises = bank.exercises; byId = new Map(exercises.map(q => [q.id, q]));
      if (IS_ORAL) {
        try {
          const pilot = !localStorage.getItem(KEY) && localStorage.getItem('hep-revisions-exercices-state-v1');
          if (pilot) {
            const previous = S.normalize(JSON.parse(pilot));
            for (const kind of ['attempts', 'feedback']) previous[kind] = Object.fromEntries(Object.entries(previous[kind]).filter(([,record]) => byId.has(record.questionId)));
            previous.drafts = Object.fromEntries(Object.entries(previous.drafts).filter(([id]) => byId.has(id.split('::')[0])));
            previous.session = null; previous.sessionUpdatedAt = new Date().toISOString();
            repo.state = previous; repo.deviceId = previous.deviceId;
          }
        } catch (_) { /* The pilot remains untouched if its local copy cannot be read. */ }
      }
      if (repo.state.session && repo.state.session.ids.some(id => !byId.has(id))) repo.setSession(null);
      HEPDrive.init(repo, status, () => { if (view !== 'exercise') render(); });
      repo.save(); route();
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    } catch (error) {
      bank = null; app.innerHTML = `<div class="page"><section class="empty-state"><h1>Les exercices n’ont pas pu s’ouvrir.</h1><p>${esc(error.message)}</p><p>Reconnecte-toi puis recharge la page. Tes données déjà enregistrées restent dans ce navigateur.</p><button class="btn primary" id="retry">Réessayer</button></section></div>`;
      document.getElementById('retry').onclick = () => location.reload();
    }
  }
  init();
}());
