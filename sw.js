/* World Cup 2026 — service worker.
   Caches the app shell for offline launch. NEVER caches API responses,
   so live data (scores, lineups, stats) is always fetched fresh. */
const CACHE = "wc2026-v8";
const SHELL = ["./", "./index.html", "./mobile.html", "./wc-engine.js", "./app.js", "./app.mobile.js", "./manifest.webmanifest", "./icon-180.png", "./icon-192.png", "./icon-512.png", "./ball.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Live data must always hit the network — never serve a cached score.
  if (url.hostname.includes("thesportsdb.com") || url.hostname.includes("api.espn.com")) return;
  // App shell: cache-first, fall back to network.
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
