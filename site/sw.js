/* Guarda a casca do app para abrir rápido e sem internet.
   A API nunca vem do cache: os dados são sempre os do servidor. */
const VERSAO = 'base-v3';
const CASCA = ['/', '/manifest.webmanifest', '/icone-app-192.png', '/fontes/manrope-latin.woff2', '/fontes/manrope-latin-ext.woff2'];
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
