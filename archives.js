(function () {
  'use strict';
  const S = HEPStore, app = document.getElementById('app');
  const collections = [{ label: 'Ancien essai QCM', scope: 'fra-qcm-pilote', key: 'hep-revisions-qcm-state-v1', bank: 'data/qcm-pilote.json' }, { label: 'Exercices pilotes FRA 01', scope: 'fra01-pilote', key: 'hep-revisions-exercices-state-v1', bank: 'data/exercices-fra01.json' }];
  let index = 0, repo, bank, generation = 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const comments = () => S.feedbackThreads(repo.state).filter(item => !item.deleted && item.comment.trim());
  function notify(message) { const n = document.getElementById('toast'); n.textContent = message; n.hidden = false; }
  function download(name, data, type = 'application/json') { const url = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], {type})); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  function draftText(key, item) {
    const q = bank?.exercises.find(q => key.includes(q.id));
    let run; try { run = JSON.parse(item.text); } catch (_) { return item.text; }
    if (!run?.answers || !q?.steps) return item.text;
    return q.steps.map(step => {
      const order = run.order?.[step.id] || step.choices.map(c => c.id);
      return step.prompt + '\n' + order.map((id, i) => String.fromCharCode(65 + i) + '. ' + (step.choices.find(c => c.id === id)?.text || id) + (run.answers[step.id] === id ? ' — mon choix' : '')).join('\n') + '\n' + (run.revealed?.[step.id] || run.checked ? 'Correction consultée.' : 'Correction non consultée.');
    }).join('\n\n');
  }
  function render() {
    app.innerHTML = `<h1>Anciens essais</h1><p><a href="qcm-oral.html">QCM du bloc oral</a> · <a href="oral.html">Rédiger dans le bloc oral</a></p><p>Les entrées pilotes ont été reprises dans le bloc oral. Leurs données restent séparées, consultables et exportables ici.</p><label class="field-label" for="archive-collection">Collection archivée</label><select class="select-input" id="archive-collection">${collections.map((c,i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>${HEPFeedback.fields()}<div class="actions"><button class="btn primary" data-action="copy" ${comments().length ? '' : 'disabled'}>Copier mes retours</button><button class="btn secondary" data-action="feedback">Télécharger les retours</button><button class="btn secondary" data-action="backup">Télécharger la sauvegarde</button><button class="btn secondary" data-action="import">Importer une sauvegarde de cette archive</button><input type="file" id="archive-file" accept=".json,application/json" hidden></div><p class="save-status">${esc(repo.warning)}</p><h2>Retours conservés</h2>${comments().map(item => `<article class="feedback-item"><h3>${esc(item.snapshot.question.split('\n')[0])}</h3><p class="exercise-text">${esc(item.comment)}</p><details><summary>Contenu conservé avec ce retour</summary><pre class="exercise-text">${esc(HEPFeedback.report('', [item]))}</pre></details></article>`).join('') || '<p>Aucun retour sur cet appareil pour cette archive.</p>'}<h2>Réponses et essais conservés</h2>${Object.entries(repo.state.drafts).map(([key,item]) => `<details class="settings-card"><summary>${esc(bank?.exercises.find(q => key.includes(q.id))?.title || key)}</summary><pre class="exercise-text">${esc(draftText(key,item))}</pre></details>`).join('') || '<p>Aucune réponse conservée.</p>'}<h2>Résultats conservés</h2>${Object.values(repo.state.attempts).map(item => `<p>${esc(item.questionId)} : ${item.grade} / 2 · ${esc(new Date(item.updatedAt).toLocaleString('fr-CH'))}</p>`).join('') || '<p>Aucun résultat conservé.</p>'}`;
    HEPFeedback.bind();
    document.getElementById('archive-collection').onchange = event => { index = Number(event.target.value); load(); };
    document.getElementById('archive-file').onchange = async event => {
      const file = event.target.files[0]; if (!file) return;
      try { if (file.size > 25 * 1024 * 1024) throw new Error('Ce fichier est trop volumineux.'); const raw = JSON.parse(await file.text()); if (raw.scope !== collections[index].scope) throw new Error('Choisis une sauvegarde de cette collection archivée.'); repo.import(raw); render(); notify('Sauvegarde réunie avec cette archive.'); } catch (error) { notify(error.message); }
    };
  }
  async function load() {
    const current = ++generation, c = collections[index];
    repo = new S.Repository({getItem: () => localStorage.getItem(c.key), setItem: (_, value) => localStorage.setItem(c.key, value)});
    bank = null; render();
    try { const response = await fetch(c.bank); if (!response.ok) throw new Error(); const loaded = await response.json(); if (current !== generation) return; bank = loaded; render(); } catch (_) { if (current === generation) notify('Les contenus archivés sont indisponibles ; les données locales restent exportables.'); }
  }
  app.addEventListener('click', async event => {
    const action = event.target.closest('button')?.dataset.action, c = collections[index];
    if (action === 'backup') download(c.scope + '-sauvegarde.json', {...repo.state, scope:c.scope});
    if (action === 'feedback') download(c.scope + '-retours.json', {...S.feedbackBundle(repo.state, bank || {}), scope:c.scope});
    if (action === 'import') document.getElementById('archive-file').click();
    if (action === 'copy') { const report = HEPFeedback.report('Retours — ' + c.label, comments()); try { await navigator.clipboard.writeText(report); notify('Retours copiés. Envoie-les à Maxim par message.'); } catch (_) { download(c.scope + '-retours.txt', report, 'text/plain'); } }
  });
  window.addEventListener('storage', event => { if (event.key === collections[index].key && event.newValue) { try { repo.ingest(JSON.parse(event.newValue)); render(); } catch (_) { notify('Les données d’un autre onglet sont illisibles.'); } } });
  load();
}());
