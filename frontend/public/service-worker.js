/* eslint-disable no-restricted-globals */
// App-shell service worker. It lets the app open with zero signal, but it must
// NEVER keep showing an old version after a deploy:
//   * the page itself (/, /index.html, any route) is NETWORK-FIRST — a fresh copy
//     is always fetched, the cached one is only a fallback when offline;
//   * hashed bundles under /static/ never change for a given file name, so those
//     are cache-first (fast + safe);
//   * everything else is network-first.
// API calls go to another origin and are never touched here (offline data lives
// in src/lib/offline.js).

const CACHE_NAME = "upr-shell-v2";          // bump this to force-clear every cached copy
const LEGACY_CACHES = ["upr-shell-v1"];      // the old cache-first version that kept the old interface alive

self.addEventListener("install", (event) => {
  self.skipWaiting();                        // take over immediately, don't wait for tabs to close
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll([new Request("/index.html", { cache: "reload" })]))
      .catch(() => { /* fine if unavailable in dev */ })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const hadLegacy = keys.some((k) => LEGACY_CACHES.includes(k));
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
    // One-time cleanup: tabs that were opened by the OLD worker are still showing the
    // old interface — reload them once so they pick up the newest version right now.
    if (hadLegacy) {
      const wins = await self.clients.matchAll({ type: "window" });
      wins.forEach((w) => { try { w.navigate(w.url); } catch (e) { /* ignore */ } });
    }
  })());
});

const isPage = (req, url) =>
  req.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html") ||
  url.pathname === "/service-worker.js";

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // the API — pass through untouched

  // Hashed build files: cache-first (a new build has new file names).
  if (url.pathname.startsWith("/static/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // Page + everything else: network first (bypass the browser's HTTP cache too).
  event.respondWith(
    fetch(req, { cache: "no-store" })
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(isPage(req, url) && req.mode === "navigate" ? "/index.html" : req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/index.html")))
  );
});
