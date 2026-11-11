// v25 : version du site bien visible en haut de chaque page, tirée de CONFIG.APP_VERSION (AGENTS §2).
(function () {
  'use strict';
  function show() {
    const version = String(window.CONFIG?.APP_VERSION || '').trim();
    if (!version || document.querySelector('.app-version-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'app-version-bar';
    const label = document.createElement('span');
    label.className = 'app-version';
    label.textContent = 'Version ' + version;
    bar.append(label);
    const main = document.querySelector('body > main') || document.body.firstElementChild;
    document.body.insertBefore(bar, main);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
}());
