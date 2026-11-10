(function () {
  'use strict';
  // v23 : les collections masquées restent en place (pages, données, sauvegardes) ;
  // CONFIG.COLLECTIONS_VISIBLES choisit seulement les tuiles de l'accueil.
  // Valeurs : 'fra-oral', 'cla', 'dev', 'shs'. Sans réglage lisible, la page garde son état statique.
  const visible = window.CONFIG?.COLLECTIONS_VISIBLES;
  if (!Array.isArray(visible)) return;
  const tiles = [...document.querySelectorAll('[data-collection]')];
  tiles.forEach(tile => { tile.hidden = !visible.includes(tile.dataset.collection); });
  const note = document.querySelector('[data-collections-note]');
  if (note) note.hidden = tiles.every(tile => !tile.hidden);
}());
