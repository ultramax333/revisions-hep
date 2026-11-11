(function () {
  'use strict';
  let dialog, opener;
  function open(button) {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'quiz-help-dialog';
      dialog.setAttribute('aria-labelledby', 'quiz-help-title');
      dialog.innerHTML = `<h2 id="quiz-help-title" tabindex="-1">Comment utiliser ce quiz ?</h2>
        <p>L'idée, en deux temps :</p>
        <ol><li><strong>D'abord les QCM</strong>, pour apprendre les notions et les distinguer. Commencez par « Essentiel », la base : une question par savoir. « + Approfondir » ajoute le détail des savoirs centraux ; « Tout le bloc » ajoute aussi « pour aller plus loin ».</li>
        <li><strong>Ensuite « Sans les choix »</strong> : les mêmes questions, sans les propositions. Cherchez la réponse vous-même, puis affichez la réponse attendue et évaluez-vous. C'est plus proche de l'examen.</li></ol>
        <p>Après la correction d'une question de l'essentiel, le bouton « Approfondir ce savoir » ouvre ses questions de détail, puis « Retour au parcours » vous ramène là où vous étiez.</p>
        <p>Le filtre « Anciens examens » ne garde que les questions reprises d'examens des années précédentes, de tous les niveaux.</p>
        <p>« Seulement les questions pas encore vues » cache celles auxquelles vous avez déjà répondu. Une question déjà faite porte l'étiquette « Déjà vue » et s'affiche sans la réponse : répondez de nouveau pour vous entraîner, ou touchez « Revoir ma réponse ». Seule la première réponse compte dans vos résultats.</p>
        <p>Le bouton « Difficile » (drapeau) garde une question dans « Mes erreurs et difficiles », avec vos réponses fausses. Touchez-le encore pour retirer la marque. Elle reste sur votre appareil et n'est pas envoyée.</p>
        <p><strong>Vos retours m'aident beaucoup :</strong></p>
        <ul><li>👍 / 👎 sous une question : elle est utile, ou pas claire. Votre avis m'arrive tout seul, rien d'autre à faire.</li>
        <li>L'étiquette « 1 · À maîtriser », « 2 · À connaître » ou « 3 · À rencontrer » dit le poids du savoir pour l'examen. Les boutons 1 à 4 sous la question disent si ce classement vous paraît juste (4 : inutile pour l'examen). Votre avis ne change pas l'étiquette.</li>
        <li>« Signaler un problème avec cette question » : une erreur, une question ambiguë… vous pouvez écrire un petit texte, puis cliquer sur « Envoyer à Maxim ».</li></ul>
        <p>Grâce à vos retours, je corrige les questions et j'améliore le site au fur et à mesure. Merci !</p>
        <div class="actions"><button type="button" class="btn secondary" data-close-quiz-help>Fermer</button></div>`;
      document.body.append(dialog);
      dialog.querySelector('[data-close-quiz-help]').addEventListener('click', () => dialog.close());
      dialog.addEventListener('keydown', event => {
        // The short dialogue has a single control. Keep Tab in the modal,
        // including browsers that otherwise move focus to their address bar.
        if (event.key === 'Tab') { event.preventDefault(); dialog.querySelector('[data-close-quiz-help]').focus(); }
      });
      dialog.addEventListener('click', event => {
        const r = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close();
      });
      dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
    }
    opener = button;
    dialog.showModal();
    dialog.querySelector('h2').focus({ preventScroll: true });
    dialog.scrollTop = 0;
  }
  document.addEventListener('click', event => { const button = event.target.closest('[data-quiz-help]'); if (button) open(button); });
}());
