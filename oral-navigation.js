(function () {
  'use strict';
  // Navigation groups shared by both oral paths; pedagogical families stay in their banks.
  const groups = [
    { label: 'Repères et enseignement', themes: ['Fondements', 'Curriculum', 'Genres', 'Oral et écrit'] },
    { label: 'Acquisition et diversité', themes: ['Acquisition', 'Hétérogénéité'] },
    { label: 'Développement et langue', themes: ['Développement', 'Syntaxe'] },
    { label: 'Interactions et étayage', themes: ['Étayer', 'Interaction', 'Oralité'] },
    { label: 'Récits et compréhension', themes: ['Récit', 'Compréhension'] },
    { label: 'Dispositifs et régulation', themes: ['Argumentation', 'Dispositifs', 'Évaluer et réguler'] }
  ];
  const normalize = value => String(value ?? '').toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const themeFor = family => groups.find(group => group.themes.includes(family.theme))?.label || family.theme;
  const themesFor = families => [...groups.map(group => group.label), ...families.map(themeFor)]
    .filter((theme, index, values) => values.indexOf(theme) === index && families.some(family => themeFor(family) === theme));
  window.HEPOralNavigation = Object.freeze({ groups, normalize, themeFor, themesFor });
}());
