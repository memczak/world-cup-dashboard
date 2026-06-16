/* World Cup 2026 — service worker.
   NETWORK-FIRST for the app shell: when online, every shell file is fetched fresh
   so code updates are picked up immediately and the html/js set always stays
   consistent (no stale "new index.html + old app.js" mismatch). The cache is an
   offline fallback only. API responses are NEVER cached — live data is always fresh. */
const CACHE = "wc2026-v11";
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
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // Live data must always hit the network — never serve a cached score.
  if (url.hostname.includes("thesportsdb.com") || url.hostname.includes("api.espn.com")) return;
  // App shell: network-first (fresh, consistent code on every online load),
  // refreshing the cache; fall back to cache only when the network is unavailable.
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
