import { useCallback, useEffect, useState } from "react";
import {
  Bot, Phone, Flame, Snowflake, PhoneForwarded, AlarmClock, MessageCircle,
  Loader2, Eye, RefreshCw, Check, ListChecks, Megaphone, SlidersHorizontal,
  Thermometer, ArrowUpRight, Link2, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, apiError, fmtDate } from "../lib/api";
import { tempMeta, DISPO_META } from "../lib/ai";
import { useAuth } from "../context/AuthContext";
import { StatCard } from "../components/StatCard";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { AICampaigns } from "../components/ai/AICampaigns";
import { AISettingsPanel } from "../components/ai/AISettingsPanel";
import { TranscriptDialog } from "../components/ai/TranscriptDialog";

export default function AICalling() {
  const { isVranda } = useAuth();
  const [stats, setStats] = useState(null);
  const [openCall, setOpenCall] = useState(null);
  const [vaStatus, setVaStatus] = useState(null);

  const loadStats = useCallback(() => {
    api.get("/ai/dashboard").then((r) => setStats(r.data)).catch(() => {});
  }, []);
  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => {
    api.get("/ai/calls/real/settings").then((r) => setVaStatus(r.data)).catch(() => setVaStatus(false));
  }, []);

  return (
    <div className="space-y-6" data-testid="ai-calling-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand">
            <Bot className="h-4 w-4" /> AI Telecalling
          </div>
          <h1 className="brand-font mt-1 text-3xl font-bold text-slate-900">AI Calling Center</h1>
          <p className="mt-1 text-sm text-slate-500">
            Auto-dial assigned leads with a real phone call — a live AI voice agent talks to the
            lead, captures requirements, scores the call, and syncs everything back to the CRM.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={loadStats} data-testid="refresh-stats-btn">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {vaStatus === false || (vaStatus && !vaStatus.voice_agent_url) ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Voice-agent isn't connected yet — calls won't dial until it is.
          <Link to="/settings" className="ml-auto inline-flex items-center gap-1 font-semibold underline">
            <Link2 className="h-3.5 w-3.5" /> Connect it in Settings
          </Link>
        </div>
      ) : vaStatus && vaStatus.voice_agent_url ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Voice-agent connected — every call placed from here is a real phone call.
        </div>
      ) : null}

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="flex h-auto flex-wrap gap-1 bg-slate-100 p-1">
          <TabsTrigger value="overview" data-testid="tab-overview" className="gap-1.5"><Thermometer className="h-3.5 w-3.5" /> Overview</TabsTrigger>
          <TabsTrigger value="campaigns" data-testid="tab-campaigns" className="gap-1.5"><Megaphone className="h-3.5 w-3.5" /> Campaigns</TabsTrigger>
          <TabsTrigger value="calls" data-testid="tab-calls" className="gap-1.5"><Phone className="h-3.5 w-3.5" /> AI Calls</TabsTrigger>
          <TabsTrigger value="followups" data-testid="tab-followups" className="gap-1.5"><AlarmClock className="h-3.5 w-3.5" /> Follow-ups</TabsTrigger>
          <TabsTrigger value="transfers" data-testid="tab-transfers" className="gap-1.5"><PhoneForwarded className="h-3.5 w-3.5" /> Transfers</TabsTrigger>
          <TabsTrigger value="whatsapp" data-testid="tab-whatsapp" className="gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings" className="gap-1.5"><SlidersHorizontal className="h-3.5 w-3.5" /> Agent Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5"><Overview stats={stats} onOpenCall={setOpenCall} /></TabsContent>
        <TabsContent value="campaigns" className="mt-5"><AICampaigns isAdmin={isVranda} onChanged={loadStats} /></TabsContent>
        <TabsContent value="calls" className="mt-5"><CallsTab onOpenCall={setOpenCall} /></TabsContent>
        <TabsContent value="followups" className="mt-5"><FollowupsTab isAdmin={isVranda} onChanged={loadStats} onOpenCall={setOpenCall} /></TabsContent>
        <TabsContent value="transfers" className="mt-5"><TransfersTab onChanged={loadStats} /></TabsContent>
        <TabsContent value="whatsapp" className="mt-5"><WhatsAppTab /></TabsContent>
        <TabsContent value="settings" className="mt-5"><AISettingsPanel /></TabsContent>
      </Tabs>

      <TranscriptDialog callId={openCall} open={!!openCall} onOpenChange={(v) => !v && setOpenCall(null)} />
    </div>
  );
}

