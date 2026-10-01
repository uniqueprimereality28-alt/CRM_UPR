// Tiny helpers so a browser refresh keeps the same filters / page / tab and
// shows the last numbers INSTANTLY while fresh ones load in the background.
const PREFIX = "crm:";

export function readSaved(key, fallback = null) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export function writeSaved(key, value) {
  try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage full / blocked */ }
}
