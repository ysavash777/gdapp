/* ============================================================
   GDapp · Service Worker — cache básico del app-shell
   Estrategia: network-first con fallback a cache (la app siempre
   intenta lo fresco; sin red, sirve lo guardado).
   ============================================================ */

const CACHE = 'gdapp-shell-v3';

const SHELL = [
  '/app',
  '/app/index.html',
  '/app/app.css',
  '/app/app.js',
  '/app/manifest.webmanifest',
  '/app/icons/icon.png',
  '/shared/images/login-bg.png',
  '/shared/styles/tokens.css',
  '/shared/styles/base.css',
  '/shared/styles/components.css',
  '/shared/styles/auth.css',
  '/shared/js/icons.js',
  '/shared/js/avatars.js',
  '/shared/js/session.js',
  '/shared/js/auth-view.js',
  '/app/modules/mapear/index.js',
  '/app/modules/mapear/store.js',
  '/app/modules/mapear/list-view.js',
  '/app/modules/mapear/scanner-view.js',
  '/app/modules/mapear/format.js',
  '/app/modules/negadas.js',
  '/app/modules/vacios.js',
  '/app/modules/consultas.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // La API nunca se cachea
  if (url.pathname.startsWith('/api/')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('/app/index.html')))
  );
});
