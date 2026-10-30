(function () {
  'use strict';
  const KEY = 'hep-revisions-feedback-first-name';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const name = () => { try { return localStorage.getItem(KEY) || ''; } catch (_) { return ''; } };
  function fields() { return `<label class="field-label" for="feedback-first-name">Prénom (facultatif)</label><input class="text-input" id="feedback-first-name" maxlength="80" autocomplete="given-name" value="${esc(name())}" placeholder="Ton prénom"><p class="help-text">Mémorisé sur cet appareil. Copie tes retours, puis envoie-les à Maxim par message. Aucun envoi automatique.</p>`; }
  function bind() { document.getElementById('feedback-first-name')?.addEventListener('input', event => { try { localStorage.setItem(KEY, event.target.value.slice(0, 80)); } catch (_) { /* Copy still works without local storage. */ } }); }
  function report(title, items) {
    const firstName = document.getElementById('feedback-first-name')?.value.trim() || name().trim();
    return title + (firstName ? '\nPrénom : ' + firstName : '') + '\n\n' + items.map((item, i) => `${i + 1}. ${item.category || 'Retour'}\n\nCONTENU CONSERVÉ\n${item.snapshot.question}\n\nCHOIX, CORRECTION OU EXPLICATIONS CONSERVÉS\n${item.snapshot.answer || 'Non affichés au moment du signalement.'}\n\nAIDES CONSERVÉES\n${item.snapshot.hint || 'Aucune aide affichée.'}\n\nMON RETOUR\n${item.comment}\n\nRéférence : ${item.questionId} · ${item.contentRevision}`).join('\n\n──────────\n\n');
  }
  window.HEPFeedback = { fields, bind, report, archiveLink: '<p class="help-text"><a href="archives.html">Anciens essais : consulter les retours et les sauvegardes</a></p>' };
}());
