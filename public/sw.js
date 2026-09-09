// Service worker mínimo. No cachea nada de forma agresiva — esta app siempre
// necesita datos frescos del servidor — pero su sola presencia es uno de los
// requisitos que pide Chrome/Android para poder "instalar" la página como app.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Las llamadas a la API (los datos reales) siempre van directo a la red,
  // nunca a caché, para no mostrar información desactualizada.
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
