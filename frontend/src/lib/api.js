import axios from "axios";
import {
  cacheGetResponse, readCachedResponse, patchCachedRecord,
  enqueueMutation, listQueue, removeQueueItem, queueLength, emitStatus,
} from "./offline";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API, withCredentials: true });

// The backend returns asset paths like "/api/avatars/xyz.jpg" — these are
// relative to the BACKEND host, not the frontend host they render on. Since
// the frontend and backend are deployed on separate domains, an <img src>
// pointed straight at that relative path 404s. This resolves it against the
// actual backend origin (and passes absolute/blob/data URLs through as-is).
export function assetUrl(path) {
  if (!path) return null;
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  return `${BACKEND_URL || ""}${path}`;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("upr_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  // Stash the pre-serialization body so it can be replayed later exactly as
  // the caller passed it in (config.data gets JSON.stringify'd further down
  // the axios pipeline, after request interceptors run).
  config.__rawData = config.data;
  return config;
});

// ---------------- Offline support ----------------
// GET requests are cached locally so leads/data already loaded stay visible
// with no connection. POST/PUT/DELETE requests that fail because the device
// is offline are queued and replayed in order the moment connectivity
// returns — nothing the agent does offline is lost.

const MUTATION_METHODS = new Set(["post", "put", "delete", "patch"]);
// /calls/start is meaningless to queue and replay later — it only exists to
// mint a server call ID for the immediate start/end pair. When it fails, the
// caller (useClickToCall) already falls back to /calls/log_offline instead,
// so we let this one endpoint fail normally rather than queuing it.
const QUEUE_EXCLUDE_URLS = new Set(["/calls/start"]);
let syncing = false;

async function pushStatus() {
  emitStatus({ offline: !navigator.onLine, pending: await queueLength(), syncing });
}

export async function replayQueuedMutations() {
  if (syncing || !navigator.onLine) return;
  const items = await listQueue();
  if (!items.length) { pushStatus(); return; }
  syncing = true;
  pushStatus();
  for (const item of items) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await api.request({
        method: item.method,
        url: item.url,
        data: item.data,
        params: item.params,
        _isReplay: true,
      });
      // eslint-disable-next-line no-await-in-loop
      await removeQueueItem(item.qid);
    } catch (err) {
      if (!err.response) {
        // Still offline (or just went offline again mid-sync) — stop here,
        // keep the remaining queue, and try again on the next "online" event.
        break;
      }
      // Server actively rejected the replayed request (validation, etc.) —
      // drop it so it doesn't block everything behind it forever.
      // eslint-disable-next-line no-await-in-loop
      await removeQueueItem(item.qid);
    }
  }
  syncing = false;
  pushStatus();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => replayQueuedMutations());
  window.addEventListener("offline", () => pushStatus());
  // Kick off an initial status broadcast + best-effort sync in case the app
  // was reloaded while there was still a queue from a previous session.
  setTimeout(() => { pushStatus(); replayQueuedMutations(); }, 0);
}

api.interceptors.response.use(
  (response) => {
    if ((response.config.method || "get").toLowerCase() === "get") {
      cacheGetResponse(response.config.url, response.config.params, response.data);
    }
    return response;
  },
  async (error) => {
    const config = error.config || {};
    const method = (config.method || "get").toLowerCase();
    const isNetworkError = !error.response; // no response at all = offline/timeout/DNS, not a server rejection

    if (isNetworkError && method === "get") {
      const cached = await readCachedResponse(config.url, config.params);
      if (cached) {
        return { data: cached.data, status: 200, statusText: "OK (from offline cache)", headers: {}, config, fromCache: true };
      }
    }

    if (isNetworkError && MUTATION_METHODS.has(method) && !config._isReplay && !QUEUE_EXCLUDE_URLS.has(config.url)) {
      const isFormData = typeof FormData !== "undefined" && config.data instanceof FormData;
      if (!isFormData) {
        await enqueueMutation({ method, url: config.url, data: config.__rawData, params: config.params });
        if (method === "put" || method === "patch") patchCachedRecord(config.url, config.__rawData);
        pushStatus();
        return { data: { ok: true, queued: true }, status: 202, statusText: "Queued offline", headers: {}, config, queued: true };
      }
    }

    return Promise.reject(error);
  }
);

export function apiError(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export function fmtDuration(sec = 0) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${r}s`;
  return `${r}s`;
}

export function fmtMoney(n) {
  if (!n) return "—";
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
  return `₹${Number(n).toLocaleString("en-IN")}`;
}

export function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export const STATUS_META = {
  new: { label: "New", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  contacted: { label: "Contacted", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  qualified: { label: "Qualified", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  site_visit: { label: "Site Visit", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  negotiation: { label: "Negotiation", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  won: { label: "Won", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  lost: { label: "Lost", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

export const STATUSES = Object.keys(STATUS_META);

// Normalizes any phone string to a bare digit string with the India country
// code (91) applied. A 10-digit local number gets 91 prepended; a number
// that's already 12 digits (i.e. already carries a country code) is left
// as-is so we never double up the prefix. Anything else is passed through
// untouched — it's not a shape we recognize, so we don't guess further.
export function normalizeIndianPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function telHref(phone) {
  return `tel:+${normalizeIndianPhone(phone)}`;
}

export function waLink(phone, name) {
  const digits = normalizeIndianPhone(phone);
  const msg = `Hello ${name || ""}, greetings from Unique Prime Reality! Sharing our property brochure and latest offerings with you. Let me know a good time to talk.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(msg)}`;
}
