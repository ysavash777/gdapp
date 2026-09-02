// Service Worker: cache del app-shell, network-first con fallback a cache.
// Subir CACHE invalida el cache anterior en 'activate'.

const CACHE = 'gdapp-shell-v8';

const SHELL = [
  '/app',
  '/app/index.html',
  '/app/app.css',
  '/app/app.js',
  '/app/manifest.webmanifest',
  '/app/icons/icon.png',
  '/shared/images/login-bg.jpg',
  '/shared/styles/tokens.css',
  '/shared/styles/base.css',
  '/shared/styles/components.css',
  '/shared/styles/auth.css',
  '/shared/js/icons.js',
  '/shared/js/format.js',
  '/shared/js/avatars.js',
  '/shared/js/session.js',
  '/shared/js/auth-view.js',
  '/app/scanner/camera.js',
  '/app/scanner/engines/index.js',
  '/app/scanner/engines/android-engine.js',
  '/app/modules/mapear/index.js',
  '/app/modules/mapear/store.js',
  '/app/modules/mapear/list-view.js',
  '/app/modules/mapear/editor-view.js',
  '/app/modules/mapear/format.js',
  '/app/modules/consultas/index.js',
  '/app/modules/consultas/store.js',
  '/app/modules/consultas/scanner-view.js',
  '/app/modules/vencimientos.js',
  '/app/modules/vacios.js',
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

  // { cache: 'reload' } fuerza que ESTE fetch ignore la caché HTTP del
  // navegador — sin esto, "network-first" es una mentira: el fetch de
  // acá abajo puede resolverse contra el disco (Cache-Control max-age)
  // sin tocar la red, y entonces ni un hard-refresh del usuario alcanza
  // para ver un JS/CSS nuevo hasta que venza el max-age.
  e.respondWith(
    fetch(e.request, { cache: 'reload' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('/app/index.html')))
  );
});
