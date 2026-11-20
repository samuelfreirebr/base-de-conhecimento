/* Guarda a casca do app para abrir rápido e sem internet.
   A API nunca vem do cache: os dados são sempre os do servidor. */
const VERSAO = 'base-v7';
const CASCA = ['/', '/manifest.webmanifest', '/icone-app-192.png', '/fontes/manrope-latin.woff2', '/fontes/manrope-latin-ext.woff2', '/tabler.css', '/fontes/tabler-subset.woff2', '/d3.min.js'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname === '/sair' || url.origin !== location.origin) return;
  /* rede primeiro (sempre a versão nova); sem rede, o que estiver guardado */
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && r.type === 'basic') { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});

/* Notificação do próprio app (servidor/push.js): mostra e, ao tocar, abre o app no endereço do aviso */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { texto: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Base de conhecimento', { body: d.texto || '', icon: '/icone-app-192.png', badge: '/icone-app-192.png', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((abertas) => {
    const ja = abertas.find((c) => c.url.startsWith(self.location.origin));
    return ja ? ja.navigate(url).then((c) => (c || ja).focus()) : self.clients.openWindow(url);
  }));
});
