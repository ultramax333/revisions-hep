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
  const stepDone = item => withoutChoices ? !!firstRecord(item.q, item.step) : !!readRun(item.q).revealed[item.step.id];
  const questionLabel = () => withoutChoices ? 'questions sans les choix' : 'QCM';
  function modeControls() {
    if (!GROUPED_COURSES) return '';
    return `<div class="segment-row"><span class="segment-label" id="qcm-mode-label">Mode</span><div class="qcm-mode-switch segmented" role="group" aria-labelledby="qcm-mode-label"><button type="button" class="segment" data-action="mode-qcm" aria-pressed="${!withoutChoices}">${segmentText('QCM', 'Choisir parmi 4 réponses')}</button><button type="button" class="segment" data-action="mode-sc" aria-pressed="${withoutChoices}">${segmentText('Sans les choix', 'Répondre seul, puis comparer')}</button></div></div>`;
  }
  // v25 : chaque option porte une légende courte, toujours visible (AGENTS §2, postulat iPhone).
  const segmentText = (title, help) => `<span class="segment-text"><span class="segment-title">${esc(title)}</span><span class="segment-help">${esc(help)}</span></span>`;
  let levelsEnabled = false, threeTiers = false, levelFilter = 'essentiel', ancientOnly = false, unseenOnly = false, emptyPathMessage = '';
  // v26 : trois étages emboîtés (REGLES §5.10, AGENTS §2). Niveau des données : essentiel (étage 1),
  // essentiel-approfondi (étage 2), approfondissement (étage 3). Choix enregistré : « essentiel » (étage 1),
  // « approfondi » (étages 1 et 2, interrupteur « + Approfondir »), « tout » (Tout le bloc).
  // Une banque sans essentiel-approfondi garde ses deux niveaux (Essentiel / Tout), comme en v25.
  const TWO_LEVELS = ['essentiel', 'approfondissement'], THREE_LEVELS = ['essentiel', 'essentiel-approfondi', 'approfondissement'];
  const LEVEL_NAMES = { essentiel: 'Essentiel', 'essentiel-approfondi': 'Essentiel approfondi', approfondissement: 'Approfondissement' };
  const inLevel = (step, filter = levelFilter) => !levelsEnabled || filter === 'tout' || step.level === 'essentiel' || (threeTiers && filter === 'approfondi' && step.level === 'essentiel-approfondi');
  // « Anciens examens » ignore l'étage choisi quand la banque a trois étages (AGENTS §2).
  const ancientAllTiers = () => threeTiers && ancientOnly;
  const levelChoiceLabel = () => ancientAllTiers() ? 'Anciens examens · tous les étages' : threeTiers ? ({ essentiel: 'Essentiel', approfondi: 'Essentiel + approfondi', tout: 'Tout le bloc' })[levelFilter] : levelFilter === 'tout' ? 'Tout' : 'Essentiel';
  // « Approfondir ce savoir » : parcours propre à cet onglet (sessionStorage), qui ramène ensuite au parcours quitté.
  const DEEPEN_KEY = 'approfondir', DEEPEN_LABEL = 'Approfondir ce savoir', DEEPEN_STORE = 'hep-revisions-qcm-deepen-v1::' + SCOPE;
  let deepen = (() => { try { const v = JSON.parse(sessionStorage.getItem(DEEPEN_STORE) || 'null'); return v && typeof v.attenteId === 'string' && typeof v.returnHash === 'string' ? v : null; } catch (_) { return null; } })();
  function setDeepen(value) {
    deepen = value;
    try { if (value) sessionStorage.setItem(DEEPEN_STORE, JSON.stringify(value)); else sessionStorage.removeItem(DEEPEN_STORE); } catch (_) { /* Le parcours reste en mémoire. */ }
  }
  // v25 : « Revoir, ne pas revoir, refaire » (AGENTS §2).
  const ERRORS_KEY = 'erreurs', ERRORS_LABEL = 'Mes erreurs et difficiles';
  const PRESENTED_KEY = 'hep-revisions-qcm-presented-v1::' + SCOPE;
  let frozen = null, practiceCache = null;
  // Présentation d'une question déjà faite, propre à cet onglet (sessionStorage) : « first » juste après
  // la première réponse (gardée au rechargement), « review » (Revoir ma réponse), « practice » (nouvelle
  // tentative), sinon « hidden » : la question se rouvre sans réponse ni correction.
  let presented = (() => { try { const v = JSON.parse(sessionStorage.getItem(PRESENTED_KEY) || 'null'); return v && typeof v.key === 'string' ? v : null; } catch (_) { return null; } })();
  function setPresented(value) {
    presented = value;
    try { if (value) sessionStorage.setItem(PRESENTED_KEY, JSON.stringify(value)); else sessionStorage.removeItem(PRESENTED_KEY); } catch (_) { /* La présentation reste en mémoire. */ }
  }
  const presentedKey = (q, step) => (withoutChoices ? 'sc::' : 'qcm::') + q.id + '::' + q.qcmRevision + '::' + step.id + (withoutChoices ? '' : '::' + readRun(q).id);
  // Nouvelles tentatives : une entrée par tentative, clé unique, jamais réécrite (l'historique n'est pas effacé).
  const practicePrefix = (kind, q, step, rev = q.qcmRevision) => (kind === 'sc' ? 'sc-practice::' : 'qcm-practice::') + q.id + '::' + rev + '::' + step.id + '::';
  // v26 : une famille change de révision dès qu'une de ses questions est ajoutée, retirée ou modifiée. Pour chaque question
  // inchangée, l'exporteur liste les révisions antérieures où elle était identique (compatibleRevisions) : ses réponses,
  // tentatives et autoévaluations faites sous ces révisions restent les siennes. Rien n'est copié ni effacé dans le stockage.
  const compatRevs = (q, step) => Array.isArray(step?.compatibleRevisions) ? step.compatibleRevisions.filter(rev => typeof rev === 'string' && /^[0-9a-f]{1,64}$/.test(rev) && rev !== q.qcmRevision) : [];
  // Correction après contrôle Codex : la réponse libre d'une tentative Sans les choix est stockée en texte brut
  // (`sc-practice-text::…`, comme `sc-text::`), à côté de ses métadonnées JSON courtes (`sc-practice::…`) :
  // 8 000 caractères, guillemets compris, tiennent dans la limite de 12 000 d'un brouillon sans échappement.
  const MAX_DRAFT = 12000, MAX_RESPONSE = 8000;
  const practiceTextKey = key => 'sc-practice-text::' + key.slice('sc-practice::'.length);
  function practiceList(kind, q, step) {
    if (!practiceCache || practiceCache.drafts !== repo.state.drafts) {
      const index = new Map();
      for (const [key, draft] of Object.entries(repo.state.drafts)) {
        if (!key.startsWith('qcm-practice::') && !key.startsWith('sc-practice::')) continue;
        let value; try { value = JSON.parse(draft.text); } catch (_) { continue; }
        if (!value || value.v !== 1 || typeof value.at !== 'string' || !Number.isFinite(Date.parse(value.at))) continue;
        if (key.startsWith('sc-practice::') && typeof value.response !== 'string') {
          const raw = repo.state.drafts[practiceTextKey(key)]?.text;
          if (typeof raw !== 'string' || value.responseHash !== S.fingerprint(raw)) continue;
          value = { ...value, response: raw };
        }
        const base = key.slice(0, key.lastIndexOf('::') + 2);
        if (!index.has(base)) index.set(base, []);
        index.get(base).push(value);
      }
      index.forEach(list => list.sort((a, b) => a.at.localeCompare(b.at)));
      practiceCache = { drafts: repo.state.drafts, index };
    }
    const lists = [q.qcmRevision, ...compatRevs(q, step)].map(rev => practiceCache.index.get(practicePrefix(kind, q, step, rev)) || []);
    return lists.length === 1 ? lists[0] : lists.flat().sort((a, b) => a.at.localeCompare(b.at));
  }
  // Écritures de la v25 sous le même verrou que les essais et Sans les choix (« <collection>-edit ») :
  // deux onglets ne peuvent plus lire puis réécrire l'état en même temps.
  const exclusive = perform => scStore ? scStore.exclusive(perform) : navigator.locks ? navigator.locks.request(SCOPE + '-edit', perform) : Promise.resolve().then(perform);
  // Écritures propres à cet onglet, vérifiées après coup : un autre onglet qui a écrit à partir d'une copie
  // périmée de localStorage (propagation asynchrone entre processus) ne peut pas les effacer durablement.
  const ownWrites = new Map();
  let verifyTimer = null;
  function rememberOwn(...keys) {
    keys.forEach(key => { const draft = repo.state.drafts[key]; if (draft) ownWrites.set(key, { ...draft }); });
    scheduleVerify();
  }
  function scheduleVerify(delay = 1200) { clearTimeout(verifyTimer); verifyTimer = setTimeout(() => verifyOwn(), delay); }
  function missingOwn(drafts) {
    for (const [key, draft] of ownWrites) { const stored = drafts?.[key]; if (!stored || stored.updatedAt < draft.updatedAt) return true; }
    return false;
  }
  function verifyOwn(storedRaw) {
    if (!ownWrites.size) return Promise.resolve(false);
    let stored; try { stored = JSON.parse(storedRaw ?? localStorage.getItem(KEY) ?? 'null'); } catch (_) { stored = null; }
    if (!missingOwn(stored?.drafts)) return Promise.resolve(false);
    return exclusive(() => {
      ingestLocal();
      for (const [key, draft] of ownWrites) { const current = repo.state.drafts[key]; if (!current || current.updatedAt < draft.updatedAt) repo.state.drafts[key] = { ...draft }; }
      repo.save(); changed(); return true;
    }).then(repaired => { scheduleVerify(); return repaired; }).catch(() => false);
  }
  function addPractice(kind, q, step, value, response) {
    // Limite explicite, jamais de troncature : au-delà, rien n'est écrit et un message le dit.
    if (response !== undefined && (typeof response !== 'string' || response.length > MAX_RESPONSE)) return Promise.reject(Error('Ta réponse dépasse 8 000 caractères. Elle n’a pas été enregistrée ni tronquée ; raccourcis-la ou copie-la ailleurs.'));
    return exclusive(() => {
      ingestLocal();
      const key = practicePrefix(kind, q, step) + S.uuid(), at = new Date().toISOString();
      const meta = JSON.stringify({ v: 1, at, ...value, ...(response !== undefined ? { responseHash: S.fingerprint(response) } : {}) });
      if (meta.length > MAX_DRAFT || key.length > 200) throw Error('Cette tentative ne peut pas être enregistrée dans ce format. Rien n’a été tronqué.');
      if (response !== undefined) repo.state.drafts[practiceTextKey(key)] = { text: response, updatedAt: at };
      repo.state.drafts[key] = { text: meta, updatedAt: at };
      const saved = repo.save(); changed();
      rememberOwn(key, ...(response !== undefined ? [practiceTextKey(key)] : []));
      if (!saved) throw Error(repo.warning || 'Enregistrement local indisponible : télécharge une sauvegarde.');
    });
  }
  // ---------- 3 : première autoévaluation Sans les choix figée ----------
  // La v24 réécrit son enregistrement `sc-meta` (même clé, génération suivante) quand on retouche « Je savais » /
  // « À revoir ». Dès qu'elle voit une première autoévaluation (chargement, autre onglet, import, Drive, sa propre
  // action), la v25 en fait une copie immuable `sc-first::…` + `sc-first-text::…`, que la v24 ignore et ne réécrit
  // jamais. Toute lecture du « premier résultat » passe par cette copie.
  const scIdentity = (q, step) => q.id + '::' + step.id + '::' + q.qcmRevision;
  function frozenFirst(q, step) {
    const id = scIdentity(q, step), meta = repo.state.drafts['sc-first::' + id], raw = repo.state.drafts['sc-first-text::' + id];
    if (!meta || !raw) return null;
    try {
      const v = JSON.parse(meta.text);
      if (v?.v !== 1 || !['known', 'review'].includes(v.selfEvaluation) || v.responseHash !== S.fingerprint(raw.text)) return null;
      return { selfEvaluation: v.selfEvaluation, response: raw.text, revealed: true, updatedAt: stampOf(v.at), frozen: true };
    } catch (_) { return null; }
  }
  const stampOf = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : '1970-01-01T00:00:00.000Z';
  function firstRecord(q, step) {
    const frozenOne = frozenFirst(q, step);
    if (frozenOne) return frozenOne;
    const record = scStore?.read(q, step);
    if (record?.selfEvaluation) return record;
    for (const rev of compatRevs(q, step)) {
      const old = { ...q, qcmRevision: rev }, before = scStore?.read(old, step);
      const inherited = frozenFirst(old, step) || (before?.selfEvaluation ? before : null);
      if (inherited) return { ...inherited, inherited: rev };
    }
    return null;
  }
  function freezeFirsts() {
    if (!scStore || !GROUPED_COURSES || !bank) return Promise.resolve(0);
    return exclusive(() => {
      ingestLocal();
      let added = 0;
      const at = new Date().toISOString(), frozenKeys = [];
      for (const exercise of bank.exercises) for (const step of exercise.steps) for (const q of [exercise, ...compatRevs(exercise, step).map(rev => ({ ...exercise, qcmRevision: rev }))]) {
        if (step.sansChoix !== true || frozenFirst(q, step)) continue;
        const record = scStore.read(q, step);
        if (!record.selfEvaluation) continue;
        const id = scIdentity(q, step);
        repo.state.drafts['sc-first-text::' + id] = { text: record.response, updatedAt: at };
        repo.state.drafts['sc-first::' + id] = { text: JSON.stringify({ v: 1, selfEvaluation: record.selfEvaluation, at: record.updatedAt, responseHash: S.fingerprint(record.response), token: record.token }), updatedAt: at };
        frozenKeys.push('sc-first-text::' + id, 'sc-first::' + id);
        added++;
      }
      if (added) { repo.save(); changed(); rememberOwn(...frozenKeys); }
      return added;
    }).catch(() => 0);
  }
  // Statut d'une question : vue (première réponse donnée) et à revoir (dernier résultat faux / « À revoir »).
  function qcmStatus(q, step) {
    const run = readRun(q);
    if (!run.revealed[step.id]) return { seen: false, wrong: false };
    const runIds = new Set([run.id, ...(compatRevs(q, step).length ? compatRuns(q).map(c => c.raw.id) : [])]);
    const tries = practiceList('qcm', q, step).filter(p => runIds.has(p.runId) && step.choices.some(c => c.id === p.choice));
    const last = tries.length ? tries[tries.length - 1].choice : run.answers[step.id];
    return { seen: true, wrong: last !== step.correctId };
  }
  function scStatus(q, step) {
    const record = firstRecord(q, step);
    if (!record) return { seen: false, wrong: false };
    const tries = practiceList('sc', q, step).filter(p => ['known', 'review'].includes(p.selfEvaluation) && p.at > record.updatedAt);
    return { seen: true, wrong: (tries.length ? tries[tries.length - 1].selfEvaluation : record.selfEvaluation) === 'review' };
  }
  const itemStatus = item => withoutChoices ? scStatus(item.q, item.step) : qcmStatus(item.q, item.step);
  // Marque « Difficile » : sur l'appareil, dans l'état de la collection (donc dans les sauvegardes), jamais envoyée.
  const difficultKey = (q, step) => 'difficile::' + q.id + '::' + step.id;
  const isDifficult = (q, step) => repo.state.drafts[difficultKey(q, step)]?.text === 'true';
  const inErrors = item => isDifficult(item.q, item.step) || itemStatus(item).wrong;
  function difficultInner(on) { return `<span class="difficult-flag" aria-hidden="true">⚑</span><span>${on ? 'Marquée « Difficile »' : 'Difficile'}</span>`; }
  function difficultHelp(on) { return on ? 'Elle reste dans « Mes erreurs et difficiles ». Touche encore pour retirer la marque.' : 'Touche pour la garder dans « Mes erreurs et difficiles ».'; }
  function difficultButton(q, step) {
    if (!GROUPED_COURSES) return '';
    const on = isDifficult(q, step);
    return `<div class="difficult-row"><button type="button" class="btn difficult-toggle" data-action="toggle-difficult" aria-pressed="${on}" aria-describedby="difficult-help">${difficultInner(on)}</button><p class="help-text difficult-help" id="difficult-help">${difficultHelp(on)}</p></div>`;
  }
  const seenBadge = () => '<span class="seen-badge">Déjà vue</span>';
  const runCache = new Map(), mixExpansionCache = new Map();
  const mixKey = 'hep-revisions-qcm-mixed-position-v1::' + SCOPE;
  // v26, après contrôle Codex : la v26 écrit son mélange sous sa propre clé ; celle de la v25 (« -v2 ») n'est plus que lue,
  // en repli. Une v25 restée ouverte garde ainsi son mélange (ordre, curseur, identifiant).
  const MIX_V26 = 'mixed-position-v26';
  const storedMix = () => repo.state.drafts[levelStorageKey(MIX_V26)]?.text || repo.state.drafts[levelStorageKey('mixed-position-v2')]?.text || repo.state.drafts[levelStorageKey('mixed-position')]?.text;
  const courseCursorKey = 'hep-revisions-qcm-course-position-v1::' + SCOPE;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // v25 : mise en évidence écrite dans les données, « **mot** ». Le texte est d'abord échappé ;
  // seule la paire ** ... ** (sur une même ligne, non vide) devient <strong>. Aucun autre HTML n'est accepté.
  const BOLD = /\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*/g;
  const rich = value => esc(value).replace(BOLD, '<strong>$1</strong>');
  const plain = value => String(value ?? '').replace(BOLD, '$1');
  const text = value => `<span class="exercise-text">${rich(value)}</span>`;
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
  const levelStorageKey = name => (withoutChoices ? 'sc-level-' : 'qcm-level-') + name + '::' + SCOPE + '::' + (ancientAllTiers() ? 'tout' : levelFilter) + (ancientOnly ? '::anciens' : '');
  const selectedLevelKey = () => (withoutChoices ? 'sc-selected-level::' : 'qcm-selected-level::') + SCOPE;
  const selectedAncientKey = () => (withoutChoices ? 'sc-selected-ancient::' : 'qcm-selected-ancient::') + SCOPE;
  const selectedUnseenKey = () => (withoutChoices ? 'sc-selected-unseen::' : 'qcm-selected-unseen::') + SCOPE;
  function restoreUnseenChoice() {
    try { unseenOnly = JSON.parse(repo.state.drafts[selectedUnseenKey()]?.text || 'false') === true; } catch (_) { unseenOnly = false; }
  }
  function restoreAncientChoice() {
    try { ancientOnly = JSON.parse(repo.state.drafts[selectedAncientKey()]?.text || 'false') === true; } catch (_) { ancientOnly = false; }
  }
  const ancientBadge = step => step.ancienExamen ? '<span class="pill">Ancien examen</span>' : '';
  // v23 : poids du savoir (REGLES §5.1), lu dans bank.attentes ; aucune valeur sans rattachement.
  // Un avis sur le niveau ne modifie jamais ce poids.
  let attenteById = new Map();
  const WEIGHT_LABELS = { 1: 'À maîtriser', 2: 'À connaître', 3: 'À rencontrer' };
  const stepWeight = step => { const a = attenteById.get(step?.attenteId); return a && [1, 2, 3].includes(a.weight) ? a.weight : null; };
  const weightLabel = w => `<span class="weight-badge weight-${w}"><span class="visually-hidden">Poids du savoir pour l’examen : </span>${w} · ${WEIGHT_LABELS[w]}</span>`;
  // Sur une question : poids de l'attente, puis niveau de la question (le poids seul distingue peu,
  // presque tout le bloc oral étant central). Poids 3 = « Savoir secondaire » (REGLES §5.10).
  const weightBadge = step => { const w = stepWeight(step); return w ? `<span class="weight-badge weight-${w}"><span class="visually-hidden">Poids du savoir pour l’examen : </span>${w} · ${WEIGHT_LABELS[w]}${w === 3 ? ' · Savoir secondaire' : ''}</span>` : ''; };
  const levelBadge = step => THREE_LEVELS.includes(step?.level) ? `<span class="level-badge level-${step.level}"><span class="visually-hidden">Niveau de la question : </span>${LEVEL_NAMES[step.level]}</span>` : '';
  const questionMeta = (ref, step, seen = false) => `<div class="question-meta"><p class="exercise-origin">${esc(referenceLabel(ref))}${ref.date ? ' · ' + esc(ref.date) : ''}</p><span class="question-tags">${weightBadge(step)}${levelBadge(step)}${seen ? seenBadge() : ''}</span></div>`;
  function knowBox(course) {
    if (!attenteById.size || course.kind === 'liens') return '';
    const items = orderedCourseEntries().filter(item => courseKey(item.q) === course.key && (!ancientOnly || !!item.step.ancienExamen) && (!withoutChoices || item.step.sansChoix === true));
    const per = new Map(); let unweighted = 0;
    for (const item of items) {
      const a = attenteById.get(item.step.attenteId);
      if (!a || ![1, 2, 3].includes(a.weight)) { unweighted++; continue; }
      const entry = per.get(a.id) || { a, ess: 0, deep: 0, all: 0 };
      entry.all++; if (!levelsEnabled || item.step.level === 'essentiel') entry.ess++; else if (threeTiers && item.step.level === 'essentiel-approfondi') entry.deep++;
      per.set(a.id, entry);
    }
    if (!per.size) return '';
    const list = [...per.values()].sort((x, y) => x.a.weight - y.a.weight || y.ess - x.ess);
    const ess = list.reduce((n, e) => n + e.ess, 0), noun = n => withoutChoices ? (n > 1 ? 'questions essentielles' : 'question essentielle') : (n > 1 ? 'QCM essentiels' : 'QCM essentiel');
    const scope = [withoutChoices ? 'mode Sans les choix' : 'mode QCM', ancientOnly ? 'anciens examens seulement' : ''].filter(Boolean).join(', ');
    const groups = [1, 2, 3].map(w => [w, list.filter(e => e.a.weight === w)]).filter(([, entries]) => entries.length);
    return `<details class="know-box"><summary><span class="know-title">Ce qu’il faut savoir</span><span class="know-summary">${list.length} savoir${list.length > 1 ? 's' : ''} · ${ess} ${noun(ess)}</span></summary>${groups.map(([w, entries]) => `<div class="know-group">${weightLabel(w)}<ul class="know-list">${entries.map(e => `<li><span class="know-label">${esc(e.a.label)}</span><span class="know-count">${e.ess} ${noun(e.ess)}${threeTiers ? `${e.deep ? ` · +${e.deep} avec « + Approfondir »` : ''}${e.all - e.ess - e.deep ? ` · +${e.all - e.ess - e.deep} avec « Tout le bloc »` : ''}` : e.all > e.ess ? ` · +${e.all - e.ess} avec « Tout »` : ''}</span><span class="know-op">${esc(e.a.operation)}</span></li>`).join('')}</ul></div>`).join('')}<p class="help-text know-scope">Comptes de ce parcours, ${esc(scope)}.${unweighted ? ` ${unweighted} question${unweighted > 1 ? 's' : ''} sans poids.` : ''} Les poids viennent du cadre et de la synthèse de révision ; tes avis sous chaque question aident à les vérifier.</p></details>`;
  }
  const snapshotPrompt = step => (step.ancienExamen ? 'Ancien examen\n\n' : '') + step.prompt;
  const emptySelection = () => unseenOnly ? 'Tu as déjà répondu à toutes les questions de ce choix. Désactive « Seulement les questions pas encore vues » pour les revoir.' : ancientOnly ? 'Aucune question d’ancien examen ne correspond à ce cours ou mélange, au niveau et au mode choisis. Désactive Anciens examens, choisis ' + (threeTiers ? '« Tout le bloc »' : 'Tout') + ' ou le mode QCM.' : 'Aucune question disponible pour ce parcours. Choisis ' + (threeTiers ? '« Tout le bloc »' : 'Tout') + ' ou le mode QCM.';
  function writeNavigation(key, value) {
    ingestLocal();
    const previous = repo.state.drafts[key];
    repo.state.drafts[key] = { text: JSON.stringify(value), updatedAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString() };
    repo.save(); changed();
  }
  function restoreLevelChoice() {
    let saved; try { saved = JSON.parse(repo.state.drafts[selectedLevelKey()]?.text || 'null'); } catch (_) { saved = null; }
    levelFilter = saved === 'tout' ? 'tout' : saved === 'approfondi' && threeTiers ? 'approfondi' : 'essentiel';
  }
  const stepEligible = step => (!ancientOnly || !!step.ancienExamen) && (!withoutChoices || step.sansChoix === true) && (ancientAllTiers() || inLevel(step));
  const exerciseEntries = q => q.steps.map((step, index) => ({ q, step, index })).filter(item => stepEligible(item.step));
  // v26 : avec trois étages, les comptes des étages décrivent les étages (sans le filtre Anciens examens, qui les ignore) ;
  // levelCount('anciens', true) compte les anciens examens de tous les étages. Deux niveaux : comme en v25.
  function levelCount(level, ancient = ancientOnly && !threeTiers) {
    return bank.exercises.reduce((n, q) => n + q.steps.filter(step => (!ancient || !!step.ancienExamen) && (!withoutChoices || step.sansChoix === true) && (level === 'anciens' || inLevel(step, level)) && (!unseenOnly || !stepDone({ q, step }))).length, 0);
  }
  function levelControls() {
    if (!GROUPED_COURSES) return '';
    const plural = n => n + ' question' + (n > 1 ? 's' : '');
    const ancientHelp = threeTiers ? 'Seulement les questions reprises d’anciens examens, tous les étages · ' + plural(levelCount('anciens', true)) : 'Seulement les questions reprises d’anciens examens';
    return `<div class="qcm-filters" role="group" aria-label="Filtres du parcours">${threeTiers ? tierControls(plural) : levelsEnabled ? `<div class="segment-row"><span class="segment-label" id="qcm-level-label">Niveau</span><div class="qcm-mode-switch segmented" role="group" aria-labelledby="qcm-level-label"><button type="button" class="segment" data-level-filter="essentiel" aria-pressed="${levelFilter === 'essentiel'}">${segmentText('Essentiel', 'La base · ' + plural(levelCount('essentiel')))}</button><button type="button" class="segment" data-level-filter="tout" aria-pressed="${levelFilter === 'tout'}">${segmentText('Tout', 'Avec l’approfondissement · ' + plural(levelCount('tout')))}</button></div></div>` : ''}<button type="button" class="switch-row" role="switch" aria-checked="${ancientOnly}" data-action="ancient-filter"><span class="switch-text"><span class="switch-title">Anciens examens</span><span class="switch-help">${esc(ancientHelp)}</span></span><span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span></button><button type="button" class="switch-row" role="switch" aria-checked="${unseenOnly}" data-action="unseen-filter"><span class="switch-text"><span class="switch-title">Seulement les questions pas encore vues</span><span class="switch-help">Cache celles auxquelles tu as déjà répondu</span></span><span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span></button></div>`;
  }
  // v26 : maquette A. Un cadre « Tout le bloc » contient le cadre « Essentiel » (choix par défaut), qui contient
  // l'interrupteur « + Approfondir ». Chaque choix a sa légende et son nombre de questions, toujours visibles.
  function tierControls(plural) {
    const all = levelFilter === 'tout', base = !all, deep = levelFilter === 'approfondi', muted = ancientAllTiers();
    return `<div class="tier-row${muted ? ' tier-row-muted' : ''}"><span class="segment-label" id="qcm-level-label">Niveau</span><div class="tier-nest tier-outer${all ? ' is-chosen' : ''}" role="group" aria-labelledby="qcm-level-label"><button type="button" class="tier-pick" data-level-filter="tout" aria-pressed="${all}"><span class="tier-dot" aria-hidden="true"></span><span class="tier-name">Tout le bloc</span><span class="tier-legend">tout, avec « pour aller plus loin » · <b>${plural(levelCount('tout'))}</b></span></button><div class="tier-nest tier-inner${base ? ' is-chosen' : ''}"><button type="button" class="tier-pick" data-level-filter="essentiel" aria-pressed="${base}"><span class="tier-dot" aria-hidden="true"></span><span class="tier-name">Essentiel</span><span class="tier-legend">la base : une question par savoir · <b>${plural(levelCount('essentiel'))}</b></span></button><button type="button" class="switch-row tier-addon" role="switch" aria-checked="${deep}" data-action="tier-deepen"><span class="switch-text"><span class="tier-name">+ Approfondir</span><span class="tier-legend">le détail des savoirs centraux · <b>${plural(levelCount('approfondi'))}</b></span></span><span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span></button></div></div>${muted ? '<p class="help-text tier-note">« Anciens examens » est activé : il montre ses questions de tous les étages.</p>' : ''}</div>`;
  }
  // Sur l'écran d'une question : les réglages restent accessibles, repliés derrière un résumé lisible ;
  // ouverts, chaque option garde sa légende.
  function focusSettings() {
    if (!GROUPED_COURSES || activeCourse === DEEPEN_KEY) return '';
    const parts = [levelsEnabled ? levelChoiceLabel() : '', ancientOnly && !ancientAllTiers() ? 'Anciens examens' : '', unseenOnly ? 'Pas encore vues' : ''].filter(Boolean);
    return `<details class="focus-settings"><summary><span class="focus-settings-title">Réglages</span><span class="focus-settings-state">${esc(parts.join(' · ') || 'Toutes les questions')}</span><span class="focus-settings-open" aria-hidden="true">Modifier</span></summary>${levelControls()}</details>`;
  }
  // Ce qui s'écrit d'un essai : sans les réponses empruntées à un autre essai (run.borrowed).
  function persistable(run) {
    if (!run.borrowed) return run;
    const out = { ...run, answers: { ...run.answers }, revealed: { ...run.revealed }, checked: false };
    for (const id of Object.keys(run.borrowed)) { delete out.answers[id]; delete out.revealed[id]; }
    delete out.borrowed;
    return out;
  }
  function writeRun(q, run) {
    const key = runKey(q), previous = repo.state.drafts[key], own = persistable(run);
    repo.state.drafts[key] = { text: JSON.stringify(own), updatedAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.updatedAt) + 1 : 0)).toISOString() };
    mirrorCompat(q, own);
    repo.save(); changed();
  }
  // v26, après contrôle Codex : une première réponse donnée ici est aussi ajoutée à l'essai de chaque révision compatible
  // de la question (même contenu), sans jamais remplacer une réponse qui s'y trouve déjà. Un onglet v25 resté ouvert voit
  // alors la question comme répondue : son contrôle « l'essai a changé ailleurs » refuse une seconde note.
  const rawRevealed = (raw, stepId) => raw?.revealed?.[stepId] === true || (!raw?.revealed && raw?.checked === true && raw?.answers?.[stepId] !== undefined);
  function mirrorCompat(q, run) {
    for (const step of q.steps) {
      if (!run.revealed[step.id]) continue;
      for (const rev of compatRevs(q, step)) {
        const key = 'qcm2::' + q.id + '::' + rev, previous = repo.state.drafts[key] || repo.state.drafts['qcm::' + q.id + '::' + rev];
        let old = null;
        if (previous) { try { old = JSON.parse(previous.text); } catch (_) { continue; } if (!old || typeof old !== 'object') continue; }
        // Filiation (2e contrôle Codex) : seulement l'essai compatible du même essai (même identifiant). Un essai distinct,
        // venu d'un autre appareil ou d'une sauvegarde, n'est jamais complété ; sa progression reste lue à l'affichage.
        if (old && (old.id !== run.id || rawRevealed(old, step.id))) continue;
        const revealed = old?.revealed ? { ...old.revealed } : Object.fromEntries(Object.keys(old?.answers || {}).filter(id => old.checked === true).map(id => [id, true]));
        const next = old ? { ...old, answers: { ...(old.answers || {}) }, order: { ...(old.order || {}) }, revealed } : { id: run.id, answers: {}, order: {}, revealed, index: 0, checked: false, hintUsed: false };
        next.answers[step.id] = run.answers[step.id]; next.order[step.id] = run.order[step.id]; next.revealed[step.id] = true;
        const stored = repo.state.drafts[key];
        repo.state.drafts[key] = { text: JSON.stringify(next), updatedAt: new Date(Math.max(Date.now(), stored ? Date.parse(stored.updatedAt) + 1 : 0)).toISOString() };
      }
    }
  }
  function shuffled(ids) {
    const result = [...ids];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  // v26, après contrôle Codex : les essais des révisions compatibles sont relus à chaque lecture, question par question
  // (et non plus seulement en l'absence d'essai v26). Une réponse écrite plus tard par un onglet v25 ou apportée par une
  // sauvegarde importée apparaît donc aussitôt ; une réponse déjà présente dans l'essai v26 n'est jamais remplacée.
  function compatDrafts(q) {
    const out = [];
    for (const rev of [...new Set(q.steps.flatMap(step => compatRevs(q, step)))]) for (const key of ['qcm2::' + q.id + '::' + rev, 'qcm::' + q.id + '::' + rev]) {
      const draft = repo.state.drafts[key];
      if (draft) { out.push({ rev, draft }); break; }
    }
    return out.sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt));
  }
  const validRunId = id => typeof id === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(id);
  function compatRuns(q) {
    return compatDrafts(q).map(c => { let raw; try { raw = JSON.parse(c.draft.text); } catch (_) { raw = null; } return raw && typeof raw === 'object' ? { rev: c.rev, raw } : null; }).filter(Boolean);
  }
  function readRun(q) {
    const key = runKey(q), own = repo.state.drafts[key]?.text || repo.state.drafts[legacyRunKey(q)]?.text || null;
    const compatList = compatDrafts(q), source = compatList.length ? JSON.stringify([own, compatList.map(c => c.draft.text)]) : own || 'null';
    const cached = runCache.get(key);
    if (cached?.source === source) return JSON.parse(JSON.stringify(cached.run));
    let raw; try { raw = JSON.parse(own || 'null'); } catch (_) { raw = null; }
    const compat = compatList.length ? compatRuns(q) : [];
    // Un essai v26 vide (simple ouverture, sans redémarrage) reprend l'identifiant de l'essai compatible le plus récent.
    const ownEmpty = !raw || (!q.steps.some(step => rawRevealed(raw, step.id)) && !raw.restartOf);
    const base = ownEmpty ? compat.find(c => validRunId(c.raw.id)) : null;
    const run = { id: base ? base.raw.id : validRunId(raw?.id) ? raw.id : S.uuid(), answers: {}, order: {}, revealed: {}, index: 0, checked: false, hintUsed: !!(raw?.hintUsed || base?.raw.hintUsed), contextUsed: !!(raw?.contextUsed || base?.raw.contextUsed) };
    if (base) run.inheritedFrom = base.rev;
    if (typeof raw?.restartOf === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(raw.restartOf) && raw.restartOf !== run.id) run.restartOf = raw.restartOf;
    if (typeof raw?.inheritedFrom === 'string' && /^[0-9a-f]{1,64}$/.test(raw.inheritedFrom)) run.inheritedFrom = raw.inheritedFrom;
    const validOrder = (order, ids) => Array.isArray(order) && order.length === 4 && new Set(order).size === 4 && order.every(id => ids.includes(id));
    for (const step of q.steps) {
      const ids = step.choices.map(c => c.id), order = raw?.order?.[step.id];
      run.order[step.id] = validOrder(order, ids) ? order : shuffled(ids);
      if (ids.includes(raw?.answers?.[step.id])) {
        run.answers[step.id] = raw.answers[step.id];
        if (raw?.revealed?.[step.id] === true || (!raw?.revealed && raw?.checked === true)) run.revealed[step.id] = true;
      }
      if (run.revealed[step.id] || !compat.length) continue;
      // Première réponse donnée sous une révision compatible (la plus récente). Après un redémarrage explicite,
      // seules les réponses du même essai sont reprises : la filiation du redémarrage est respectée.
      const from = compat.find(c => compatRevs(q, step).includes(c.rev) && rawRevealed(c.raw, step.id) && ids.includes(c.raw.answers?.[step.id]) && (!run.restartOf || c.raw.id === run.id));
      if (!from) continue;
      run.answers[step.id] = from.raw.answers[step.id]; run.revealed[step.id] = true;
      if (validOrder(from.raw.order?.[step.id], ids)) run.order[step.id] = from.raw.order[step.id];
      run.inheritedFrom = run.inheritedFrom || from.rev;
      if (from.raw.id !== run.id) { run.borrowed = run.borrowed || {}; run.borrowed[step.id] = from.raw.id; }
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
    if (repo.state.drafts[runKey(q)]?.text !== JSON.stringify(persistable(run))) writeRun(q, run);
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
    const shown = qcmDisplay(active, active.steps[current.index], current);
    document.querySelectorAll('[data-choice]').forEach(button => { button.setAttribute('aria-pressed', String(shown.selectedId === button.dataset.choice)); });
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
    const display = GROUPED_COURSES ? qcmDisplay(q, step, run) : { mode: 'first', selectedId: run.answers[step.id], revealed: !!run.revealed[step.id] };
    const ids = run.order[step.id], selected = display.selectedId, revealed = display.revealed;
    const context = display.mode === 'hidden' ? 'Question déjà vue : première réponse masquée.\n' : display.mode === 'practice' ? 'Nouvelle tentative (entraînement).\n' : display.mode === 'review' ? 'Première réponse revue.\n' : '';
    const explanations = revealed ? ids.filter(id => id === step.correctId || id === selected || seen.explanations.has(step.id) || document.querySelector('.qcm-verdict details')?.open).map(id => {
      const choice = step.choices.find(c => c.id === id);
      return String.fromCharCode(65 + ids.indexOf(id)) + '. ' + (id === step.correctId ? 'Bonne réponse. ' : '') + choice.explanation;
    }).join('\n\n') : '';
    return { question: snapshotPrompt(step) + '\n\n' + ids.map((id, i) => String.fromCharCode(65 + i) + '. ' + step.choices.find(c => c.id === id).text).join('\n'),
      answer: context + 'Mon choix : ' + (selected ? String.fromCharCode(65 + ids.indexOf(selected)) + '. ' + step.choices.find(c => c.id === selected).text : 'aucun') + '\n\n' + (revealed ? explanations : 'Correction non affichée.'),
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
      return `<header class="qcm-focus-header">${activeCourse === DEEPEN_KEY ? '<button class="btn ghost focus-back" data-action="deepen-return" aria-label="Retour au parcours, là où tu l’avais laissé"><span aria-hidden="true">‹</span> Parcours</button>' : '<button class="btn ghost focus-back" data-action="home" aria-label="Retour à l’accueil des QCM"><span aria-hidden="true">‹</span> Accueil</button>'}<span class="question-counter">${withoutChoices ? 'Sans les choix · ' + counter.replace(/QCM/g, 'Question') : counter}</span>${needsContext(active.steps[run.index]) ? '<button class="btn secondary" data-action="open-context" aria-label="Voir la situation">Situation</button>' : ''}<button class="btn secondary focus-hint" data-action="open-hints" aria-label="Un rappel des concepts"><span aria-hidden="true">?</span> Rappel</button><span class="focus-progress" aria-hidden="true"><span style="width:${Math.round(100 * (activeMix || activeCourse ? (progress.index + 1) / Math.max(1, progress.queue.length) : (run.index + 1) / Math.max(1, active.steps.length)))}%"></span></span></header>`;
    }
    return `<header class="site-header"><button class="brand" data-action="home"><img class="brand-mark" src="icon.svg" alt=""><span><span class="brand-title">${esc(withoutChoices ? (collection.subject || '') + ' · Sans les choix' : collection.label || 'Essai · QCM guidés')}</span><span class="brand-subtitle">${esc(collection.subtitle || 'Français · Bloc oral')}</span></span></button><nav class="header-actions" aria-label="Navigation des QCM"><button class="btn ghost" data-action="home">Exercices</button><button class="btn ghost" data-action="avis">Mes avis</button><button class="btn ghost" data-action="feedback">Mes retours <span class="badge" data-feedback-count>${comments().length}</span></button><button class="btn ghost" data-action="settings" aria-label="Sauvegardes des QCM"><span aria-hidden="true">↗</span> Sauvegardes</button></nav></header>`;
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
  const courseLabel = key => key === ERRORS_KEY ? ERRORS_LABEL : key === DEEPEN_KEY ? DEEPEN_LABEL : groupDefinitions().find(group => group.key === key)?.label || 'Cours ' + key;
  function orderedCourseEntries() {
    if (!bank.navigationOrder) return bank.families.flatMap(family => bank.exercises.filter(q => q.familyId === family.id).flatMap(q => q.steps.map((step, index) => ({ q, step, index }))));
    const entries = new Map(bank.exercises.flatMap(q => q.steps.map((step, index) => [JSON.stringify([q.id, step.id]), { q, step, index }])));
    return bank.navigationOrder.map(ref => entries.get(JSON.stringify([ref.exerciseId, ref.stepId])));
  }
  // v25 : file vivante (accueil, compteurs) ; une file « figée » à l'ouverture d'un parcours dont le contenu
  // dépend des réponses (pas encore vues, erreurs), pour que la question en cours et le compteur restent stables.
  const frozenSig = key => JSON.stringify([key, withoutChoices, levelFilter, ancientOnly, unseenOnly]);
  // La question affichée dans cet onglet (réponse ou tentative qu'on vient de donner, mémorisée dans sessionStorage)
  // reste dans la file d'un parcours rouvert, même si elle n'est plus « pas encore vue » ou plus une erreur :
  // un rechargement ne fait pas avancer le parcours.
  const isPresentedItem = item => !!presented && presented.key === presentedKey(item.q, item.step);
  function errorsQueue(keepPresented = false) { return orderedCourseEntries().filter(item => item && stepEligible(item.step) && (inErrors(item) || keepPresented && isPresentedItem(item))); }
  // Étage 2 du même savoir (grille, attenteId), dans le mode choisi ; sans les autres filtres.
  const deepenItems = attenteId => orderedCourseEntries().filter(item => item && item.step.level === 'essentiel-approfondi' && item.step.attenteId === attenteId && (!withoutChoices || item.step.sansChoix === true));
  function liveCourseQueue(key, keepPresented = false) {
    if (key === DEEPEN_KEY) return deepen ? deepenItems(deepen.attenteId) : [];
    if (key === ERRORS_KEY) return errorsQueue(keepPresented);
    return orderedCourseEntries().filter(item => courseKey(item.q) === key && stepEligible(item.step) && (!unseenOnly || !stepDone(item) || keepPresented && isPresentedItem(item)));
  }
  function courseQueue(key) {
    if (frozen && frozen.sig === frozenSig(key)) return frozen.items;
    return liveCourseQueue(key);
  }
  function coursePosition(q, run) {
    const queue = activeMix ? mixedQueue(activeMix) : activeCourse ? courseQueue(activeCourse) : [];
    return { queue, index: queue.findIndex(item => item.q.id === q.id && item.step.id === q.steps[run.index].id) };
  }
  function scNavigationVersion() {
    return activeMix ? storedMix() || '' : S.stable((activeCourse === DEEPEN_KEY ? deepen?.cursor : readCourseCursors()[activeCourse]) || null);
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
      if (repo.state.drafts[runKey(active)]?.text !== JSON.stringify(persistable(run))) writeRun(active, run);
    }
    const cursor = { exerciseId: active.id, stepId: item.step.id, qcmRevision: active.qcmRevision };
    // Le parcours « Approfondir » garde sa position dans l'onglet : la position du parcours quitté ne bouge pas.
    if (activeCourse === DEEPEN_KEY) { if (deepen) setDeepen({ ...deepen, cursor }); return; }
    const cursors = readCourseCursors();
    cursors[activeCourse] = cursor;
    try { if (withoutChoices || levelsEnabled || ancientOnly) writeNavigation(levelStorageKey('course-position'), cursors); else localStorage.setItem(courseCursorKey, JSON.stringify(cursors)); } catch (_) { toast('La position du cours ne peut pas être enregistrée sur cet appareil.'); }
  }
  function openCourse(key) {
    frozen = null;
    const queue = liveCourseQueue(key, true);
    if (!queue.length) { showEmptyPath(key === DEEPEN_KEY ? 'Aucune question pour approfondir ce savoir dans ce mode.' : key === ERRORS_KEY ? 'Aucune question à revoir pour l’instant : pas de réponse fausse, d’« À revoir » ni de question marquée « Difficile » dans ce choix.' : emptySelection()); return false; }
    if (unseenOnly || key === ERRORS_KEY) frozen = { sig: frozenSig(key), items: queue };
    activeCourse = key;
    const cursor = key === DEEPEN_KEY ? deepen?.cursor : readCourseCursors()[key];
    const saved = queue.find(item => item.q.id === cursor?.exerciseId && item.step.id === cursor?.stepId && (item.q.qcmRevision === cursor?.qcmRevision || compatRevs(item.q, item.step).includes(cursor?.qcmRevision)));
    const pending = saved || (key === ERRORS_KEY ? queue[0] : queue.find(item => !stepDone(item)) || (key === DEEPEN_KEY ? queue[0] : queue[queue.length - 1]));
    selectCourseEntry(pending); return true;
  }
  function deepenBanner() {
    if (activeCourse !== DEEPEN_KEY || !deepen) return '';
    return `<section class="deepen-banner" aria-label="${DEEPEN_LABEL}"><p><strong>${DEEPEN_LABEL}</strong>${deepen.label ? ' · ' + esc(deepen.label) : ''}</p><p class="help-text">Les questions de détail de ce savoir. « Retour au parcours » te ramène là où tu étais.</p></section>`;
  }
  // Après la correction d'une question de l'étage 1 : le bouton n'apparaît que s'il existe des questions rattachées.
  function deepenOffer(q, step, shown) {
    if (!threeTiers || !shown || step.level !== 'essentiel' || !step.attenteId || activeCourse === DEEPEN_KEY) return '';
    const n = deepenItems(step.attenteId).length;
    if (!n) return '';
    const label = attenteById.get(step.attenteId)?.label;
    return `<div class="deepen-row"><button type="button" class="btn deepen-button" data-action="deepen-open" data-attente="${esc(step.attenteId)}"><span aria-hidden="true">↳</span> Approfondir ce savoir · ${n} question${n > 1 ? 's' : ''}</button><p class="help-text">Le détail ${label ? 'de « ' + esc(label) + ' »' : 'de ce savoir'}, puis retour ici.</p></div>`;
  }
  const deepenReturnButton = (index, total) => activeCourse === DEEPEN_KEY && index + 1 >= total ? '<button class="btn primary" data-action="deepen-return">Retour au parcours →</button>' : '';
  function returnFromDeepen() {
    const back = deepen; setDeepen(null);
    if (!back || back.returnHash === DEEPEN_KEY) { setPresented(null); return navigate(''); }
    // La question quittée se rouvre comme on l'avait laissée (correction, revue ou tentative).
    setPresented(back.presented && typeof back.presented.key === 'string' ? back.presented : null);
    navigate(back.returnHash);
  }
  function showEmptyPath(message) {
    active = null; activeCourse = null; activeMix = null; view = 'home'; emptyPathMessage = message;
  }
  function courseStats(queue) {
    if (withoutChoices) return queue.reduce((stats, item) => {
      const record = firstRecord(item.q, item.step);
      if (record) { stats.answered++; if (record.selfEvaluation === 'known') stats.score++; }
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
    if (frozen && frozen.sig === frozenSig('mix::' + mix.id)) return frozen.items;
    const entries = new Map(allEntries().map(item => [entryKey(entryRef(item)), item]));
    return mix.order.map(ref => entries.get(entryKey(ref))).filter(item => item && (!unseenOnly || !stepDone(item) || isPresentedItem(item)));
  }
  function readMix() {
    let value;
    try {
      const scoped = withoutChoices || levelsEnabled || ancientOnly;
      const fallback = !withoutChoices && !ancientOnly && levelFilter === 'tout' ? localStorage.getItem(mixKey) : null;
      const source = scoped ? storedMix() || fallback : localStorage.getItem(mixKey);
      value = expandedMix(JSON.parse(source || 'null'));
    } catch (_) { return null; }
    const entries = allEntries().map(item => entryKey(entryRef(item)));
    if (!entries.length) return null;
    if (value?.version !== 1 || typeof value.id !== 'string' || !Array.isArray(value.order) || !value.order.length) return null;
    const currentItems = new Map(allEntries().map(item => [item.q.id + '::' + item.step.id, item]));
    const normalize = ref => { const item = ref && currentItems.get(ref.exerciseId + '::' + ref.stepId); return item && ref.qcmRevision !== item.q.qcmRevision && compatRevs(item.q, item.step).includes(ref.qcmRevision) ? entryRef(item) : ref; };
    value = { ...value, order: value.order.map(normalize), cursor: value.cursor && normalize(value.cursor) };
    const allKeys = value.order.map(ref => entryKey(ref || {}));
    if (new Set(allKeys).size !== allKeys.length) return null;
    // v26 : une question retirée, de révision changée ou sortie du niveau choisi est seulement écartée du mélange ;
    // l'ordre des autres et la position sont gardés (avant, tout le mélange était recréé). Rien n'est effacé du stockage.
    const present = new Set(entries);
    const kept = value.order.filter((ref, i) => present.has(allKeys[i])), keys = kept.map(ref => entryKey(ref));
    if (!kept.length) return null;
    let order = kept;
    if (keys.length < entries.length) {
      // Append newly exported compatible questions; keep the previous order/cursor.
      const signature = JSON.stringify([value, entries]);
      if (!mixExpansionCache.has(signature)) mixExpansionCache.set(signature, [...order, ...shuffled(allEntries().map(entryRef).filter(ref => !keys.includes(entryKey(ref))))]);
      order = mixExpansionCache.get(signature);
    }
    let cursor = value.cursor;
    if (!keys.includes(entryKey(cursor || {}))) {
      const at = allKeys.indexOf(entryKey(cursor || {}));
      cursor = (at < 0 ? null : value.order.slice(at + 1).find((ref, i) => present.has(allKeys[at + 1 + i]))) || order[0];
    }
    return { version: 1, id: value.id, order, cursor };
  }
  function saveMix() {
    try {
      if (withoutChoices || levelsEnabled || ancientOnly) {
        const compact = compactMix(activeMix);
        if (JSON.stringify(compact).length > 12000) throw Error('Mélange trop volumineux.');
        // Separate key prevents an older client overwriting the extended mixture.
        writeNavigation(levelStorageKey(MIX_V26), compact);
      } else localStorage.setItem(mixKey, JSON.stringify(activeMix));
    } catch (_) { toast('Le mélange ne peut pas être enregistré sur cet appareil.'); }
  }
  function openMix(fresh = false) {
    const entries = allEntries();
    if (!entries.length) { showEmptyPath(emptySelection()); return false; }
    activeCourse = null; frozen = null;
    activeMix = !fresh && readMix() || { version: 1, id: S.uuid(), order: shuffled(entries.map(entryRef)) };
    const queue = mixedQueue(activeMix);
    if (!queue.length) { showEmptyPath(emptySelection()); return false; }
    if (unseenOnly) frozen = { sig: frozenSig('mix::' + activeMix.id), items: queue };
    const target = queue.find(item => entryKey(entryRef(item)) === entryKey(activeMix.cursor || {})) || queue[0];
    selectMixedEntry(target);
  }
  function selectMixedEntry(item) {
    active = item.q;
    if (withoutChoices) scIndex = item.index;
    else {
      const run = readRun(active); run.index = item.index;
      if (repo.state.drafts[runKey(active)]?.text !== JSON.stringify(persistable(run))) writeRun(active, run);
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
      return { key, label, block: group.block, kind: group.kind, queue, date: dates[0] || '99999999', match: !query || oralNavigation.normalize(haystack).includes(query) };
    }).filter(course => course.match);
    const total = allEntries().filter(item => !unseenOnly || !stepDone(item)).length, mix = readMix();
    const errors = errorsQueue().length, unseenSuffix = n => !unseenOnly ? '' : ' pas encore vu' + (withoutChoices ? 'e' : '') + (n > 1 ? 's' : '');
    const errorsCard = `<section class="qcm-errors-start" aria-label="${ERRORS_LABEL}"><article class="course-card exercise-tile course-card-errors"><h2><span class="difficult-flag" aria-hidden="true">⚑</span> ${ERRORS_LABEL}</h2><p class="help-text">${withoutChoices ? 'Tes « À revoir » et tes questions marquées « Difficile ».' : 'Tes réponses fausses et tes questions marquées « Difficile ».'} Une erreur sort de la liste quand tu la réussis.</p><p class="errors-count"><strong data-errors-count>${errors}</strong> question${errors > 1 ? 's' : ''} à revoir</p><button class="btn primary" data-action="errors" ${errors ? '' : 'disabled'} aria-label="${errors ? 'Revoir ' + errors + ' question' + (errors > 1 ? 's' : '') + ' : ' + ERRORS_LABEL : 'Rien à revoir pour l’instant dans ' + ERRORS_LABEL}">${errors ? 'Revoir' : 'Rien pour l’instant'}</button></article></section>`;
    return `<div class="quiz-help-entry"><button type="button" class="btn quiz-help-button" data-quiz-help>Comment utiliser ce quiz ?</button><a class="aide-guide-link" href="aide.html"><span aria-hidden="true">?</span>Guide en images</a></div><section class="qcm-settings" aria-label="Réglages">${modeControls()}${levelControls()}</section>${emptyPathMessage ? `<p class="notice" role="status">${esc(emptyPathMessage)}</p>` : ''}<section class="qcm-mix-start" aria-label="Toutes les questions"><div><button class="btn primary btn-large" data-action="mix" ${total ? '' : 'disabled'}><span aria-hidden="true">▶</span> Tout mélanger</button><p class="help-text">${total ? total + ' ' + questionLabel() + unseenSuffix(total) + ' en ordre aléatoire. Réponses conservées.' : esc(emptySelection())}</p></div>${mix ? '<button class="btn ghost" data-action="new-mix">Nouveau mélange</button>' : ''}</section>${GROUPED_COURSES ? errorsCard : ''}
      <section class="qcm-subject" aria-labelledby="qcm-subject-title"><h1 id="qcm-subject-title">${esc(collection.subject || 'Français')}</h1><section class="qcm-block" aria-labelledby="qcm-block-title"><h2 id="qcm-block-title">${esc(collection.block || 'Bloc oral')}</h2><p class="hero-description">${withoutChoices ? 'Écris ou pense ta réponse, puis affiche la réponse attendue et déclare « Je savais » ou « À revoir ». Les résultats QCM restent séparés.' : 'Des QCM avec une correction expliquée, à ton rythme.'}${writingHome && !withoutChoices ? ' Les exercices rédigés du bloc oral ont aussi leur <a href="oral.html">accès direct à la rédaction</a>.' : ''}</p>
      <form class="oral-tools qcm-home-filters" id="qcm-home-filters"><label class="oral-field" for="qcm-search">Rechercher un cours ou une notion<input class="text-input" id="qcm-search" type="search" value="${esc(search)}" placeholder="${esc(collection.searchPlaceholder || 'Ex. : Cours 1, étayage, récit…')}"></label><button class="btn secondary" type="submit">Rechercher</button>${search ? '<button class="btn ghost" type="button" data-action="clear-search">Tout afficher</button>' : ''}</form>
      <p class="help-text oral-result-count" id="qcm-home-results" role="status" tabindex="-1">${courses.length} ${groupDefinitions().some(g => g.kind === 'liens') ? 'parcours' : 'cours'} · ${courses.reduce((n, course) => n + course.queue.length, 0)} ${questionLabel()}${unseenSuffix(2)}</p><div class="exercise-grid qcm-courses" role="group" aria-label="Parcours par cours">${renderCourseBlocks(courses, course => { const stats = courseStats(course.queue); return `<article class="course-card exercise-tile${course.kind === 'liens' ? ' course-card-liens' : ''}"><h3>${esc(course.label)}</h3>${course.kind === 'liens' ? '<p class="help-text">Des questions qui relient deux cours du bloc, comme à l’examen.</p>' : ''}<p class="help-text">${course.queue.length} ${questionLabel()}${unseenSuffix(course.queue.length)}${stats.answered ? ` · ${stats.answered} ${withoutChoices ? 'autoévaluation' : 'réponse'}${stats.answered > 1 ? 's' : ''} enregistrée${stats.answered > 1 ? 's' : ''}` : ''}</p><span class="course-progress" aria-hidden="true"><span style="width:${course.queue.length ? Math.round(100 * stats.answered / course.queue.length) : 0}%"></span></span><button class="btn primary" data-course="${esc(course.key)}" ${course.queue.length ? '' : 'disabled'} aria-label="${esc(course.queue.length ? (stats.answered || readCourseCursors()[course.key] ? 'Reprendre' : 'Commencer') + ' ' + course.label : 'Aucune question disponible pour ' + course.label + '. ' + emptySelection())}">${course.queue.length ? (stats.answered || readCourseCursors()[course.key] ? 'Reprendre' : 'Commencer') : 'Aucune question'}</button>${knowBox(course)}</article>`; }) || '<p class="empty-state">Aucun cours ne correspond à cette recherche.</p>'}</div></section></section>
      ${window.HEPQuickUI?.group() || ''}
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
    const stored = firstRecord(q, step) || displayedSC, seen = quickSeen.get(run.id) || {}, display = scDisplay(q, step);
    const record = display.mode === 'hidden' ? { response: '', revealed: false, selfEvaluation: null } : display.mode === 'practice' ? { response: display.practice.response || '', revealed: !!display.practice.revealed, selfEvaluation: display.practice.selfEvaluation || null } : stored;
    const response = display.mode === 'practice' ? document.getElementById('sc-practice-response')?.value ?? record.response : display.mode === 'first' ? document.getElementById('sc-response')?.value ?? record.response : record.response;
    const correct = record.revealed ? step.choices.find(choice => choice.id === step.correctId) : null;
    return {
      question: 'Sans les choix\n\n' + snapshotPrompt(step),
      answer: (display.mode === 'hidden' ? 'Question déjà vue : première réponse masquée.\n' : display.mode === 'practice' ? 'Nouvelle tentative (entraînement).\n' : display.mode === 'review' ? 'Première réponse revue.\n' : '') + 'Ma réponse personnelle :\n' + (response || 'Réponse pensée ou non écrite.') + '\n\n' + (correct ? 'Réponse attendue :\n' + correct.text + '\n\n' + correct.explanation : 'Réponse attendue non affichée.') + (record.selfEvaluation ? '\n\nAutoévaluation déclarée : ' + (record.selfEvaluation === 'known' ? 'Je savais' : 'À revoir') : ''),
      hint: (seen.context ? 'Situation consultée :\n' + q.context : '') + (seen.hints ? '\n\nRappel consulté :\n' + hintText(q) : ''), module: q.module, course: q.course
    };
  }
  function scExercise() {
    const q = active, step = q.steps[scIndex], record = scStore.read(q, step), run = visibleRun(q);
    const ref = bank.courseReference || bank.courseReferences[q.referenceId], source = q.sources.find(s => s.file.includes('SYNTHESE')) || q.sources[0];
    const progress = coursePosition(q, run), stats = courseStats(progress.queue), total = progress.queue.length;
    const correct = record.revealed ? step.choices.find(choice => choice.id === step.correctId) : null;
    const alternatives = [...scStore.alternatives(q, step), ...compatRevs(q, step).flatMap(rev => { const old = scStore.read({ ...q, qcmRevision: rev }, step); return old.response && !old.selfEvaluation ? [old] : []; })];
    const display = scDisplay(q, step, record), first = firstRecord(q, step);
    const shown = display.mode === 'first' ? !!record.revealed : display.mode === 'review' || (display.mode === 'practice' && !!display.practice?.revealed);
    return `<section class="question-shell"><article class="question-card">${focusSettings()}${deepenBanner()}${questionMeta(ref, step, display.seen)}${display.mode !== 'first' ? scAlternateView(q, step, record, display) : `<fieldset class="qcm-step sc-step" tabindex="-1"><legend>${rich(step.prompt)}</legend>${ancientBadge(step)}${needsContext(step) ? '<button class="qcm-context-cue" data-action="open-context">Clique sur « Situation » pour lire le contexte.</button>' : ''}<label class="field-label" for="sc-response">Ma réponse (facultative)</label><p class="help-text">Écris ici ou réponds dans ta tête, puis compare avec la réponse attendue.</p><textarea class="feedback-textarea sc-response" id="sc-response" rows="4" maxlength="8000" ${first ? 'readonly' : ''}>${esc(first ? first.response : record.response)}</textarea><p class="save-status" id="sc-response-status" role="status" aria-live="polite">${repo.warning ? esc(repo.warning) : record.token ? 'Réponse conservée sur cet appareil.' : 'La réponse écrite est facultative.'}</p><button class="btn secondary" data-action="sc-refresh" id="sc-refresh" hidden>Recharger cette question</button>${correct ? `<section class="sc-expected" tabindex="-1" aria-labelledby="sc-expected-title"><h2 id="sc-expected-title">Réponse attendue</h2><p>${text(correct.text)}</p><p>${text(correct.explanation)}</p></section><div class="actions sc-self-evaluation" role="group" aria-label="Mon autoévaluation"><button class="btn secondary self-eval" data-action="sc-known" aria-pressed="${first?.selfEvaluation === 'known'}" ${first ? 'disabled' : ''}>Je savais</button><button class="btn secondary self-eval" data-action="sc-review" aria-pressed="${first?.selfEvaluation === 'review'}" ${first ? 'disabled' : ''}>À revoir</button></div><p class="help-text" role="status">${first ? 'Autoévaluation déclarée : ' + (first.selfEvaluation === 'known' ? 'Je savais.' : 'À revoir.') + ' C’est ta première réponse : elle reste telle quelle. Tu pourras t’entraîner de nouveau plus tard.' : 'Choisis « Je savais » ou « À revoir » pour poursuivre. Aucune note automatique.'}</p>` : '<button class="btn primary" data-action="sc-reveal">Voir la réponse</button>'}</fieldset>`}${reviewControls(display, true)}${deepenOffer(q, step, shown)}${difficultButton(q, step)}${alternatives.length ? `<details class="sc-alternatives"><summary>Autres réponses conservées (${alternatives.length})</summary><p class="help-text">Ces saisies d’autres onglets ou reprises restent disponibles. Tu peux en copier le texte.</p>${alternatives.map(item => `<p>${text(item.response)}</p>`).join('')}</details>` : ''}${window.HEPQuickUI?.thumbs() || ''}${window.HEPQuickLevel?.buttons() || ''}<button class="btn secondary qcm-report-button" data-action="report-step">Signaler un problème avec cette question</button>${scReportPanel()}<div class="question-navigation">${progress.index > 0 ? '<button class="btn secondary" data-action="previous">← Question précédente</button>' : ''}${progress.index + 1 < total ? `<button class="btn primary" data-action="next" ${first ? '' : 'disabled'}>Question suivante →</button>` : ''}${deepenReturnButton(progress.index, total)}</div>${progress.index === total - 1 && total > 0 && stats.answered === total ? `<section class="qcm-summary"><h2>Parcours Sans les choix terminé</h2><p>Autoévaluations déclarées : ${stats.score} « Je savais » ; ${stats.answered - stats.score} « À revoir ». Elles restent distinctes des résultats QCM.</p>${window.HEPQuickUI?.group() || ''}</section>` : ''}<div class="actions"><button class="btn secondary" data-action="${activeMix ? 'mix-first' : 'course-first'}">Revoir ${activeMix ? 'le mélange' : activeCourse === DEEPEN_KEY ? 'ce savoir' : 'le cours'} depuis le début</button></div></article></section>${supportDialogs(q, step, ref, source)}`;
  }
  // v25 : Sans les choix, question déjà autoévaluée : masquée (nouvelle tentative) ou revue.
  function scDisplay(q, step) {
    if (!firstRecord(q, step)) return { mode: 'first', seen: false };
    const mine = presented?.key === presentedKey(q, step) ? presented : null;
    if (mine?.mode === 'first') return { mode: 'first', seen: false };
    if (mine?.mode === 'review') return { mode: 'review', seen: true };
    if (mine?.mode === 'practice') return { mode: 'practice', seen: true, practice: mine };
    return { mode: 'hidden', seen: true, practice: null };
  }
  function scAlternateView(q, step, record, display) {
    const correct = step.choices.find(choice => choice.id === step.correctId), head = `<legend>${rich(step.prompt)}</legend>${ancientBadge(step)}${needsContext(step) ? '<button class="qcm-context-cue" data-action="open-context">Clique sur « Situation » pour lire le contexte.</button>' : ''}`;
    const evalLabel = value => value === 'known' ? 'Je savais' : 'À revoir';
    const first = firstRecord(q, step) || record;
    if (display.mode === 'review') return `<fieldset class="qcm-step sc-step" tabindex="-1">${head}<section class="sc-review qcm-verdict" tabindex="-1"><p class="verdict-context">Ta première réponse, celle qui compte dans tes résultats.</p><h2>Ma réponse</h2><p>${text(first.response || 'Réponse pensée ou non écrite.')}</p><h2>Réponse attendue</h2><p>${text(correct.text)}</p><p>${text(correct.explanation)}</p><p><strong>Autoévaluation déclarée :</strong> ${evalLabel(first.selfEvaluation)}.</p></section></fieldset>`;
    const p = display.practice || {};
    return `<fieldset class="qcm-step sc-step" tabindex="-1">${head}<label class="field-label" for="sc-practice-response">Ma nouvelle réponse (facultative)</label><p class="help-text">Pour t’entraîner. Ta première réponse et ton autoévaluation restent conservées.</p><textarea class="feedback-textarea sc-response" id="sc-practice-response" rows="4" maxlength="8000">${esc(p.response || '')}</textarea>${p.revealed ? `<section class="sc-expected" tabindex="-1" aria-labelledby="sc-expected-title"><h2 id="sc-expected-title">Réponse attendue</h2><p>${text(correct.text)}</p><p>${text(correct.explanation)}</p></section><div class="actions sc-self-evaluation" role="group" aria-label="Mon autoévaluation de cette nouvelle tentative"><button class="btn secondary self-eval" data-action="sc-practice-known" aria-pressed="${p.selfEvaluation === 'known'}">Je savais</button><button class="btn secondary self-eval" data-action="sc-practice-review" aria-pressed="${p.selfEvaluation === 'review'}">À revoir</button></div><p class="help-text" role="status">${p.selfEvaluation ? 'Nouvelle tentative enregistrée : ' + evalLabel(p.selfEvaluation) + '. Ta première autoévaluation ne change pas.' : 'Choisis « Je savais » ou « À revoir ». Cette tentative sert d’entraînement.'}</p>` : '<button class="btn primary" data-action="sc-practice-reveal">Voir la réponse</button>'}</fieldset>`;
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
  // v25 : ce que l'écran montre d'une question QCM selon sa présentation (première réponse, masquée, revue, tentative).
  function qcmDisplay(q, step, run) {
    if (!GROUPED_COURSES || !run.revealed[step.id]) return { mode: 'first', selectedId: run.answers[step.id], revealed: !!run.revealed[step.id], seen: false };
    const mode = presented?.key === presentedKey(q, step) ? presented.mode : 'hidden';
    if (mode === 'first' || mode === 'review') return { mode, selectedId: run.answers[step.id], revealed: true, seen: mode === 'review' };
    if (mode === 'practice' && step.choices.some(c => c.id === presented.choice)) return { mode, selectedId: presented.choice, revealed: true, seen: true };
    return { mode: 'hidden', selectedId: null, revealed: false, seen: true };
  }
  function stepView(q, step, index, run, display = qcmDisplay(q, step, run)) {
    const selected = step.choices.find(c => c.id === display.selectedId), correct = step.choices.find(c => c.id === step.correctId), revealed = display.revealed;
    return `<fieldset class="qcm-step" data-step="${step.id}"><legend>${rich(step.prompt)}</legend>${ancientBadge(step)}${needsContext(step) ? '<button class="qcm-context-cue" data-action="open-context">Clique sur « Situation » pour lire le contexte.</button>' : ''}<div class="qcm-choices">${run.order[step.id].map((id, i) => { const c = step.choices.find(c => c.id === id); return `<button class="qcm-choice ${selected?.id === id ? 'qcm-selected' : ''} ${revealed && id === step.correctId ? 'qcm-correct' : revealed && id === selected?.id ? 'qcm-incorrect' : ''}" data-choice="${id}" data-step="${step.id}" aria-label="${revealed && id === step.correctId ? 'Bonne réponse : ' : revealed && id === selected?.id ? 'Ton choix, faux : ' : ''}${String.fromCharCode(65 + i)}. ${esc(plain(c.text))}" aria-pressed="${selected?.id === id}" ${revealed ? 'disabled' : ''}><span class="choice-letter" aria-hidden="true">${String.fromCharCode(65 + i)}</span><span class="choice-body">${revealed && id === step.correctId ? `<span class="choice-tag good"><span aria-hidden="true">✓</span> ${selected?.id === id ? 'Ta réponse · Juste' : 'Bonne réponse'}</span>` : revealed && id === selected?.id ? '<span class="choice-tag bad"><span aria-hidden="true">✗</span> Ta réponse · Fausse</span>' : ''}<span class="choice-text">${rich(c.text)}</span></span></button>`; }).join('')}</div>${revealed ? `<div class="qcm-verdict ${selected.id === step.correctId ? 'is-good' : 'is-bad'}" role="status" tabindex="-1">${display.mode === 'review' ? '<p class="verdict-context">Ta première réponse, celle qui compte dans tes résultats.</p>' : display.mode === 'practice' ? '<p class="verdict-context">Nouvelle tentative, pour t’entraîner. Ta première réponse reste celle qui compte.</p>' : ''}<strong class="verdict-title"><span class="verdict-icon" aria-hidden="true">${selected.id === step.correctId ? '✓' : '✗'}</span> ${selected.id === step.correctId ? 'Bonne réponse.' : 'À reprendre.'}</strong><p>${text(correct.explanation)}</p>${selected.id !== step.correctId ? `<p><strong>Ton choix :</strong> ${text(selected.explanation)}</p>` : ''}<details><summary>Comprendre les autres propositions</summary>${run.order[step.id].filter(id => id !== step.correctId && id !== selected.id).map(id => { const c = step.choices.find(c => c.id === id), letter = String.fromCharCode(65 + run.order[step.id].indexOf(id)); return `<p><strong>${letter}.</strong> ${text(c.explanation)}</p>`; }).join('')}</details></div>` : ''}</fieldset>`;
  }
  function reviewControls(display, sc = false) {
    if (display.mode === 'hidden') return `<div class="review-row"><button type="button" class="btn secondary review-answer" data-action="${sc ? 'sc-review-answer' : 'review-answer'}"><span aria-hidden="true">↺</span> Revoir ma réponse</button><p class="help-text">Tu as déjà répondu à cette question. Réponds de nouveau pour t’entraîner, ou revois ta première réponse et sa correction.</p></div>`;
    if (display.mode === 'review' || display.mode === 'practice') return `<div class="review-row"><div class="actions">${display.mode === 'practice' ? `<button type="button" class="btn secondary" data-action="${sc ? 'sc-review-answer' : 'review-answer'}"><span aria-hidden="true">↺</span> Revoir ma première réponse</button>` : ''}<button type="button" class="btn secondary" data-action="${sc ? 'sc-retry' : 'retry'}">Répondre de nouveau</button></div><p class="help-text">${display.mode === 'review' ? 'Une nouvelle tentative sert d’entraînement ; elle ne change pas ce résultat.' : 'Chaque tentative est conservée sur cet appareil, sans changer ta première note.'}</p></div>`;
    return '';
  }
  function supportDialogs(q, step, ref, source) {
    const head = title => `<div class="qcm-dialog-head"><h2>${title}</h2><button class="icon-button" data-action="close-dialog"><span aria-hidden="true">×</span> Fermer</button></div>`;
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
    const summary = activeMix ? 'Tous les QCM du mélange sont terminés' : activeCourse === DEEPEN_KEY ? 'Les QCM pour approfondir ce savoir sont terminés' : activeCourse ? `Les QCM de ${esc(courseLabel(activeCourse))} sont terminés` : 'Les QCM de cet exercice sont terminés';
    const display = qcmDisplay(q, step, run);
    return `<section class="question-shell"><article class="question-card">${focusSettings()}${deepenBanner()}${questionMeta(ref, step, display.seen)}${stepView(q, step, run.index, run, display)}${reviewControls(display)}${deepenOffer(q, step, display.revealed)}${difficultButton(q, step)}${window.HEPQuickUI?.thumbs() || ''}${window.HEPQuickLevel?.buttons() || ''}<button class="btn secondary qcm-report-button" data-action="report-step">Signaler un problème avec cette question</button><details class="feedback-panel" id="step-feedback" hidden><summary>Mon signalement sur cette question</summary>${HEPFeedback.fields(true)}<label class="field-label" for="step-feedback-category">Catégorie (facultative)</label><select class="select-input" id="step-feedback-category"><option value="">Sans catégorie</option><option>Question</option><option>Propositions</option><option>Correction</option><option>Autre</option></select><label class="field-label" for="step-feedback-comment">Mon commentaire</label><textarea class="feedback-textarea" id="step-feedback-comment" rows="4" maxlength="8000"></textarea><p class="help-text">Le brouillon conserve la question et les contenus consultés au moment de l’ouverture du signalement.</p><div class="actions"><button class="btn primary" data-action="send-step" disabled>Envoyer à Maxim</button></div><p class="save-status" data-send-status role="status" aria-live="polite">Brouillon sur cet appareil.</p><p class="help-text">L’envoi à Maxim ne demande pas de compte Google.</p><details><summary>Sauvegarde personnelle avec Drive (facultative)</summary><p class="help-text">Connecte Drive ici pour sauvegarder depuis cet onglet. La connexion ne se transmet pas aux autres onglets et se termine au rechargement. Elle est indépendante de l’envoi à Maxim.</p><button class="btn secondary" data-action="panel-drive">${HEPDrive.connected() ? 'Synchroniser Drive ici' : 'Connecter Drive ici'}</button><p class="save-status" data-save-status></p></details></details><div class="question-navigation">${index > 0 ? '<button class="btn secondary" data-action="previous">← QCM précédent</button>' : ''}${index + 1 < total ? `<button class="btn primary" data-action="next" ${run.revealed[step.id] ? '' : 'disabled'}>QCM suivant →</button>` : ''}${deepenReturnButton(index, total)}</div>${index === total - 1 && finished ? `<section class="qcm-summary"><h2>${summary}</h2><p>${stats.score} réponse${stats.score > 1 ? 's' : ''} correcte${stats.score > 1 ? 's' : ''} sur ${total}. Tu peux revoir les questions et leurs explications.</p>${window.HEPQuickUI?.group() || ''}</section>` : ''}<div class="actions">${activeMix ? (finished ? '<button class="btn secondary" data-action="mix-first">Revoir le mélange depuis le début</button>' : '') : activeCourse ? `<button class="btn secondary" data-action="course-first">Revoir ${activeCourse === ERRORS_KEY ? 'le parcours' : activeCourse === DEEPEN_KEY ? 'ce savoir' : 'le cours'} depuis le début</button>` : run.checked ? '<button class="btn secondary" data-action="restart">Recommencer les QCM</button>' : ''}${canWrite(q) ? `<a class="btn ${run.checked ? 'primary' : 'secondary'}" href="oral.html#${q.id}">Rédiger cet exercice sans QCM →</a>` : ''}</div></article><details class="feedback-panel" ${saved?.comment ? 'open' : ''}><summary>Mon retour sur cet essai</summary><label class="field-label" for="feedback-category">Cela concerne…</label><select class="select-input" id="feedback-category">${categories.map(c => `<option ${(saved?.category || 'QCM ' + (run.index + 1)) === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select><label class="field-label" for="feedback-comment">Mon commentaire</label><textarea class="feedback-textarea" id="feedback-comment" rows="4" maxlength="8000" placeholder="Ex. : deux propositions me semblent justes ; la correction n’explique pas leur différence…">${esc(saved?.comment || '')}</textarea><p class="help-text">Ton retour conserve les propositions dans l’ordre affiché et leurs explications.</p><p class="save-status" data-save-status></p></details></section>${supportDialogs(q, step, ref, source)}`;
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
    app.innerHTML = `<div class="page ${view === 'exercise' ? 'qcm-focus' : GROUPED_COURSES && view === 'home' ? 'qcm-oral-home' : ''}">${header()}<div id="qcm-main" tabindex="-1">${view === 'exercise' ? (withoutChoices ? scExercise() : exercise()) : view === 'feedback' ? feedback() : view === 'settings' ? settings() : view === 'avis' ? (window.HEPQuickUI?.archive() || '') + (window.HEPQuickLevel?.archive() || '') : home()}</div><footer class="footer"><span class="save-status" data-save-status></span>${view === 'exercise' ? '<button class="btn ghost small" data-action="avis">Mes avis</button><button class="btn ghost small" data-action="feedback">Mes retours</button>' : ''}<a href="index.html">Matières</a>${writingHome ? '<a href="oral.html">Exercices rédigés du bloc oral</a>' : ''}</footer></div>`;
    if (view === 'exercise' && withoutChoices) { displayedRun = visibleRun(active); displayedSC = scStore.read(active, active.steps[scIndex]); displayedSCNavigation = scNavigationVersion(); }
    status(); HEPFeedback.bind();
    if (window.HEPQuickLevel) {
      if (view === 'exercise') {
        const levelStep = active.steps[visibleRun(active).index];
        HEPQuickLevel.bind({ question: { questionId: stepQuestion(active, levelStep).id, contentRevision: active.qcmRevision }, shownWeight: stepWeight(levelStep), getSnapshot: () => withoutChoices ? scSnapshot(active, active.steps[displayedRun.index], displayedRun) : quickSnapshot(active, active.steps[displayedRun.index], displayedRun) });
      } else HEPQuickLevel.bind({});
    }
    window.HEPQuickUI?.bind(view === 'exercise' ? { question: { questionId: stepQuestion(active, active.steps[visibleRun(active).index]).id, contentRevision: active.qcmRevision }, mode: withoutChoices ? 'sans-choix' : 'qcm', getSnapshot: () => withoutChoices ? scSnapshot(active, active.steps[displayedRun.index], displayedRun) : quickSnapshot(active, active.steps[displayedRun.index], displayedRun) } : {});
    document.getElementById('qcm-home-filters')?.addEventListener('submit', event => {
      event.preventDefault(); search = document.getElementById('qcm-search').value.trim(); render();
      document.getElementById('qcm-home-results').focus({ preventScroll: true });
    });
    if (view === 'exercise' && withoutChoices && document.getElementById('sc-response') && !document.getElementById('sc-response').readOnly) bindSCResponse();
    if (view === 'exercise' && withoutChoices) document.getElementById('sc-practice-response')?.addEventListener('input', event => {
      // Brouillon de la nouvelle tentative : gardé dans cet onglet ; il entre dans l'état à l'autoévaluation.
      if (presented?.key === presentedKey(active, active.steps[scIndex])) setPresented({ ...presented, mode: 'practice', response: event.target.value });
      else setPresented({ key: presentedKey(active, active.steps[scIndex]), mode: 'practice', response: event.target.value });
    });
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
        repo.import(raw); changed(); await freezeFirsts(); route(); toast('Sauvegarde QCM réunie avec tes données.');
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
    restoreAncientChoice(); if (GROUPED_COURSES) restoreUnseenChoice();
    activeCourse = null; activeMix = null; active = null; scIndex = 0; emptyPathMessage = ''; frozen = null;
    const course = GROUPED_COURSES && /^cours-([0-9]+(?:-[0-9]+)?)$/.exec(hash);
    if (hash !== DEEPEN_KEY && deepen) setDeepen(null);
    if (GROUPED_COURSES && hash === DEEPEN_KEY) {
      // Sans parcours à approfondir dans cet onglet (nouvel onglet, autre mode), l'accueil s'affiche.
      if (deepen && threeTiers && deepen.mode === (withoutChoices ? 'sc' : 'qcm')) openCourse(DEEPEN_KEY); else setDeepen(null);
    }
    else if (GROUPED_COURSES && hash === 'tout-melanger') openMix();
    else if (GROUPED_COURSES && hash === ERRORS_KEY) openCourse(ERRORS_KEY);
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
    if (button.dataset.action === 'unseen-filter' && GROUPED_COURSES) {
      unseenOnly = !unseenOnly; writeNavigation(selectedUnseenKey(), unseenOnly); route(); return;
    }
    if (button.dataset.action === 'errors' && GROUPED_COURSES) { setPresented(null); return navigate(ERRORS_KEY); }
    if (button.dataset.action === 'toggle-difficult' && active && GROUPED_COURSES) {
      const q = active, step = q.steps[withoutChoices ? scIndex : displayedRun.index];
      let on;
      try { await exclusive(() => { ingestLocal(); on = !isDifficult(q, step); writeNavigation(difficultKey(q, step), on); rememberOwn(difficultKey(q, step)); }); }
      catch (error) { toast(error.message); return; }
      if (!button.isConnected) return;
      button.setAttribute('aria-pressed', String(on)); button.innerHTML = difficultInner(on);
      const help = document.getElementById('difficult-help'); if (help) help.textContent = difficultHelp(on);
      toast(on ? 'Question marquée « Difficile ».' : 'Marque « Difficile » retirée.');
      return;
    }
    if (['review-answer', 'retry', 'sc-review-answer', 'sc-retry'].includes(button.dataset.action) && active) {
      const step = active.steps[withoutChoices ? scIndex : displayedRun.index];
      setPresented({ key: presentedKey(active, step), mode: button.dataset.action.endsWith('retry') ? 'hidden' : 'review' });
      render();
      const focus = document.querySelector(button.dataset.action.endsWith('retry') ? '.qcm-step' : '.qcm-verdict');
      focus?.setAttribute('tabindex', '-1'); focus?.focus({ preventScroll: true }); focus?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (['sc-practice-reveal', 'sc-practice-known', 'sc-practice-review'].includes(button.dataset.action) && active && withoutChoices) {
      const step = active.steps[scIndex], key = presentedKey(active, step), field = document.getElementById('sc-practice-response');
      const current = presented?.key === key && presented.mode === 'practice' ? presented : { key, mode: 'practice' };
      const next = { ...current, response: field ? field.value : current.response || '' };
      if (button.dataset.action === 'sc-practice-reveal') next.revealed = true;
      else {
        if (!next.revealed) return;
        const selfEvaluation = button.dataset.action === 'sc-practice-known' ? 'known' : 'review';
        // Une entrée par autoévaluation ; la première autoévaluation de la question n'est pas touchée.
        try { await addPractice('sc', active, step, { selfEvaluation }, String(next.response || '')); }
        catch (error) { setPresented(next); toast(error.message); return; }
        next.selfEvaluation = selfEvaluation;
      }
      setPresented(next); render();
      const focus = document.querySelector(button.dataset.action === 'sc-practice-reveal' ? '.sc-expected' : '.sc-self-evaluation');
      focus?.focus({ preventScroll: true }); focus?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (button.dataset.action === 'ancient-filter' && GROUPED_COURSES) {
      ancientOnly = !ancientOnly; writeNavigation(selectedAncientKey(), ancientOnly); route(); return;
    }
    if (button.dataset.action === 'tier-deepen' && threeTiers) {
      // « + Approfondir » : interrupteur dans le cadre Essentiel ; depuis « Tout le bloc », il choisit Essentiel + approfondi.
      const next = levelFilter === 'approfondi' ? 'essentiel' : 'approfondi';
      levelFilter = next; writeNavigation(selectedLevelKey(), next); route(); return;
    }
    if (button.dataset.action === 'deepen-open' && active && threeTiers) {
      const step = active.steps[withoutChoices ? scIndex : displayedRun.index];
      if (step.level !== 'essentiel' || step.attenteId !== button.dataset.attente || !deepenItems(step.attenteId).length) return;
      let hash; try { hash = decodeURIComponent(location.hash.slice(1)); } catch (_) { hash = ''; }
      if (withoutChoices) hash = hash.slice('sans-choix'.length).replace(/^\//, '');
      setDeepen({ attenteId: step.attenteId, label: attenteById.get(step.attenteId)?.label || '', mode: withoutChoices ? 'sc' : 'qcm', returnHash: hash, presented, cursor: null });
      setPresented(null); return navigate(DEEPEN_KEY);
    }
    if (button.dataset.action === 'deepen-return' && GROUPED_COURSES) return returnFromDeepen();
    if (button.dataset.levelFilter && levelsEnabled) {
      const next = button.dataset.levelFilter;
      if (!(threeTiers ? ['essentiel', 'approfondi', 'tout'] : ['essentiel', 'tout']).includes(next) || next === levelFilter) return;
      // Le cadre Essentiel est déjà choisi quand « + Approfondir » est activé : le toucher ne change rien.
      if (next === 'essentiel' && levelFilter === 'approfondi') return;
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
    if (['home', 'feedback', 'settings', 'avis'].includes(action)) { if (action === 'home') setPresented(null); return navigate(action === 'home' ? '' : action); }

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
      if (['sc-known', 'sc-review'].includes(action) && (!expected.revealed || firstRecord(q, step))) return;
      if (['sc-known', 'sc-review'].includes(action)) { ingestLocal(); if (firstRecord(q, step)) { render(); toast('Une première autoévaluation existe déjà pour cette question. Elle reste celle qui compte.'); return; } }
      const patch = action === 'sc-reveal' ? { revealed: true } : action === 'sc-known' ? { selfEvaluation: 'known' } : action === 'sc-review' ? { selfEvaluation: 'review' } : null;
      if (patch) setPresented({ key: presentedKey(q, step), mode: 'first' }); else setPresented(null);
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
        if (result.ok && patch?.selfEvaluation) await freezeFirsts();
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
      if (button.dataset.step !== step.id || !step.choices.some(c => c.id === choice)) return;
      if (expected.revealed[step.id]) {
        // v25 : question déjà répondue et rouverte masquée : nouvelle tentative d'entraînement.
        // Ni la réponse, ni la note (attempts), ni la filiation de l'essai ne sont réécrites.
        if (!GROUPED_COURSES || qcmDisplay(q, step, expected).mode !== 'hidden') return;
        ingestLocal();
        if (!sameRun(readRun(q), expected)) { render(); toast('L’essai a changé ailleurs. Il a été actualisé.'); return; }
        try { await addPractice('qcm', q, step, { runId: expected.id, choice, correct: choice === step.correctId }); }
        catch (error) { toast(error.message); return; }
        if (!button.isConnected) return;
        setPresented({ key: presentedKey(q, step), mode: 'practice', choice });
        render(); const verdict = document.querySelector('.qcm-verdict'); verdict?.focus({ preventScroll: true }); verdict?.scrollIntoView({ block: 'nearest' });
        return;
      }
      return mutateRun(q, expected, run => {
        run.answers[step.id] = choice; run.revealed[step.id] = true;
        run.checked = q.steps.every(s => run.revealed[s.id]); return run;
      }, run => {
        repo.grade({ id: q.id + '::' + step.id, contentRevision: q.qcmRevision }, choice === step.correctId ? 2 : 0, run.id, run.hintUsed);
        changed(); setPresented({ key: presentedKey(q, step), mode: 'first' });
        if (view === 'exercise' && active?.id === q.id) { render(); const verdict = document.querySelector('.qcm-verdict'); verdict.focus({ preventScroll: true }); verdict.scrollIntoView({ block: 'nearest' }); }
      });
    }
    if (['mix-first', 'course-first', 'next', 'previous', 'restart'].includes(action)) setPresented(null);
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
  window.addEventListener('storage', event => { if (event.key === KEY && event.newValue) { try { repo.ingest(JSON.parse(event.newValue)); status(); refreshRunControls(); verifyOwn(event.newValue); freezeFirsts(); } catch (_) { toast('La sauvegarde d’un autre onglet est illisible.'); } } });
  (async () => {
    try {
      if (IS_ORAL && !oralNavigation) throw new Error('Les thèmes du bloc oral sont indisponibles. Recharge la page en ligne.');
      const response = await fetch(collection.bank || 'data/qcm-pilote.json', { cache: 'no-cache' }); if (!response.ok) throw new Error('La banque QCM est indisponible.');
      bank = await response.json(); if (bank.id !== SCOPE || bank.schemaVersion !== 1 || !bank.exercises?.length || (SCOPE === 'fra-qcm-pilote' && bank.exercises.length !== 3)) throw new Error('Format QCM incompatible.');
      if (GROUPED_COURSES && !IS_ORAL && !Array.isArray(bank.courseGroups)) throw new Error('Parcours QCM absents.');
      if (bank.courseGroups && (!Array.isArray(bank.courseGroups) || !bank.courseGroups.length || new Set(bank.courseGroups.map(g => g.key)).size !== bank.courseGroups.length || !bank.courseGroups.every(g => typeof g.key === 'string' && /^[0-9]+(?:-[0-9]+)?$/.test(g.key) && typeof g.label === 'string' && (g.kind === undefined || g.kind === 'liens')) || !bank.exercises.every(q => bank.courseGroups.some(g => g.key === q.courseGroupKey) && typeof q.hasWrittenExercise === 'boolean'))) throw new Error('Parcours QCM incompatibles.');
      if (bank.navigationOrder) {
        const expected = new Set(bank.exercises.flatMap(q => q.steps.map(step => JSON.stringify([q.id, step.id]))));
        if (!Array.isArray(bank.navigationOrder) || bank.navigationOrder.length !== expected.size || new Set(bank.navigationOrder.map(ref => JSON.stringify([ref.exerciseId, ref.stepId]))).size !== expected.size || !bank.navigationOrder.every(ref => expected.has(JSON.stringify([ref.exerciseId, ref.stepId])))) throw new Error('Ordre de parcours incompatible.');
      }
      byId = new Map(bank.exercises.map(q => [q.id, q]));
      attenteById = new Map(Array.isArray(bank.attentes) ? bank.attentes.filter(a => a && typeof a.id === 'string' && typeof a.label === 'string' && typeof a.operation === 'string' && (a.weight === null || [1, 2, 3].includes(a.weight))).map(a => [a.id, a]) : []);
      const allLevels = bank.exercises.flatMap(q => q.steps.map(step => step.level));
      threeTiers = GROUPED_COURSES && allLevels.every(level => THREE_LEVELS.includes(level)) && allLevels.includes('essentiel-approfondi');
      levelsEnabled = threeTiers || (GROUPED_COURSES && allLevels.every(level => TWO_LEVELS.includes(level)));
      if (levelsEnabled) restoreLevelChoice();
      HEPDrive.init(repo, status, () => { freezeFirsts(); if (view !== 'exercise') render(); else refreshRunControls(); }); repo.save();
      await freezeFirsts(); route();
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    } catch (error) { bank = null; app.innerHTML = `<section class="empty-state"><h1>Les QCM n’ont pas pu s’ouvrir.</h1><p>${esc(error.message)}</p><p>Reconnecte-toi puis recharge la page. Tes données restent dans ce navigateur.</p><a href="index.html">Retour aux matières</a></section>`; }
  })();
}());
