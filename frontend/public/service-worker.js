/* eslint-disable no-restricted-globals */
// Basic app-shell service worker: caches the static frontend files (HTML/JS/
// CSS) so the app can still open with zero signal. It never touches API
// calls — those go to a different origin (the backend) and are handled by
// the app's own IndexedDB offline queue in src/lib/offline.js, so this file
// only intercepts same-origin GET requests.

const CACHE_NAME = "upr-shell-v1";
// Keep this to files we know exist in public/ — an addAll() with any missing
// file fails the whole batch. The hashed JS/CSS bundles built by CRA get
// cached automatically by the fetch handler below on first load instead.
const APP_SHELL = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => { /* fine if some app-shell files 404 in dev */ })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache mutations here — that's the app's job

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin (the API) — let it pass through untouched

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || caches.match("/index.html"));
      // Stale-while-revalidate: serve the cached shell instantly if we have
      // it, refresh the cache in the background; fall back to network (or
      // cached index.html for a cold offline open) when nothing is cached yet.
      return cached || network;
    })
  );
});
