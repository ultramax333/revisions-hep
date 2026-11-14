// v29 : visite guidée contextuelle, lancée seulement par « Comment utiliser ce quiz ? ».
// Bulles ancrées sur l'interface réelle, une à la fois. État : sessionStorage (clé dédiée), rien d'autre n'est écrit.
(function () {
  'use strict';
  const KEY = 'hep-quiz-tour-v1';
  const read = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || null; } catch (e) { return null; } };
  const write = s => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignoré */ } };
  const clear = () => { try { sessionStorage.removeItem(KEY); } catch (e) { /* ignoré */ } };
  const $ = s => document.querySelector(s);
  const visible = el => { if (!el || el.hidden || el.closest('[hidden]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  // Étapes de l'accueil du quiz (cible absente : étape sautée).
  const HOME = [
    { target: () => $('.qcm-mode-switch'), text: 'Mode : QCM ou sans choix' },
    { target: () => document.getElementById('qcm-level-label')?.parentElement, text: 'Niveau : Essentiel, puis Approfondir' },
    { target: () => $('[data-action="mix"]'), text: 'Tout mélanger : c’est parti' },
    { target: () => $('.qcm-errors-start'), text: 'Mes erreurs et difficiles', last: 'Lance une question : je te guide.' }
  ];
  const INDEX_STEP = { target: () => [...document.querySelectorAll('[data-collection]:not([hidden]) a.btn.primary')].find(visible), text: 'Ouvre un quiz : je te guide.', last: '' };
  // Bulles contextuelles (une fois chacune).
  const CTX = {
    choices: { target: () => $('.qcm-step .qcm-choices'), text: 'Touche une réponse' },
    vote: { target: () => $('.quick-vote-buttons') || $('.quick-vote'), text: 'Utile ou claire ?' },
    level: { target: () => $('.quick-level-buttons') || $('.quick-level'), text: 'Note 1-4 : à savoir ou pas' }
  };

  let bubble, veil, current = null, raf = 0, bypass = false, lastFocus = null, tour = null;

  function ensure() {
    if (bubble) return;
    veil = document.createElement('div'); veil.className = 'qt-veil'; veil.hidden = true; veil.setAttribute('aria-hidden', 'true');
    bubble = document.createElement('div'); bubble.className = 'qt-bubble'; bubble.hidden = true;
    bubble.setAttribute('role', 'dialog'); bubble.setAttribute('aria-live', 'polite'); bubble.setAttribute('aria-label', 'Visite guidée');
    document.body.append(veil, bubble);
  }

  function place() {
    raf = 0;
    if (!current) return;
    const el = current.target();
    if (!visible(el)) { bubble.hidden = veil.hidden = true; return; }
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let r = el.getBoundingClientRect();
    if (current.needScroll) {
      current.needScroll = false;
      if (r.top < 8 || r.bottom > vh - 8) { el.scrollIntoView({ block: 'center', behavior: 'auto' }); r = el.getBoundingClientRect(); }
    }
    const pad = 6;
    Object.assign(veil.style, { left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + 2 * pad) + 'px', height: (r.height + 2 * pad) + 'px' });
    veil.hidden = !current.spot;
    bubble.hidden = false;
    const w = Math.min(300, vw - 32);
    bubble.style.width = w + 'px';
    const bh = bubble.offsetHeight, gap = 12;
    const below = vh - r.bottom - pad - gap, above = r.top - pad - gap;
    const side = below >= bh + 8 || below >= above ? 'below' : 'above';
    let top = side === 'below' ? r.bottom + pad + gap : r.top - pad - gap - bh;
    let arrow = true;
    // Ni en haut ni en bas : la bulle reste dans l'écran, sans pointe.
    if (top < 8 || top + bh > vh - 8) { top = Math.max(8, Math.min(top, vh - bh - 8)); arrow = false; }
    const left = Math.max(16, Math.min(r.left + r.width / 2 - w / 2, vw - w - 16));
    bubble.style.left = left + 'px'; bubble.style.top = top + 'px';
    bubble.dataset.side = arrow ? side : 'none';
    bubble.style.setProperty('--qt-arrow', Math.max(18, Math.min(r.left + r.width / 2 - left, w - 18)) + 'px');
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };

  function show(step, html, focusSel) {
    ensure();
    current = step; step.needScroll = true;
    bubble.innerHTML = html;
    bubble.dataset.ctx = step.ctx ? '1' : '';
    bubble.hidden = false;
    place();
    if (focusSel) { lastFocus = document.activeElement; bubble.querySelector(focusSel)?.focus({ preventScroll: true }); }
  }
  function hide() { current = null; if (bubble) bubble.hidden = veil.hidden = true; }

  // ---- Visite de l'accueil -------------------------------------------------
  function startTour(button) {
    let steps = HOME.filter(s => visible(s.target()));
    const onIndex = !steps.length && !!INDEX_STEP.target();
    if (onIndex) steps = [INDEX_STEP];
    if (!steps.length) { bypass = true; button?.click(); bypass = false; return; }  // rien à montrer : dialogue habituel
    const s0 = read() || {};
    write({ ctx: true, done: s0.done || [], chain: onIndex });
    tour = { steps, i: 0, button, onIndex };
    renderTour();
  }
  function renderTour() {
    const { steps, i } = tour, s = steps[i], n = steps.length, last = i === n - 1;
    const more = last && !tour.onIndex ? '<button type="button" class="qt-link" data-qt="more">Plus d’aide</button>' : '';
    const extra = last && s.last ? `<p class="qt-sub">${s.last}</p>` : '';
    const html = `<p class="qt-text">${s.text}</p>${extra}<div class="qt-row">${n > 1 ? `<span class="qt-count" aria-label="Étape ${i + 1} sur ${n}">${i + 1}/${n}</span>` : '<span class="qt-count"></span>'}${last ? '' : '<button type="button" class="qt-link" data-qt="skip">Passer</button>'}${more}<button type="button" class="qt-btn" data-qt="${last ? 'done' : 'next'}">${last ? 'Compris' : 'Suivant'}</button></div>`;
    show({ target: s.target, spot: true }, html, '[data-qt="' + (last ? 'done' : 'next') + '"]');
  }
  function endTour(clearAll) {
    const btn = tour?.button, keepChain = tour?.onIndex; tour = null; hide();
    if (clearAll) clear(); else { const s = read(); if (s && !keepChain) { s.chain = false; write(s); } }
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true }); else if (btn?.isConnected) btn.focus({ preventScroll: true });
    if (!clearAll) evaluate();
  }

  // ---- Bulles contextuelles ------------------------------------------------
  function markDone(name) {
    const s = read(); if (!s) return;
    s.done = [...new Set([...(s.done || []), name])];
    if (s.done.length >= 3) clear(); else write(s);
  }
  function showCtx(name) {
    if (current?.ctx === name) return;
    const c = CTX[name];
    show({ target: c.target, spot: false, ctx: name }, `<p class="qt-text">${c.text}</p><button type="button" class="qt-x" data-qt="close" aria-label="Fermer">OK</button>`);
  }
  function evaluate() {
    if (tour) return;
    const s = read();
    if (!s || !s.ctx) { if (current?.ctx) hide(); return; }
    const done = s.done || [];
    const inQuestion = !!$('.qcm-step');
    const answered = !!$('.qcm-verdict');
    if (!inQuestion) { if (current?.ctx) hide(); return; }
    if (current?.ctx === 'choices' && answered) { markDone('choices'); hide(); return evaluate(); }
    if (!done.includes('choices')) {
      if (answered) { markDone('choices'); return evaluate(); }
      if ($('.qcm-step [data-choice]')) showCtx('choices');  // mode sans choix : pas de bulle sur les réponses
      return;
    }
    if (!answered) { if (current?.ctx) hide(); return; }
    if (!done.includes('vote')) { if (visible($('.quick-vote'))) showCtx('vote'); return; }
    if (!done.includes('level')) {
      if (visible($('.quick-level'))) showCtx('level');
      else if (!$('.quick-level') && !current?.ctx) markDone('level');  // pas de note dans ce quiz
    }
  }
  const obs = () => { schedule(); evaluate(); };

  // ---- Événements ----------------------------------------------------------
  window.addEventListener('click', event => {
    const button = event.target.closest?.('[data-quiz-help]');
    if (button && !bypass) { event.preventDefault(); event.stopImmediatePropagation(); startTour(button); return; }
    const act = event.target.closest?.('[data-qt]')?.dataset.qt;
    if (act) {
      if (act === 'next') { tour.i++; renderTour(); }
      else if (act === 'skip') endTour(true);
      else if (act === 'done') endTour(false);
      else if (act === 'more') { const b = tour.button; endTour(false); bypass = true; b?.click(); bypass = false; }
      else if (act === 'close' && current?.ctx) { const n = current.ctx; hide(); markDone(n); }
      return;
    }
    // Un tap sur la bulle contextuelle ou sur sa cible (pouces, note) la ferme ; les réponses la ferment en s'affichant corrigées.
    if (current?.ctx) {
      const el = current.target();
      if (event.target.closest?.('.qt-bubble') || (el && current.ctx !== 'choices' && el.contains(event.target))) { const n = current.ctx; hide(); markDone(n); }
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && current && !document.querySelector('dialog[open]')) {
      event.preventDefault();
      if (tour) endTour(true); else if (current.ctx) { const n = current.ctx; hide(); markDone(n); }
    } else if (event.key === 'Tab' && tour && !bubble.hidden) {
      const items = [...bubble.querySelectorAll('button')], i = items.indexOf(document.activeElement);
      event.preventDefault();
      items[event.shiftKey ? (i <= 0 ? items.length : i) - 1 : (i + 1) % items.length].focus();
    }
  });
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.addEventListener('scroll', schedule, true);
  window.visualViewport?.addEventListener('resize', schedule);

  function init() {
    new MutationObserver(obs).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
    const s = read();
    if (s?.chain) {
      // Visite lancée depuis l'accueil du site : elle se poursuit sur l'accueil du quiz, une fois affiché.
      let tries = 0;
      const wait = setInterval(() => {
        if (visible($('[data-action="mix"]'))) { clearInterval(wait); write({ ...s, chain: false }); startTour(null); }
        else if (++tries > 40) clearInterval(wait);
      }, 250);
    } else evaluate();
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
}());
