import axios from "axios";

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
  return config;
});

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


