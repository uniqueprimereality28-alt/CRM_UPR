import axios from "axios";

// Set REACT_APP_BACKEND_URL to the public URL of the Render backend service.
// The API router itself is mounted at /api.
const backendUrl = (process.env.REACT_APP_BACKEND_URL || "http://localhost:8001").replace(/\/$/, "");

export const api = axios.create({
  baseURL: `${backendUrl}/api`,
  withCredentials: true,
});

export const STATUSES = ["new", "contacted", "qualified", "site_visit", "negotiation", "won", "lost"];

export const STATUS_META = {
  new: { label: "New", cls: "border-sky-200 bg-sky-50 text-sky-700" },
  contacted: { label: "Contacted", cls: "border-violet-200 bg-violet-50 text-violet-700" },
  qualified: { label: "Qualified", cls: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  site_visit: { label: "Site Visit", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  negotiation: { label: "Negotiation", cls: "border-orange-200 bg-orange-50 text-orange-700" },
  won: { label: "Won", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  lost: { label: "Lost", cls: "border-rose-200 bg-rose-50 text-rose-700" },
};

export function apiError(detail) {
  if (Array.isArray(detail)) return detail.map((item) => item.msg || String(item)).join(", ");
  if (typeof detail === "object" && detail) return detail.message || JSON.stringify(detail);
  return detail || "Something went wrong. Please try again.";
}

export function fmtDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${secs}s`;
}

export function fmtMoney(value) {
  const amount = Number(value) || 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function waLink(phone, name = "") {
  let number = String(phone || "").replace(/\D/g, "");
  if (number.length === 10) number = `91${number}`;
  const message = `Hello${name ? ` ${name}` : ""}, I am contacting you from Unique Prime Reality.`;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function assetUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${backendUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

