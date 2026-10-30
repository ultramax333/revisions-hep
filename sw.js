'use strict';
const CACHE = 'hep-revisions-v1.8.4';
const ROOT = new URL('./', self.location.href);
const CORE = ['./', 'index.html', 'style.css', 'icon.svg', 'manifest.webmanifest', 'config.js', 'store.js', 'feedback-tools.js', 'archives.html', 'archives.js', 'drive.js', 'exercices.html', 'exercices-config.js', 'exercices.js', 'data/exercices-fra01.json', 'oral.html', 'oral-config.js', 'oral-navigation.js', 'data/exercices-oral.json', 'qcm.html', 'qcm-config.js', 'qcm.js', 'data/qcm-pilote.json', 'qcm-oral.html', 'qcm-oral-config.js', 'data/qcm-oral.json'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE.map(path => new URL(path, ROOT).href))).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('hep-revisions-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const clone = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, clone))); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match(new URL('index.html', ROOT).href) : Response.error())));
});