/* ---------------- Overview ---------------- */
const Overview = ({ stats, onOpenCall }) => {
  if (!stats) return <Skel />;
  const total = stats.hot + stats.warm + stats.cold + stats.lost || 1;
  const bars = [
    ["hot", stats.hot], ["warm", stats.warm], ["cold", stats.cold], ["lost", stats.lost],
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total AI calls" value={stats.total_calls} icon={Phone} accent="brand" testId="stat-total" />
        <StatCard label="Hot leads" value={stats.hot} icon={Flame} accent="rose" testId="stat-hot" />
        <StatCard label="Warm leads" value={stats.warm} icon={Thermometer} accent="amber" testId="stat-warm" />
        <StatCard label="Cold leads" value={stats.cold} icon={Snowflake} accent="slate" testId="stat-cold" />
        <StatCard label="In queue" value={stats.queued} icon={ListChecks} accent="brand" testId="stat-queued" />
        <StatCard label="Transfers pending" value={stats.transfers_pending} icon={PhoneForwarded} accent="rose" testId="stat-transfers" />
        <StatCard label="Follow-ups due" value={stats.followups_pending} icon={AlarmClock} accent="amber" testId="stat-followups" />
        <StatCard label="WhatsApp sent" value={stats.whatsapp_sent} icon={MessageCircle} accent="emerald" testId="stat-whatsapp" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Lead temperature distribution</h3>
        <div className="mt-4 space-y-3">
          {bars.map(([t, n]) => {
            const meta = tempMeta(t);
            return (
              <div key={t} className="flex items-center gap-3">
                <span className="w-14 text-xs font-semibold capitalize text-slate-500">{meta.label}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className={`h-full rounded-full ${meta.bar} transition-all`} style={{ width: `${Math.round((n / total) * 100)}%` }} />
                </div>
                <span className="w-8 text-right text-sm font-semibold text-slate-700">{n}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5"><h3 className="text-lg font-semibold text-slate-900">Recent AI calls</h3></div>
        <div className="divide-y divide-slate-100">
          {stats.recent.length === 0 && <div className="p-6 text-sm text-slate-400">No AI calls yet — create a campaign and run the queue.</div>}
          {stats.recent.map((c) => <CallRow key={c.id} c={c} onOpen={() => onOpenCall(c.id)} />)}
        </div>
      </div>
    </div>
  );
};

const CallRow = ({ c, onOpen }) => {
  const meta = tempMeta(c.temperature);
  return (
    <div className="flex items-center gap-3 px-5 py-3" data-testid={`call-row-${c.id}`}>
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-light text-brand"><Bot className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-slate-800">{c.lead_name || c.lead_phone}</span>
          <Badge variant="outline" className={`${meta.cls} px-2 py-0 text-[10px]`}>
            <span className={`mr-1 h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label} · {c.intent_score}
          </Badge>
        </div>
        <div className="truncate text-xs text-slate-500">{c.summary}</div>
      </div>
      <span className="hidden text-[11px] text-slate-400 sm:block">{fmtDate(c.created_at)}</span>
      <Button size="sm" variant="ghost" className="gap-1.5 text-brand" onClick={onOpen} data-testid={`view-call-${c.id}`}>
        <Eye className="h-3.5 w-3.5" /> View
      </Button>
    </div>
  );
};

/* ---------------- Calls ---------------- */
const CallsTab = ({ onOpenCall }) => {
  const [calls, setCalls] = useState(null);
  const [temp, setTemp] = useState("all");
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);

  const load = useCallback(() => {
    const params = temp === "all" ? {} : { temperature: temp };
    api.get("/ai/calls", { params }).then((r) => setCalls(r.data)).catch(() => setCalls([]));
    setPage(1);
  }, [temp]);
  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil((calls?.length || 0) / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleCalls = calls?.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500">Filter:</span>
        <Select value={temp} onValueChange={setTemp}>
          <SelectTrigger className="w-40" data-testid="calls-temp-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All temperatures</SelectItem>
            <SelectItem value="hot">Hot</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="cold">Cold</SelectItem>
            <SelectItem value="lost">Lost / invalid</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {calls === null ? <Skel /> : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {calls.length === 0 && <div className="p-6 text-sm text-slate-400">No AI calls in this view.</div>}
            {visibleCalls?.map((c) => {
              const meta = tempMeta(c.temperature);
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3" data-testid={`ai-call-${c.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800">{c.lead_name || c.lead_phone}</span>
                      <Badge variant="outline" className={`${meta.cls} px-2 py-0 text-[10px]`}>{meta.label} · {c.intent_score} pts</Badge>
                      <Badge variant="outline" className="border-slate-200 bg-slate-50 px-2 py-0 text-[10px] text-slate-600">{DISPO_META[c.disposition] || c.disposition}</Badge>
                      {c.human_transfer_required && <Badge variant="outline" className="border-rose-200 bg-rose-50 px-2 py-0 text-[10px] text-rose-700">Transfer</Badge>}
                    </div>
                    <div className="mt-0.5 line-clamp-1 text-xs text-slate-500">{c.summary}</div>
                  </div>
                  <span className="text-[11px] text-slate-400">{fmtDate(c.created_at)}</span>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onOpenCall(c.id)} data-testid={`view-transcript-${c.id}`}>
                    <Eye className="h-3.5 w-3.5" /> Transcript
                  </Button>
                </div>
              );
            })}
          </div>
          {calls.length > PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-slate-100 py-3">
              <button type="button" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                data-testid="ai-calls-page-prev"
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 disabled:opacity-40 hover:bg-slate-50">
                Prev
              </button>
              <span className="text-xs text-slate-400">Page {safePage} of {totalPages} · {calls.length} calls</span>
              <button type="button" disabled={safePage === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                data-testid="ai-calls-page-next"
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 disabled:opacity-40 hover:bg-slate-50">
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ---------------- Follow-ups ---------------- */
const FollowupsTab = ({ isAdmin, onChanged, onOpenCall }) => {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = () => api.get("/ai/followups", { params: { status: "pending" } }).then((r) => setItems(r.data)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  const recall = async (id) => {
    setBusy(id);
    try {
      await api.post(`/ai/followups/${id}/recall`);
      toast.success("Calling now — real phone call in progress");
      load(); onChanged?.();
    }
    catch (e) { toast.error(apiError(e.response?.data?.detail)); }
    finally { setBusy(null); }
  };
  const done = async (id) => {
    try { await api.post(`/ai/followups/${id}/done`); toast.success("Marked done"); load(); onChanged?.(); }
    catch (e) { toast.error(apiError(e.response?.data?.detail)); }
  };

  if (items === null) return <Skel />;
  if (items.length === 0) return <Empty icon={AlarmClock} text="No pending AI follow-ups." />;
  return (
    <div className="space-y-3">
      {items.map((f) => (
        <div key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={`followup-${f.id}`}>
          <div className="grid h-9 w-9 place-items-center rounded-full bg-amber-50 text-amber-600"><AlarmClock className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-800">{f.lead_name || f.lead_phone}</div>
            <div className="text-xs text-slate-500">Due {fmtDate(f.due_at)} · {f.reason} · {f.prior_summary?.slice(0, 70)}</div>
          </div>
          {isAdmin && (
            <Button size="sm" className="gap-1.5 bg-brand hover:bg-brand-dark" disabled={busy === f.id} onClick={() => recall(f.id)} data-testid={`recall-${f.id}`}>
              {busy === f.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Phone className="h-3.5 w-3.5" />} Call now (real)
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => done(f.id)} data-testid={`followup-done-${f.id}`}>
            <Check className="h-3.5 w-3.5" /> Done
          </Button>
        </div>
      ))}
    </div>
  );
};

/* ---------------- Transfers ---------------- */
const TransfersTab = ({ onChanged }) => {
  const [items, setItems] = useState(null);
  const load = () => api.get("/ai/transfers", { params: { status: "pending" } }).then((r) => setItems(r.data)).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  const resolve = async (id) => {
    try { await api.post(`/ai/transfers/${id}/resolve`); toast.success("Transfer resolved"); load(); onChanged?.(); }
    catch (e) { toast.error(apiError(e.response?.data?.detail)); }
  };

  if (items === null) return <Skel />;
  if (items.length === 0) return <Empty icon={PhoneForwarded} text="No pending human transfers." />;
  return (
    <div className="space-y-3">
      {items.map((t) => {
        const meta = tempMeta(t.temperature);
        return (
          <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50/40 p-4 shadow-sm" data-testid={`transfer-${t.id}`}>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-rose-100 text-rose-600"><PhoneForwarded className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{t.lead_name || t.lead_phone}</span>
                <Badge variant="outline" className={`${meta.cls} px-2 py-0 text-[10px]`}>{meta.label} · {t.intent_score}</Badge>
              </div>
              <div className="text-xs text-slate-500">{t.reason?.slice(0, 90)}</div>
              <div className="mt-0.5 text-[11px] font-medium text-rose-700">→ Route to {t.target_name} · {t.target_number}</div>
            </div>
            <a href={`tel:+91${t.target_number}`} className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-white px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-light" data-testid={`call-vranda-${t.id}`}>
              <Phone className="h-3.5 w-3.5" /> Call {t.target_name.split(" ")[0]}
            </a>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => resolve(t.id)} data-testid={`resolve-transfer-${t.id}`}>
              <Check className="h-3.5 w-3.5" /> Resolve
            </Button>
          </div>
        );
      })}
    </div>
  );
};

/* ---------------- WhatsApp ---------------- */
const WhatsAppTab = () => {
  const [items, setItems] = useState(null);
  useEffect(() => { api.get("/ai/whatsapp").then((r) => setItems(r.data)).catch(() => setItems([])); }, []);
  if (items === null) return <Skel />;
  if (items.length === 0) return <Empty icon={MessageCircle} text="No WhatsApp follow-ups logged yet." />;
  return (
    <div className="space-y-3">
      {items.map((w) => (
        <div key={w.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={`wa-${w.id}`}>
          <div className="grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-emerald-600"><MessageCircle className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">{w.lead_name || w.lead_phone}</span>
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-2 py-0 text-[10px] text-emerald-700 capitalize">{w.status}</Badge>
              <Badge variant="outline" className="border-slate-200 bg-slate-50 px-2 py-0 text-[10px] text-slate-600 capitalize">{(w.kind || "").replace("_", " ")}</Badge>
            </div>
            <div className="text-xs text-slate-500">{w.message}</div>
          </div>
          <span className="text-[11px] text-slate-400">{fmtDate(w.created_at)}</span>
        </div>
      ))}
    </div>
  );
};

const Skel = () => <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>;
const Empty = ({ icon: Icon, text }) => (
  <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
    <Icon className="mx-auto h-8 w-8 text-slate-300" />
    <p className="mt-3 text-sm text-slate-500">{text}</p>
  </div>
);
