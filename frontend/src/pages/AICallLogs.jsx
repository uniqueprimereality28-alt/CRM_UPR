import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, User2, Phone, PhoneIncoming, PhoneOutgoing, PhoneCall, Sparkles, BadgeCheck,
  Upload, FileDown, Search, Loader2, Clock, UserCheck, CheckCircle2, RefreshCw, ArrowUpDown,
  PhoneOff, Copy, MessageSquare, X, Flame, Download, FileText, FileSpreadsheet, CalendarClock, Pencil, Zap, Snowflake, Plus,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDuration } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { tempMeta } from "../lib/ai";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { StatCard } from "../components/StatCard";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../components/ui/sheet";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "../components/ui/dialog";

/* ---------- look & feel per category ---------- */
const CAT = {
  qualified:      { label: "Qualified",      cls: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  interested:     { label: "Interested",     cls: "border-orange-200 bg-orange-50 text-orange-700",   dot: "bg-orange-500" },
  callback:       { label: "Call back",      cls: "border-sky-200 bg-sky-50 text-sky-700",             dot: "bg-sky-500" },
  other:          { label: "Talked",         cls: "border-slate-200 bg-slate-50 text-slate-600",       dot: "bg-slate-400" },
  not_interested: { label: "Not interested", cls: "border-rose-200 bg-rose-50 text-rose-700",          dot: "bg-rose-500" },
  no_answer:      { label: "No answer",      cls: "border-slate-200 bg-slate-100 text-slate-500",      dot: "bg-slate-300" },
};
const catMeta = (c) => CAT[c] || CAT.other;

const SIGNALS = {
  interested: "Showed interest", visit: "Talked about site visit", budget: "Shared budget",
  bhk: "Shared property type / BHK", location: "Mentioned location", whatsapp: "Wants details on WhatsApp",
  callback: "Asked to call later", not_interested: "Said not interested", wrong_number: "Wrong number",
  no_reply: "Person did not speak", short_call: "Very short call",
};

// "Not interested" also holds no-answer and picked-up-but-silent calls.
const TABS = [
  ["all", "All"], ["qualified", "Qualified"], ["interested", "Interested"],
  ["callback", "Call back"], ["not_interested", "Not interested"],
];
const TEMPS = ["hot", "warm", "cold", "lost"];

const SORTS = [
  ["followup", "Follow-up soonest"], ["newest", "Newest first"], ["oldest", "Oldest first"], ["best", "Best leads first"], ["hottest", "Highest AI score"],
  ["longest", "Longest call"], ["shortest", "Shortest call"], ["name", "Name A–Z"],
];

/* ---------- helpers ---------- */
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtWhen = (iso) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : "—";
// Follow-up helpers
const fuState = (c) => {
  if (!c.followup_needed) return null;
  if (c.followup_done) return "done";
  if (c.followup_at && new Date(c.followup_at).getTime() < Date.now()) return "overdue";
  return "pending";
};
const FU_CLS = {
  overdue: "border-rose-200 bg-rose-50 text-rose-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
};
const FU_LABEL = { overdue: "Overdue", pending: "Follow up", done: "Done" };
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
const initials = (s) => (s || "?").trim().slice(0, 1).toUpperCase();
const maskPhone = (p) => (p ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : "");

// Turns the filter inputs into the ISO range the API expects (browser = IST).
function buildRange({ from, to, hour }) {
  let df = null, dt = null;
  if (from) {
    const start = hour === "" ? "00:00" : `${pad(hour)}:00`;
    df = new Date(`${from}T${start}:00`).toISOString();
  }
  const endDay = hour === "" ? (to || from) : from; // an hour only makes sense within one day
  if (endDay) {
    const end = hour === "" ? "23:59:59" : `${pad(hour)}:59:59`;
    dt = new Date(`${endDay}T${end}`).toISOString();
  }
  return { date_from: df, date_to: dt };
}

// --- keeps filters/page/numbers across a browser refresh (no extra file needed) ---
const readSaved = (key, fallback = null) => {
  try { const raw = sessionStorage.getItem("crm:" + key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
};
const writeSaved = (key, value) => {
  try { sessionStorage.setItem("crm:" + key, JSON.stringify(value)); } catch { /* storage blocked */ }
};

export default function AICallLogs() {
  const [assignees, setAssignees] = useState([]);
  const sv = useRef(readSaved("logs:view", {})).current;      // where you were before refresh
  const [stats, setStats] = useState(() => readSaved("logs:stats", null));  // last numbers = instant
  const [list, setList] = useState(() => readSaved("logs:list", null));
  const [openId, setOpenId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);

  // filters
  const [from, setFrom] = useState(sv.from || "");
  const [to, setTo] = useState(sv.to || "");
  const [hour, setHour] = useState(sv.hour || ""); // "" = whole day
  const [tab, setTab] = useState(sv.tab || "all");
  const [sort, setSort] = useState(sv.sort || "newest");
  const [assigned, setAssigned] = useState(sv.assigned || "all");
  const [direction, setDirection] = useState(sv.direction || "all");
  const [conn, setConn] = useState(sv.conn || "all");     // all | yes (connected) | no (not connected)
  const [reason, setReason] = useState(sv.reason || "");     // not-connected reason
  const [temp, setTemp] = useState(sv.temp || "all");       // AI temperature filter
  const [followup, setFollowup] = useState(sv.followup || "all"); // all | pending | overdue | done
  const [q, setQ] = useState(sv.q || "");
  const [qDebounced, setQDebounced] = useState(sv.q || "");
  const [page, setPage] = useState(sv.page || 1);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const range = useMemo(() => buildRange({ from, to, hour }), [from, to, hour]);

  useEffect(() => {
    api.get("/ai-call-logs/assignees").then((r) => setAssignees(r.data)).catch(() => {});
  }, []);

  const loadStats = useCallback(() => {
    api.get("/ai-call-logs/stats", { params: { ...range } })
      .then((r) => { setStats(r.data); writeSaved("logs:stats", r.data); })
      .catch(() => setStats((old) => old || { total: 0, by_hour: Array(24).fill(0), by_category: {} }));
  }, [range]);

  const loadList = useCallback(() => {
    const params = {
      ...range, sort, page, limit: 25,
      category: tab === "all" ? undefined : tab === "not_interested" ? "not_interested_all" : tab,
      temperature: temp === "all" ? undefined : temp,
      followup: followup === "all" ? undefined : followup,
      assigned: assigned === "all" ? undefined : assigned,
      direction: direction === "all" ? undefined : direction,
      connected: conn === "all" ? undefined : conn,
      reason: reason || undefined,
      q: qDebounced || undefined,
    };
    api.get("/ai-call-logs", { params })
      .then((r) => { setList(r.data); writeSaved("logs:list", r.data); })
      .catch((e) => { setList({ items: [], total: 0, pages: 1 }); toast.error(apiError(e.response?.data?.detail)); });
  }, [range, sort, page, tab, temp, followup, assigned, direction, conn, reason, qDebounced]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadList(); }, [loadList]);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }   // a refresh keeps your page
    setPage(1); setSelected(new Set());
  }, [range, tab, temp, followup, sort, assigned, direction, conn, reason, qDebounced]);
  useEffect(() => {
    writeSaved("logs:view", { from, to, hour, tab, sort, assigned, direction, conn, reason, temp, followup, q, page });
  }, [from, to, hour, tab, sort, assigned, direction, conn, reason, temp, followup, q, page]);

  const refreshAll = () => { loadStats(); loadList(); };

  /* ----- import & template ----- */
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/ai-call-logs/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(
        `${data.added} calls added` +
        (data.updated ? ` · ${data.updated} existing calls refreshed` : "") +
        (data.skipped ? ` · ${data.skipped} rows skipped` : "")
      );
      refreshAll();
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await api.get("/ai-call-logs/template", { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = "ai_call_logs_template.xlsx";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Could not download the template.");
    }
  };

  /* ----- quick date chips ----- */
  const setQuick = (kind) => {
    const today = new Date();
    setHour("");
    if (kind === "all") { setFrom(""); setTo(""); }
    if (kind === "today") { setFrom(ymd(today)); setTo(ymd(today)); }
    if (kind === "yesterday") { const y = new Date(today); y.setDate(y.getDate() - 1); setFrom(ymd(y)); setTo(ymd(y)); }
    if (kind === "7d") { const s = new Date(today); s.setDate(s.getDate() - 6); setFrom(ymd(s)); setTo(ymd(today)); }
  };

  /* ----- selection & bulk assign ----- */
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allOnPage = list?.items?.length > 0 && list.items.every((i) => selected.has(i.id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(list.items.map((i) => i.id)));

  const bulkAssign = async (userId) => {
    try {
      const { data } = await api.post("/ai-call-logs/bulk-assign", { ids: [...selected], user_id: userId === "none" ? null : userId });
      toast.success(data.assigned_to_name ? `${data.updated} leads assigned to ${data.assigned_to_name}` : `${data.updated} leads unassigned`);
      setSelected(new Set());
      refreshAll();
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    }
  };

  /* ----- export (PDF / CSV) ----- */
  const [exporting, setExporting] = useState(false);
  const doExport = async (scope, fmt) => {
    setExporting(true);
    try {
      const res = await api.get("/ai-call-logs/export", {
        params: {
          fmt, scope, ...range,
          assigned: assigned === "all" ? undefined : assigned,
          direction: direction === "all" ? undefined : direction,
          temperature: temp === "all" ? undefined : temp,
          q: qDebounced || undefined,
        },
        responseType: "blob",
      });
      const cd = res.headers?.["content-disposition"] || "";
      const name = (cd.match(/filename="?([^";]+)"?/) || [])[1] || `ai_calls_${scope}.${fmt}`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${fmt.toUpperCase()} downloaded`);
    } catch (err) {
      toast.error("Could not create the export. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const byCat = stats?.by_category || {};
  const tabCount = (key) => {
    if (!stats) return null;
    if (key === "all") return stats.total;
    if (key === "not_interested") return (byCat.not_interested ?? 0) + (byCat.no_answer ?? 0);
    return byCat[key] ?? 0;
  };

  return (
    <div className="space-y-6" data-testid="ai-call-logs-page">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand">
            <Bot className="h-4 w-4" /> AI Agent
          </div>
          <h1 className="brand-font mt-1 text-3xl font-bold text-slate-900">AI Call Logs</h1>
          <p className="mt-1 text-sm text-slate-500">Every call the AI agent made or received — who was interested, and what was said.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadTemplate} data-testid="download-template-btn">
            <FileDown className="h-3.5 w-3.5" /> Sample file
          </Button>
          <Button size="sm" className="gap-1.5 bg-brand hover:bg-brand-dark" disabled={importing}
            onClick={() => fileRef.current?.click()} data-testid="import-calls-btn">
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload calls
          </Button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm,.json" className="hidden" onChange={onFile} />
        </div>
      </div>

      {/* when */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">When</span>
          {[["all", "All time"], ["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setQuick(k)} data-testid={`quick-${k}`}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:border-brand hover:text-brand">
              {l}
            </button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (!to || e.target.value > to) setTo(e.target.value); }}
              className="h-8 w-[140px] text-xs" data-testid="date-from" />
            <span className="text-xs text-slate-400">to</span>
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)}
              className="h-8 w-[140px] text-xs" data-testid="date-to" />
            <Select value={hour === "" ? "any" : String(hour)} onValueChange={(v) => setHour(v === "any" ? "" : Number(v))}>
              <SelectTrigger className="h-8 w-[130px] text-xs" data-testid="hour-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Whole day</SelectItem>
                {Array.from({ length: 24 }, (_, h) => <SelectItem key={h} value={String(h)}>{hourLabel(h)} hour</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* numbers */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Calls made" value={stats ? stats.total : "…"} sub={stats ? `${stats.outbound} out · ${stats.inbound} in` : ""} icon={PhoneCall} accent="brand" testId="stat-calls" />
        <StatCard label="Connected" value={stats ? stats.connected : "…"} sub={stats && stats.total ? `${Math.round((stats.connected / stats.total) * 100)}% of calls · ${stats.not_connected} not connected` + (stats.picked_no_speech ? ` · ${stats.picked_no_speech} picked up, silent` : "") : ""} icon={Phone} accent="slate" testId="stat-connected" />
        <StatCard label="Interested" value={stats ? stats.interested : "…"} sub="flagged automatically" icon={Sparkles} accent="amber" testId="stat-interested" />
        <StatCard label="Qualified leads" value={stats ? stats.qualified : "…"} sub={stats ? `${stats.assigned} assigned` : ""} icon={BadgeCheck} accent="emerald" testId="stat-qualified" />
      </div>

      {/* connected vs not connected */}
      <ConnectionPanel stats={stats} conn={conn} reason={reason}
        onPick={(c, r) => { setConn(c); setReason(r); }} />

      {/* AI lead shortlist: Hot / Warm / Cold / Call back */}
      <ShortlistPanel onOpen={setOpenId} assignees={assignees} />

      {/* AI lead temperature */}
      <TemperaturePanel stats={stats} temp={temp} onPick={setTemp} />

      {/* tabs + tools */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5" data-testid="category-tabs">
          {TABS.map(([key, label]) => {
            const active = tab === key;
            const n = tabCount(key);
            return (
              <button key={key} type="button" onClick={() => setTab(key)} data-testid={`tab-${key}`}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  active ? "border-brand bg-brand text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-brand/40"}`}>
                {label}
                {n !== null && <span className={`rounded-full px-1.5 text-[11px] ${active ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>{n}</span>}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number or remark"
              className="h-9 pl-8 text-sm" data-testid="search-input" />
          </div>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-9 w-[170px] text-sm" data-testid="sort-select">
              <ArrowUpDown className="mr-1.5 h-3.5 w-3.5 text-slate-400" /><SelectValue />
            </SelectTrigger>
            <SelectContent>{SORTS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={followup} onValueChange={setFollowup}>
            <SelectTrigger className="h-9 w-[150px] text-sm" data-testid="followup-filter">
              <CalendarClock className="mr-1.5 h-3.5 w-3.5 text-slate-400" /><SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any follow-up</SelectItem>
              <SelectItem value="pending">To follow up</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="done">Done</SelectItem>
            </SelectContent>
          </Select>
          <Select value={assigned} onValueChange={setAssigned}>
            <SelectTrigger className="h-9 w-[160px] text-sm" data-testid="assigned-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Anyone</SelectItem>
              <SelectItem value="unassigned">Not assigned</SelectItem>
              {assignees.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={direction} onValueChange={setDirection}>
            <SelectTrigger className="h-9 w-[130px] text-sm" data-testid="direction-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">In + Out</SelectItem>
              <SelectItem value="outbound">Outgoing</SelectItem>
              <SelectItem value="inbound">Incoming</SelectItem>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5" disabled={exporting} data-testid="export-btn">
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[11px] font-normal text-slate-500">
                Uses the date range and filters above
              </DropdownMenuLabel>
              {[["interested", "Interested"], ["not_interested", "Not interested"], ["all", "Everything"]].map(([scope, label], i) => (
                <div key={scope}>
                  {i > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-xs">{label}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => doExport(scope, "pdf")} data-testid={`export-${scope}-pdf`}>
                    <FileText className="mr-2 h-4 w-4" /> PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => doExport(scope, "csv")} data-testid={`export-${scope}-csv`}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" /> CSV (Excel)
                  </DropdownMenuItem>
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={refreshAll} title="Refresh"><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      {temp !== "all" && (
        <div className="flex items-center gap-2" data-testid="temp-filter-chip">
          <span className="text-xs text-slate-500">Showing:</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-light px-3 py-1 text-xs font-semibold text-brand">
            AI temperature · {tempMeta(temp).label}
            <button type="button" onClick={() => setTemp("all")} aria-label="Clear filter"><X className="h-3 w-3" /></button>
          </span>
        </div>
      )}

      {(conn !== "all" || reason) && (
        <div className="flex items-center gap-2" data-testid="conn-filter-chip">
          <span className="text-xs text-slate-500">Showing:</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-light px-3 py-1 text-xs font-semibold text-brand">
            {conn === "yes" ? "Connected calls" : reason ? `Not connected · ${reason}` : "Not connected calls"}
            <button type="button" onClick={() => { setConn("all"); setReason(""); }} aria-label="Clear filter"><X className="h-3 w-3" /></button>
          </span>
        </div>
      )}

      {/* bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand-light px-4 py-2.5" data-testid="bulk-bar">
          <span className="text-sm font-semibold text-brand">{selected.size} selected</span>
          <Select onValueChange={bulkAssign}>
            <SelectTrigger className="h-8 w-[190px] bg-white text-sm" data-testid="bulk-assign-select"><SelectValue placeholder="Assign to…" /></SelectTrigger>
            <SelectContent>
              {assignees.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              <SelectItem value="none">Remove assignment</SelectItem>
            </SelectContent>
          </Select>
          <button type="button" className="ml-auto text-xs text-slate-500 hover:text-slate-800" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {/* list */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {list === null ? (
          <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>
        ) : list.items.length === 0 ? (
          <div className="p-10 text-center">
            <PhoneCall className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">
              {stats?.total === 0 && !from && !q ? "No calls yet — click “Upload calls” to add your call file." : "No calls match these filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2">
              <Checkbox checked={allOnPage} onCheckedChange={toggleAll} aria-label="Select all" />
              <span className="text-xs text-slate-500">{list.total} calls</span>
            </div>
            <div className="divide-y divide-slate-100">
              {list.items.map((c) => (
                <CallRow key={c.id} c={c} checked={selected.has(c.id)} onCheck={() => toggle(c.id)} onOpen={() => setOpenId(c.id)} />
              ))}
            </div>
            {list.pages > 1 && (
              <div className="flex items-center justify-center gap-3 border-t border-slate-100 py-3">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                <span className="text-xs text-slate-500">Page {page} of {list.pages}</span>
                <Button size="sm" variant="outline" disabled={page >= list.pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </div>

      <CallSheet id={openId} assignees={assignees} onClose={() => setOpenId(null)} onChanged={refreshAll} />
    </div>
  );
}

/* ---------- Connected vs not connected ---------- */
const ConnectionPanel = ({ stats, conn, reason, onPick }) => {
  const total = stats?.total || 0;
  const c = stats?.connected || 0;
  const n = stats?.not_connected || 0;
  const pc = total ? Math.round((c / total) * 100) : 0;
  const reasons = stats?.reasons || [];
  const maxR = Math.max(1, ...reasons.map((r) => r.count));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="connection-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">Call connection</h3>
        <span className="text-xs text-slate-400">Tap a box or a reason to see those calls</span>
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => onPick(conn === "yes" ? "all" : "yes", "")} data-testid="conn-connected"
              className={`rounded-xl border p-4 text-left transition-all ${conn === "yes" ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200" : "border-emerald-100 bg-emerald-50/50 hover:bg-emerald-50"}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700"><Phone className="h-3.5 w-3.5" /> Connected</div>
              <div className="brand-font mt-2 text-3xl font-bold text-emerald-700">{stats ? c : "…"}</div>
              <div className="text-xs text-emerald-700/70">{pc}% of calls</div>
            </button>
            <button type="button" onClick={() => onPick(conn === "no" && !reason ? "all" : "no", "")} data-testid="conn-not-connected"
              className={`rounded-xl border p-4 text-left transition-all ${conn === "no" && !reason ? "border-rose-400 bg-rose-50 ring-2 ring-rose-200" : "border-rose-100 bg-rose-50/50 hover:bg-rose-50"}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-rose-700"><PhoneOff className="h-3.5 w-3.5" /> Not connected</div>
              <div className="brand-font mt-2 text-3xl font-bold text-rose-700">{stats ? n : "…"}</div>
              <div className="text-xs text-rose-700/70">{total ? 100 - pc : 0}% of calls</div>
            </button>
          </div>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pc}%` }} />
            <div className="h-full bg-rose-400 transition-all" style={{ width: `${total ? 100 - pc : 0}%` }} />
          </div>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Why calls did not connect</div>
          {reasons.length === 0 ? (
            <p className="py-4 text-sm text-slate-400">{stats && total ? "All calls connected." : "No data yet."}</p>
          ) : (
            <div className="space-y-1.5">
              {reasons.map((r) => {
                const active = conn === "no" && reason === r.reason;
                return (
                  <button key={r.reason} type="button" data-testid={`reason-${r.reason}`}
                    onClick={() => (active ? onPick("all", "") : onPick("no", r.reason))}
                    className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${active ? "bg-rose-50 ring-1 ring-rose-200" : "hover:bg-slate-50"}`}>
                    <span className="w-44 shrink-0 truncate text-sm text-slate-700">{r.reason}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-rose-400" style={{ width: `${(r.count / maxR) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right text-sm font-semibold text-slate-700">{r.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ---------- AI lead temperature ---------- */
const TemperaturePanel = ({ stats, temp, onPick }) => {
  const by = stats?.by_temperature || {};
  const scored = TEMPS.reduce((n, t) => n + (by[t] || 0), 0);
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="temperature-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">AI lead temperature</h3>
        <span className="text-xs text-slate-400">Scored from the whole conversation · tap to filter</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {TEMPS.map((t) => {
          const m = tempMeta(t);
          const n = by[t] || 0;
          const active = temp === t;
          return (
            <button key={t} type="button" onClick={() => onPick(active ? "all" : t)} data-testid={`temp-${t}`}
              className={`rounded-xl border p-3.5 text-left transition-all ${m.cls} ${active ? "ring-2 ring-brand/40" : "hover:brightness-95"}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
                <span className={`h-2 w-2 rounded-full ${m.dot}`} />{m.label}
              </div>
              <div className="brand-font mt-1.5 text-2xl font-bold">{stats ? n : "…"}</div>
              <div className="text-[11px] opacity-70">{scored ? Math.round((n / scored) * 100) : 0}% of calls</div>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-slate-400">Hot = 60+ · Warm = 30–59 · Cold = under 30 · Lost = not interested, no answer or silent.</p>
    </div>
  );
};

/* ---------- One row ---------- */
const CallRow = ({ c, checked, onCheck, onOpen }) => {
  const meta = catMeta(c.category);
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50/70" data-testid={`log-row-${c.id}`}>
      <Checkbox checked={checked} onCheckedChange={onCheck} aria-label="Select call" />
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-light text-sm font-bold text-brand">
          {initials(c.name || c.phone)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-800">{c.name || maskPhone(c.phone)}</span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0 text-[10px] font-semibold ${meta.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}
            </span>
            {c.temperature && (
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0 text-[10px] font-semibold ${tempMeta(c.temperature).cls}`}
                title="AI lead temperature" data-testid={`row-temp-${c.id}`}>
                <Flame className="h-2.5 w-2.5" />{tempMeta(c.temperature).label}
                {c.ai_score != null && <span className="opacity-70">· {c.ai_score}</span>}
              </span>
            )}
            {fuState(c) && (
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0 text-[10px] font-semibold ${FU_CLS[fuState(c)]}`}
                title={c.followup_reason || "Follow-up"} data-testid={`row-followup-${c.id}`}>
                <CalendarClock className="h-2.5 w-2.5" />{FU_LABEL[fuState(c)]}
                {fuState(c) !== "done" && <span className="opacity-80">· {fmtWhen(c.followup_at)}</span>}
              </span>
            )}
            {c.assigned_to_name && (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0 text-[10px] font-semibold text-indigo-700">
                <UserCheck className="h-3 w-3" />{c.assigned_to_name.split(" ")[0]}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
            {c.name && <span>{maskPhone(c.phone)}</span>}
            <span className="inline-flex items-center gap-1">
              {c.direction === "inbound" ? <PhoneIncoming className="h-3 w-3" /> : <PhoneOutgoing className="h-3 w-3" />}
              {c.direction === "inbound" ? "Incoming" : "Outgoing"}
            </span>
            <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDuration(c.duration_seconds)}</span>
          </div>
          {!c.answered && c.not_connected_reason && (
            <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-rose-600"><PhoneOff className="h-3 w-3" />{c.not_connected_reason}</div>
          )}
          {c.answered && (c.remark || c.summary) && <div className="mt-0.5 line-clamp-1 text-xs text-slate-400">{c.remark || c.summary}</div>}
        </div>
        <span className="hidden shrink-0 text-[11px] text-slate-400 sm:block">{fmtWhen(c.started_at)}</span>
      </button>
    </div>
  );
};

/* ---------- Follow-up card ---------- */
const FollowupCard = ({ call, onSave }) => {
  const [when, setWhen] = useState(toLocalInput(call.followup_at));
  const [note, setNote] = useState(call.followup_note || "");
  useEffect(() => { setWhen(toLocalInput(call.followup_at)); setNote(call.followup_note || ""); },
    [call.id, call.followup_at, call.followup_note]);
  const st = fuState(call);
  const src = { stated: "Time said on the call", suggested: "Suggested time (none was said)", manual: "Set by your team" }[call.followup_time_source];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="followup-card">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          <CalendarClock className="h-3 w-3" /> Follow-up
        </div>
        {st && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${FU_CLS[st]}`}>{FU_LABEL[st]}</span>}
      </div>
      {call.followup_needed ? (
        <div className="mb-2 text-sm text-slate-700">
          <div className="font-medium">{call.followup_reason || "Follow-up needed"}</div>
          <div className="text-xs text-slate-500">
            {fmtWhen(call.followup_at)}{call.followup_when_text ? ` · "${call.followup_when_text}"` : ""}{src ? ` · ${src}` : ""}
          </div>
        </div>
      ) : (
        <div className="mb-2 text-xs text-slate-400">No follow-up needed for this call. You can still set one below.</div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
          className="h-8 w-[210px] text-xs" data-testid="followup-time-input" />
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={!when}
          onClick={() => onSave({ followup_at: new Date(when).toISOString() }, "Follow-up saved")} data-testid="followup-save">
          Save time
        </Button>
        {call.followup_needed && (
          <>
            <Button size="sm" variant="outline" className="h-8 text-xs"
              onClick={() => onSave({ followup_done: !call.followup_done }, call.followup_done ? "Marked pending" : "Marked done")}
              data-testid="followup-done">
              {call.followup_done ? "Mark pending" : "Mark done"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs text-slate-500"
              onClick={() => onSave({ followup_at: "" }, "Follow-up removed")}>Remove</Button>
          </>
        )}
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Follow-up note (optional)"
        className="mt-2 h-8 text-xs" maxLength={500}
        onBlur={() => note !== (call.followup_note || "") && onSave({ followup_note: note }, "Note saved")} />
    </div>
  );
};

/* Green "AI Calling Agent" tag — shown on a lead even when it is assigned to a person */
const AiAgentTag = ({ className = "" }) => (
  <span title="This lead was called by the AI Calling Agent" data-testid="ai-agent-tag"
    className={`inline-flex w-fit max-w-none items-center gap-1 whitespace-nowrap rounded-full border border-emerald-300 bg-gradient-to-r from-emerald-500 to-green-400 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm shadow-emerald-200 ${className}`}>
    <Zap className="h-3 w-3 shrink-0 fill-white" /> AI Calling Agent
  </span>
);

/* ---------- AI lead shortlist: Hot / Warm / Cold / Call back ---------- */
const SHORT_TABS = [
  ["hot", "Hot", "text-orange-700 border-orange-300 bg-orange-50", Flame],
  ["warm", "Warm", "text-amber-700 border-amber-300 bg-amber-50", Sparkles],
  ["cold", "Cold", "text-slate-600 border-slate-300 bg-slate-100", Snowflake],
  ["callback", "Call back", "text-sky-700 border-sky-300 bg-sky-50", CalendarClock],
];
const CAP_LABEL = { purpose: "Purpose", budget: "Budget", config: "Property", location: "Location", timeline: "Timeline" };

const ShortlistPanel = ({ onOpen, assignees = [] }) => {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(() => readSaved("logs:shortlist", null));
  const [which, setWhich] = useState(() => readSaved("logs:shortlist:tab", "hot"));
  const [onlyUnassigned, setOnlyUnassigned] = useState(() => readSaved("logs:shortlist:unassigned", false));
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState(null);     // row whose name is being edited (admins only)
  const [draft, setDraft] = useState("");
  /* ----- admins: add leads to the shortlist by hand / bulk import ----- */
  const EMPTY_FORM = { phone: "", name: "", temperature: "warm", callback: false, note: "" };
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const importRef = useRef(null);
  const load = useCallback(() => {
    setLoading(true);
    api.get("/ai-call-logs/shortlist")
      .then((r) => { setData(r.data); writeSaved("logs:shortlist", r.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { writeSaved("logs:shortlist:tab", which); }, [which]);
  useEffect(() => { writeSaved("logs:shortlist:unassigned", onlyUnassigned); }, [onlyUnassigned]);

  // patch every row (all four lists) that matches `match`, keep the counts honest
  const patchRows = (match, patch) => setData((d) => {
    if (!d) return d;
    const next = { ...d };
    const un = { ...(d.unassigned_counts || {}) };
    for (const g of ["hot", "warm", "cold", "callback"]) {
      next[g] = (d[g] || []).map((r) => (match(r) ? { ...r, ...patch } : r));
      un[g] = next[g].filter((r) => r.unassigned).length;
    }
    next.unassigned_counts = un;
    writeSaved("logs:shortlist", next);
    return next;
  });
  const phoneKey = (v) => String(v || "").replace(/\D/g, "").slice(-10);

  const assign = async (row, userId) => {
    try {
      const { data: res } = await api.post(`/ai-call-logs/${row.id}/assign`, { user_id: userId });
      patchRows((r) => phoneKey(r.phone) === phoneKey(row.phone),
        { assigned_to: res.assigned_to, assigned_to_name: res.assigned_to_name, unassigned: !res.assigned_to });
      toast.success(`Assigned to ${res.assigned_to_name} — AI Agent tag stays on the lead`);
    } catch (e) { toast.error(apiError(e.response?.data?.detail)); }
  };

  const saveName = async (row) => {
    const name = draft.trim();
    if (!name) return toast.error("Name can't be empty");
    if (name === (row.name || "")) { setEditId(null); return; }
    try {
      await api.post(`/ai-call-logs/${row.id}/name`, { name });
      patchRows((r) => phoneKey(r.phone) === phoneKey(row.phone), { name });
      setEditId(null);
      toast.success("Name updated");
    } catch (e) { toast.error(apiError(e.response?.data?.detail)); }
  };

  const addLead = async () => {
    if (String(form.phone).replace(/\D/g, "").length < 10) return toast.error("Enter a valid 10-digit phone number");
    setSaving(true);
    try {
      const { data: res } = await api.post("/ai-call-logs/shortlist/add", form);
      toast.success(res.result === "updated" ? "Lead already in the shortlist — updated" : "Lead added to the shortlist");
      setWhich(form.callback ? "callback" : form.temperature);
      setForm(EMPTY_FORM);
      setAddOpen(false);
      load();
    } catch (e) { toast.error(apiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  const onImportFile = async (e) => {
    const file = e.target.files
