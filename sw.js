/* SIMONIK-LG v2 — service worker: app shell offline + cache pustaka CDN.
   Panggilan API (script.google.com) TIDAK pernah di-cache: data dikelola app.js (IndexedDB + antrean). */
const VERSI = 'simonik-v2.0.0';
const SHELL = ['./', './index.html', './css/style.css', './js/config.js', './js/core.js', './js/app.js', './js/admin.js', './js/landing.js', './manifest.webmanifest', './icons/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSI).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSI && k !== VERSI + '-cdn').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || /script\.google(usercontent)?\.com$/.test(u.hostname)) return;
  if (u.origin === location.origin) {
    // Network-first untuk file aplikasi (update langsung terasa), cadangan cache saat offline
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSI).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
    return;
  }
  if (/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com|tile\.openstreetmap\.org/.test(u.hostname)) {
    // Cache-first untuk pustaka berversi, font, dan ubin peta
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(VERSI + '-cdn').then(x => x.put(e.request, c)); } return r; })));
  }
});
