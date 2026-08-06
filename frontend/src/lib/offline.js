// Low-level offline storage: an IndexedDB "GET cache" (so data already loaded
// stays visible with no connection) and a "mutation queue" (so a POST/PUT/DELETE
// made offline is remembered and replayed in order once connectivity returns).
// No page/component talks to this file directly — src/lib/api.js wires it into
// every request automatically via axios interceptors.

const DB_NAME = "upr_offline_v1";
const DB_VERSION = 1;
const STORE_CACHE = "get_cache";
const STORE_QUEUE = "mutation_queue";

export const OFFLINE_EVENT = "upr-offline-status";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("indexedDB unavailable")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CACHE)) db.createObjectStore(STORE_CACHE);
      if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: "qid", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function getStore(name, mode) {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

function cacheKey(url, params) {
  const p = params && Object.keys(params).length ? JSON.stringify(params, Object.keys(params).sort()) : "";
  return `${url}?${p}`;
}

// ---------------- GET cache ----------------

export async function cacheGetResponse(url, params, data) {
  try {
    const store = await getStore(STORE_CACHE, "readwrite");
    store.put({ data, ts: Date.now() }, cacheKey(url, params));
  } catch { /* best-effort — never block the real request on this */ }
}

export async function readCachedResponse(url, params) {
  try {
    const store = await getStore(STORE_CACHE, "readonly");
    return await new Promise((resolve, reject) => {
      const req = store.get(cacheKey(url, params));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

// Best-effort: when an offline edit is queued for e.g. PUT /leads/123, patch
// any cached GET for /leads/123 (detail view) and the unfiltered /leads list
// so the change is visible immediately instead of waiting for a sync.
export async function patchCachedRecord(url, patch) {
  if (!patch || typeof patch !== "object") return;
  const parts = url.split("/").filter(Boolean);
  if (parts.length < 2) return;
  const root = `/${parts[0]}`;
  const id = parts[1];
  try {
    const detail = await readCachedResponse(`${root}/${id}`, undefined);
    if (detail && detail.data && typeof detail.data === "object") {
      await cacheGetResponse(`${root}/${id}`, undefined, { ...detail.data, ...patch });
    }
  } catch { /* ignore */ }
  try {
    const list = await readCachedResponse(root, undefined);
    if (list && Array.isArray(list.data)) {
      const merged = list.data.map((item) => (
        item && (item.id === id || item._id === id) ? { ...item, ...patch } : item
      ));
      await cacheGetResponse(root, undefined, merged);
    }
  } catch { /* ignore */ }
}

// ---------------- Mutation queue ----------------

export async function enqueueMutation(entry) {
  const store = await getStore(STORE_QUEUE, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.add({ ...entry, createdAt: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listQueue() {
  try {
    const store = await getStore(STORE_QUEUE, "readonly");
    return await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function removeQueueItem(qid) {
  try {
    const store = await getStore(STORE_QUEUE, "readwrite");
    return await new Promise((resolve, reject) => {
      const req = store.delete(qid);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch { /* ignore */ }
}

export async function queueLength() {
  return (await listQueue()).length;
}

export function emitStatus(detail) {
  try {
    window.dispatchEvent(new CustomEvent(OFFLINE_EVENT, { detail }));
  } catch { /* ignore */ }
}
