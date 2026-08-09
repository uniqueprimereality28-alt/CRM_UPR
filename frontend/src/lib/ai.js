// Shared metadata + helpers for the attachable AI Calling module.

export const TEMP_META = {
  hot: { label: "Hot", cls: "border-orange-200 bg-orange-50 text-orange-700", dot: "bg-orange-500", bar: "bg-orange-500" },
  warm: { label: "Warm", cls: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500", bar: "bg-amber-400" },
  cold: { label: "Cold", cls: "border-slate-200 bg-slate-100 text-slate-600", dot: "bg-slate-400", bar: "bg-slate-400" },
  lost: { label: "Lost", cls: "border-rose-200 bg-rose-50 text-rose-700", dot: "bg-rose-500", bar: "bg-rose-500" },
};

export const DISPO_META = {
  connected: "Connected",
  interested: "Interested",
  callback: "Callback",
  site_visit: "Site visit",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
  no_answer: "No answer",
  transferred: "Transferred",
};

export const SCRIPT_TEMPLATES = [
  { value: "first_contact", label: "First contact call" },
  { value: "no_answer_retry", label: "No answer retry" },
  { value: "after_brochure", label: "Follow-up after brochure sent" },
  { value: "revisit_requirement", label: "Revisit after requirement captured" },
  { value: "human_transfer", label: "Human transfer request" },
  { value: "inventory_update", label: "Callback after inventory update" },
];

export const LANG_STYLES = [
  { value: "formal_hinglish", label: "Formal Hinglish (English-heavy)" },
  { value: "balanced_hinglish", label: "Balanced Hinglish + light Haryanvi" },
  { value: "hindi_first", label: "Hindi-first" },
];

export const MOODS = [
  { value: "hot_buyer", label: "Hot buyer" },
  { value: "warm_curious", label: "Warm / curious" },
  { value: "investor", label: "Investor" },
  { value: "just_browsing", label: "Just browsing" },
  { value: "busy_callback", label: "Busy — callback" },
  { value: "not_interested", label: "Not interested" },
  { value: "wrong_number", label: "Wrong number" },
];

export function tempMeta(t) {
  return TEMP_META[t] || TEMP_META.cold;
}
