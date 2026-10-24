// Offline support: precache the whole app shell, serve cache-first, refresh in the background.
const VERSION = 'cc94-v1';
const FILES = [
  './',
  'assets/apple-touch-icon.png',
  'assets/atorpedo.png',
  'assets/backdrop.jpg',
  'assets/explosion.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
  'assets/pest.png',
  'assets/rock1.png',
  'assets/rock2.png',
  'assets/rock3.png',
  'assets/rock4.png',
  'assets/rock5.png',
  'assets/rock6.png',
  'assets/rock7.png',
  'assets/rock8.png',
  'assets/saucer.png',
  'assets/shield.png',
  'assets/ship.png',
  'assets/sprites.json',
  'assets/thrust.png',
  'assets/torpedo.png',
  'index.html',
  'js/assets.js',
  'js/audio.js',
  'js/input.js',
  'js/main.js',
  'js/render.js',
  'js/sim.js',
  'manifest.webmanifest',
  'style.css',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./') : null);
    const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('offline', { status: 503 });
  }));
});
