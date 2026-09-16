/* Service worker.
   Los archivos de la aplicación se piden a la red primero, para que nadie se
   quede con una versión vieja; la caché es el respaldo cuando no hay internet.
   El número de versión lo sube `publicar.ps1` en cada publicación. */
const VERSION = 'v12';
const CACHE = 'idv-' + VERSION;

const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/version.js',
  './js/app.js',
  './js/nube.js',
  './js/supabase-config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* La página pregunta qué versión está sirviendo para avisar si no coincide. */
self.addEventListener('message', (event) => {
  const dato = event.data || {};
  if (dato.tipo !== 'version') return;
  const respuesta = { tipo: 'version', version: VERSION };
  // por el canal que abrió la página y también por la vía normal, para que la
  // respuesta llegue aunque el service worker se haya dormido entre medio
  if (event.ports && event.ports[0]) event.ports[0].postMessage(respuesta);
  if (event.source && event.source.postMessage) event.source.postMessage(respuesta);
});

/** Archivos de la aplicación: siempre conviene la copia más nueva. */
function esDeLaApp(req, url) {
  return req.mode === 'navigate' || /\.(html|js|css|webmanifest)$/.test(url.pathname);
}

function guardarEnCache(req, res) {
  const copia = res.clone();
  caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (esDeLaApp(req, url)) {
    // red primero: si hay internet, siempre se ve la última versión publicada
    event.respondWith(
      fetch(req)
        .then((res) => guardarEnCache(req, res))
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  // lo demás (iconos e imágenes) no cambia: sale de la caché
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => guardarEnCache(req, res)))
  );
});
