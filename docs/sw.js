// App shell cache: always ask the server first (bypassing the browser's HTTP cache) so updates show up at once; use the cache only offline.
const CACHE = 'yawmeya-v7';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.endsWith('supabase.co')) return;
  const same = u.origin === location.origin;
  if (!same && u.hostname !== 'cdn.jsdelivr.net' && !u.hostname.endsWith('gstatic.com') && !u.hostname.endsWith('googleapis.com')) return;
  e.respondWith(fetch(same ? new Request(e.request, {cache:'no-cache'}) : e.request).then(r => {
    if (r.ok){ const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch:same})));
});
