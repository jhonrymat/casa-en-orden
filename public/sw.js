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

// Muestra la notificación push que manda el servidor (resumen diario de
// pagos vencidos o por vencer).
self.addEventListener('push', (event) => {
  let data = { title: 'Casa en orden', body: 'Tienes pagos pendientes.', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) { /* si no viene JSON, se usa el texto por defecto */ }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
    })
  );
});

// Al tocar la notificación, abre (o enfoca) la app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
