import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus, Search, UserPlus, Loader2, Trash2, Filter, MessageCircle,
  AlarmClock, CalendarClock, Flag, PhoneCall, User, Bot,
  Download, FileSpreadsheet, FileText, FileDown,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDuration, fmtMoney, fmtDate, waLink, STATUS_META, STATUSES } from "../lib/api";
import { tempMeta } from "../lib/ai";
import { useClickToCall } from "../hooks/use-click-to-call";
import { useAuth } from "../context/AuthContext";
import { InlineEditField, InlineBudgetField } from "../components/InlineEditField";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

// "My Leads" is the admin/manager's own personal working tab — it always
// scopes to leads assigned to the logged-in user, no matter their role.
// It carries the same day-to-day tools as the All Leads page (call, WhatsApp,
// tag, stage, follow-up, remarks) plus the ability to hand a lead off to a
// teammate right from this view.

const SOURCES = ["Website", "99acres", "MagicBricks", "Meta Ads", "Google Ads", "Referral", "Walk-in", "CSV Import"];
const TAGS = [
  { v: "hot", label: "Hot lead", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  { v: "warm", label: "Warm", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  { v: "cold", label: "Cold", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  { v: "raw", label: "Raw data", cls: "bg-slate-50 text-slate-600 border-slate-200" },
];
const DEAL_TYPES = [
  { v: "resale", label: "Resale", cls: "border-violet-200 bg-violet-50 text-violet-700" },
  { v: "rent", label: "Rent", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
];
const FU_STATUSES = [
  { v: "interested", label: "Interested" },
  { v: "visit_scheduled", label: "Visit Scheduled" },
  { v: "callback", label: "Callback" },
  { v: "not_interested", label: "Not interested" },
  { v: "converted", label: "Converted" },
  { v: "no_answer", label: "Didn't Pick" },
  { v: "switched_off", label: "Switched off" },
  { v: "invalid", label: "Invalid" },
];

const tagMeta = (v) => TAGS.find((t) => t.v === v) || (v ? { v, label: v, cls: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200" } : null);

export default function MyLeads() {
  const { user, isAdmin, isVranda } = useAuth();
  const myId = user?.id;
  const [leads, setLeads] = useState(null);
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const [agents, setAgents] = useState([]);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("all");
  const [fu, setFu] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", email: "", source: "Website", status: "new", tag: "", deal_type: "",
    budget: "", property_interest: "", city: "", notes: "", remark: "",
  });

  // Tracks in-flight refetches separately from the very first load, since
  // `leads` stays populated with the old results while a new request is
  // out -- without this, changing a filter looked like nothing was
  // happening until the new page suddenly swapped in.
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!myId) return;
    const q = { assigned_to: myId };
    if (status !== "all") q.status = status;
    if (tag !== "all") q.tag = tag;
    if (fu !== "all") q.follow_up_status = fu;
    if (search) q.search = search;
    if (dateFrom) q.follow_up_from = new Date(dateFrom).toISOString();
    if (dateTo) {
      const d = new Date(dateTo); d.setHours(23, 59, 59, 999);
      q.follow_up_to = d.toISOString();
    }
    setRefreshing(true);
    try {
      const { data } = await api.get("/leads", { params: q });
      setLeads(data);
      setSelected([]);
      setPage(1);
    } finally {
      setRefreshing(false);
    }
  }, [status, tag, fu, dateFrom, dateTo, search, myId]);

  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    api.get("/users").then((r) => setAgents(r.data.filter((u) =>
      (["sales", "team_lead"].includes(u.role) || u.username === "sandeep.chauhan") && u.id !== myId)));
  }, [myId]);

  const allSelected = leads?.length > 0 && selected.length === leads.length;
  const toggleAll = () => setSelected(allSelected ? [] : leads.map((l) => l.id));
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const totalPages = Math.max(1, Math.ceil((leads?.length || 0) / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleLeads = useMemo(
    () => leads?.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [leads, safePage]
  );
  const pageNumbers = useMemo(() => {
    const end = Math.min(totalPages, Math.max(5, safePage + 2));
    const start = Math.max(1, end - 4);
    const nums = [];
    for (let i = start; i <= end; i++) nums.push(i);
    return nums;
  }, [safePage, totalPages]);

  const pager = leads && leads.length > PAGE_SIZE && (
    <div className="flex flex-wrap items-center justify-center gap-1.5 py-3">
      <button type="button" disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
        data-testid="myleads-page-prev"
        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 disabled:opacity-40 hover:bg-slate-50">
        Prev
      </button>
      {pageNumbers[0] > 1 && <span className="px-1 text-xs text-slate-400">…</span>}
      {pageNumbers.map((n) => (
        <button key={n} type="button" onClick={() => setPage(n)} data-testid={`myleads-page-${n}`}
          className={`h-7 min-w-[1.75rem] rounded-lg px-2 text-xs font-semibold ${n === safePage ? "bg-brand text-white" : "border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          {n}
        </button>
      ))}
      {pageNumbers[pageNumbers.length - 1] < totalPages && <span className="px-1 text-xs text-slate-400">…</span>}
      <button type="button" disabled={safePage === totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        data-testid="myleads-page-next"
        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 disabled:opacity-40 hover:bg-slate-50">
        Next
      </button>
      <span className="ml-2 text-xs text-slate-400">Page {safePage} of {totalPages} · {leads.length} leads</span>
    </div>
  );

  const createLead = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        budget: form.budget ? Number(form.budget) : null,
        assigned_to: myId,
        email: form.email || null,
        tag: form.tag || null,
        deal_type: form.deal_type || null,
      };
      await api.post("/leads", payload);
      toast.success("Lead created and added to your queue");
      setAddOpen(false);
      setForm({ name: "", phone: "", email: "", source: "Website", status: "new", tag: "", deal_type: "",
        budget: "", property_interest: "", city: "", notes: "", remark: "" });
      load();
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const doAssign = async () => {
    if (!assignTo || selected.length === 0) return;
    setBusy(true);
    try {
      const { data } = await api.post("/leads/assign", { lead_ids: selected, agent_id: assignTo });
      toast.success(`${data.assigned} lead(s) handed off`);
      setAssignTo("");
      load();
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally { setBusy(false); }
  };

  // Downloads the leads currently visible on this page (respecting the
  // active status/tag filters) as CSV, Excel, or PDF. The backend already
  // scopes /leads/export to "assigned to me" for non-manager roles, so this
  // can never pull in another agent's leads.
  const downloadExport = async (format) => {
    setExporting(true);
    try {
      const params = { format };
      if (status !== "all") params.status = status;
      if (tag !== "all") params.tag = tag;
      const { data } = await api.get("/leads/export", { params, responseType: "blob" });
      const ext = format === "xlsx" ? "xlsx" : format;
      const url = window.URL.createObjectURL(new Blob([data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `my-leads.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Download started");
    } catch (err) {
      // With responseType "blob", an error response body also arrives as a
      // Blob instead of parsed JSON — read it back out as text to get the
      // real detail message instead of showing "[object Blob]".
      let detail = "Download failed";
      const body = err.response?.data;
      if (body instanceof Blob) {
        try { detail = JSON.parse(await body.text())?.detail || detail; } catch { /* keep default */ }
      } else if (body?.detail) {
        detail = body.detail;
      }
      toast.error(apiError(detail));
    } finally { setExporting(false); }
  };

  const removeLead = async (id) => {
    try {
      await api.delete(`/leads/${id}`);
      toast.success("Lead deleted");
      load();
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    }
  };

  const callLead = useClickToCall();

  const setLeadTag = async (l, newTag) => {
    try {
      await api.put(`/leads/${l.id}`, { tag: newTag });
      setLeads((prev) => prev.map((x) => (x.id === l.id ? { ...x, tag: newTag } : x)));
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    }
  };

  const setFollowUpStatus = async (l, newStatus) => {
    try {
      await api.put(`/leads/${l.id}`, { follow_up_status: newStatus || null });
      setLeads((prev) => prev.map((x) => (x.id === l.id ? { ...x, follow_up_status: newStatus || null } : x)));
      toast.success("Follow-up status updated");
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    }
  };

  const updateLead = async (l, updates, successMessage) => {
    try {
      await api.put(`/leads/${l.id}`, updates);
      setLeads((prev) => prev.map((x) => (x.id === l.id ? { ...x, ...updates } : x)));
      if (successMessage) toast.success(successMessage);
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    }
  };

  const setDealType = (l, dealType) => updateLead(
    l,
    { deal_type: l.deal_type === dealType ? null : dealType },
    l.deal_type === dealType ? "Listing flag removed" : `${dealType === "resale" ? "Resale" : "Rent"} flag set`
  );

  const toggleBrochure = async (l) => {
    try {
      await api.put(`/leads/${l.id}`, { brochure_sent: !l.brochure_sent });
      setLeads((prev) => prev.map((x) => (x.id === l.id ? { ...x, brochure_sent: !l.brochure_sent } : x)));
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    }
  };

  const totals = useMemo(() => {
    if (!leads) return { talk: 0, value: 0 };
    return {
      talk: leads.reduce((a, l) => a + (l.total_talk_time || 0), 0),
      value: leads.reduce((a, l) => a + (l.budget || 0), 0),
    };
  }, [leads]);

  return (
    <div className="space-y-5" data-testid="my-leads-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <User className="h-6 w-6 text-brand" />
            <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">My Leads</h1>
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-slate-500">
            <span>
              Your own working queue — leads assigned to you.{" "}
              {leads ? `${leads.length} leads · ${fmtDuration(totals.talk)} talk time · ${fmtMoney(totals.value)} value` : "Loading…"}
            </span>
            {refreshing && leads && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-400" data-testid="leads-refreshing" />}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="my-leads-download-btn" disabled={exporting} className="gap-2">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem data-testid="my-leads-download-csv" onClick={() => downloadExport("csv")} className="gap-2">
                <FileText className="h-4 w-4" /> CSV
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="my-leads-download-xlsx" onClick={() => downloadExport("xlsx")} className="gap-2">
                <FileSpreadsheet className="h-4 w-4" /> Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="my-leads-download-pdf" onClick={() => downloadExport("pdf")} className="gap-2">
                <FileDown className="h-4 w-4" /> PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="my-leads-add-btn" className="gap-2 bg-brand hover:bg-brand-dark">
                <Plus className="h-4 w-4" /> New Lead
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader><DialogTitle>Create lead (assigned to you)</DialogTitle></DialogHeader>
              <form onSubmit={createLead} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Full name *</Label>
                    <Input data-testid="my-lead-name-input" required value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Phone *</Label>
                    <Input data-testid="my-lead-phone-input" required value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+919812345678" /></div>
                  <div className="space-y-2"><Label>Email</Label>
                    <Input data-testid="my-lead-email-input" value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Budget (₹)</Label>
                    <Input data-testid="my-lead-budget-input" type="number" value={form.budget}
                      onChange={(e) => setForm({ ...form, budget: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Source</Label>
                    <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                      <SelectTrigger data-testid="my-lead-source-select"><SelectValue /></SelectTrigger>
                      <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div className="space-y-2"><Label>Stage</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger data-testid="my-lead-status-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
                      </SelectContent>
                    </Select></div>
                  <div className="space-y-2"><Label>Tag</Label>
                    <Select value={form.tag || "none"} onValueChange={(v) => setForm({ ...form, tag: v === "none" ? "" : v })}>
                      <SelectTrigger data-testid="my-lead-tag-select"><SelectValue placeholder="— none —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— none —</SelectItem>
                        {TAGS.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select></div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Listing type</Label>
                    <div className="flex gap-2">
                      {DEAL_TYPES.map((type) => (
                        <Button key={type.v} type="button" variant="outline"
                          onClick={() => setForm({ ...form, deal_type: form.deal_type === type.v ? "" : type.v })}
                          className={`gap-1.5 ${form.deal_type === type.v ? type.cls : ""}`}>
                          <Flag className="h-3.5 w-3.5" /> {type.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2"><Label>Property interest</Label>
                    <Input data-testid="my-lead-property-input" value={form.property_interest}
                      onChange={(e) => setForm({ ...form, property_interest: e.target.value })} placeholder="3BHK Apartment" /></div>
                  <div className="space-y-2"><Label>City</Label>
                    <Input data-testid="my-lead-city-input" value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Custom remark</Label>
                    <Input data-testid="my-lead-remark-input" value={form.remark}
                      onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="e.g. hot lead - budget flexible" /></div>
                </div>
                <div className="space-y-2"><Label>Notes</Label>
                  <Textarea data-testid="my-lead-notes-input" value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} /></div>
                <DialogFooter>
                  <Button type="submit" disabled={busy} data-testid="my-lead-submit-btn" className="bg-brand hover:bg-brand-dark">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create lead"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input data-testid="my-lead-search-input" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, email, remark, city…" className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36" data-testid="my-leads-filter-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger className="w-36" data-testid="my-leads-filter-tag"><SelectValue placeholder="Tag" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tags</SelectItem>
            {TAGS.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fu} onValueChange={setFu}>
          <SelectTrigger className="w-40" data-testid="my-leads-filter-followup-status"><SelectValue placeholder="Follow-up" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All follow-ups</SelectItem>
            {FU_STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <CalendarClock className="h-4 w-4 text-slate-400" />
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="my-leads-filter-date-from" className="w-36" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="my-leads-filter-date-to" className="w-36" />
        </div>
      </div>

      {/* Hand-off bar — assign selected leads from your queue to a teammate */}
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand-light p-4" data-testid="my-leads-assign-bar">
          <UserPlus className="h-4 w-4 text-brand" />
          <span className="text-sm font-medium text-brand">{selected.length} selected</span>
          <Select value={assignTo} onValueChange={setAssignTo}>
            <SelectTrigger className="w-56 bg-white" data-testid="my-leads-assign-select">
              <SelectValue placeholder="Hand off to…" />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.role})</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={doAssign} disabled={!assignTo || busy}
            data-testid="my-leads-assign-confirm" className="bg-brand hover:bg-brand-dark">
            Assign lead(s)
          </Button>
        </div>
      )}

      {/* Phone layout */}
      <div className="space-y-3 md:hidden">
        {leads === null && <div className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand" /></div>}
        {leads?.length === 0 && <div className="rounded-xl border bg-white p-10 text-center text-sm text-slate-400">No leads in your queue yet.</div>}
        {visibleLeads?.map((l) => {
          const tm = tagMeta(l.tag);
          return <article key={l.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={`my-lead-card-${l.id}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex gap-2">
                {DEAL_TYPES.map((type) => <Button key={type.v} size="sm" variant="outline" onClick={() => setDealType(l, type.v)}
                  className={`h-7 gap-1 px-2 text-xs ${l.deal_type === type.v ? type.cls : "text-slate-500"}`}><Flag className="h-3 w-3" />{type.label}</Button>)}
              </div>
              <Checkbox checked={selected.includes(l.id)} onCheckedChange={() => toggle(l.id)} data-testid={`my-lead-select-${l.id}`} />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <InlineEditField
                  value={l.name}
                  onSave={(v) => updateLead(l, { name: v }, "Name updated")}
                  emptyLabel="(no name)"
                  testId={`my-lead-name-m-${l.id}`}
                  displayClassName="text-base font-bold text-slate-900"
                />
                <Link to={`/leads/${l.id}`} data-testid={`my-lead-open-${l.id}`} className="mt-1 block text-sm text-slate-500 hover:text-brand">
                  {l.phone}
                </Link>
              </div>
              <div className="flex items-center gap-2">
                <a href={waLink(l.phone, l.name)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${l.name || l.phone}`}
                  data-testid={`my-lead-wa-mobile-${l.id}`} className="rounded-lg bg-emerald-500 p-2.5 text-white">
                  <MessageCircle className="h-5 w-5" />
                </a>
                <button type="button" onClick={() => callLead(l)} aria-label={`Call ${l.name || l.phone}`}
                  data-testid={`my-lead-call-${l.id}`} className="rounded-lg bg-brand p-2.5 text-white">
                  <PhoneCall className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Select value={l.tag || "none"} onValueChange={(v) => setLeadTag(l, v === "none" ? "" : v)}>
                <SelectTrigger className={`h-9 text-xs font-semibold ${tm?.cls || ""}`}><SelectValue placeholder="Temperature" /></SelectTrigger>
                <SelectContent><SelectItem value="none">No temperature</SelectItem>{TAGS.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={l.status} onValueChange={(value) => updateLead(l, { status: value }, "Stage updated")}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="mt-2">
              <Select value={l.follow_up_status || "none"} onValueChange={(v) => setFollowUpStatus(l, v === "none" ? "" : v)}>
                <SelectTrigger data-testid={`my-lead-followup-select-${l.id}`} className="h-9 text-xs">
                  <SelectValue placeholder="Follow-up status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— no follow-up —</SelectItem>
                  {FU_STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {l.follow_up_at && (
                <div className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                  <AlarmClock className="h-3 w-3" /> {fmtDate(l.follow_up_at)}
                </div>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-50 p-2.5">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Budget</div>
                <InlineBudgetField
                  value={l.budget}
                  onSave={(v) => updateLead(l, { budget: v }, "Budget updated")}
                  formatDisplay={fmtMoney}
                  testId={`my-lead-budget-m-${l.id}`}
                  displayClassName="text-sm font-semibold text-slate-800"
                />
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Talk time</div>
                <div className="px-1 py-0.5 text-sm font-semibold text-slate-800">{fmtDuration(l.total_talk_time)}</div>
              </div>
            </div>
            <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Remarks</div>
              <InlineEditField
                value={l.remark}
                type="textarea"
                onSave={(v) => updateLead(l, { remark: v }, "Remark updated")}
                emptyLabel="No remarks added."
                testId={`my-lead-remark-m-${l.id}`}
                displayClassName="whitespace-pre-wrap break-words text-sm text-slate-700"
              />
            </div>
          </article>;
        })}
        {pager}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                <th className="w-10 px-4 py-3">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} data-testid="my-leads-select-all" />
                </th>
                <th className="px-4 py-3 text-left">Lead</th>
                <th className="px-3 py-3 text-left">Tag</th>
                <th className="px-3 py-3 text-left">Stage</th>
                <th className="px-3 py-3 text-left">Follow-up</th>
                <th className="px-3 py-3 text-left">Remark</th>
                <th className="px-3 py-3 text-center">WA</th>
                <th className="px-3 py-3 text-right">Budget</th>
                <th className="px-3 py-3 text-right">Talk</th>
                <th className="w-12 px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {leads === null && (
                <tr><td colSpan={10} className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand" /></td></tr>
              )}
              {leads?.length === 0 && (
                <tr><td colSpan={10} className="p-10 text-center text-slate-400">No leads in your queue yet.</td></tr>
              )}
              {visibleLeads?.map((l) => {
                const tm = tagMeta(l.tag);
                return (
                  <tr key={l.id} data-testid={`my-lead-row-${l.id}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Checkbox checked={selected.includes(l.id)} onCheckedChange={() => toggle(l.id)}
                        data-testid={`my-lead-select-${l.id}`} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          {l.deal_type && <div className={`mb-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${DEAL_TYPES.find((t) => t.v === l.deal_type)?.cls}`}><Flag className="h-3 w-3" />{DEAL_TYPES.find((t) => t.v === l.deal_type)?.label}</div>}
                          <InlineEditField
                            value={l.name}
                            onSave={(v) => updateLead(l, { name: v }, "Name updated")}
                            emptyLabel="(no name)"
                            testId={`my-lead-name-${l.id}`}
                            displayClassName="font-medium text-slate-800"
                          />
                          <Link to={`/leads/${l.id}`} data-testid={`my-lead-open-${l.id}`} className="mt-0.5 block px-1 text-[11px] text-slate-400 hover:text-brand">
                            {l.phone} · {l.source}
                          </Link>
                          {isVranda && l.ai_temperature && (
                            <Link to={`/leads/${l.id}`} title={l.ai_summary || "AI call completed"}
                              data-testid={`my-ai-badge-${l.id}`}
                              className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tempMeta(l.ai_temperature).cls}`}>
                              <Bot className="h-3 w-3" />
                              AI: {tempMeta(l.ai_temperature).label}
                              {typeof l.ai_intent_score === "number" && <span className="opacity-70">· {l.ai_intent_score}pts</span>}
                            </Link>
                          )}
                          {isVranda && !l.ai_temperature && l.ai_call_status === "dialing" && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                              <Bot className="h-3 w-3" /> AI calling…
                            </span>
                          )}
                        </div>
                        <button type="button" onClick={() => callLead(l)} title="Call now" aria-label={`Call ${l.name || l.phone}`}
                          data-testid={`my-lead-call-now-${l.id}`} className="rounded-lg p-1.5 text-brand hover:bg-brand-light">
                          <PhoneCall className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Select value={l.tag || "none"} onValueChange={(v) => setLeadTag(l, v === "none" ? "" : v)}>
                        <SelectTrigger data-testid={`my-lead-row-tag-${l.id}`} className={`h-7 w-28 border-none px-2 text-[11px] font-semibold ${tm?.cls || "text-slate-400"}`}>
                          <SelectValue placeholder="— tag —" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— none —</SelectItem>
                          {TAGS.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2.5">
                      <Select value={l.status} onValueChange={(value) => updateLead(l, { status: value }, "Stage updated")}>
                        <SelectTrigger className={`h-7 w-28 border-none px-2 text-[11px] font-semibold ${STATUS_META[l.status]?.cls}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <div className="space-y-1">
                        {l.follow_up_at && (
                          <div className="flex items-center gap-1 font-semibold text-amber-700">
                            <AlarmClock className="h-3 w-3" />
                            {fmtDate(l.follow_up_at)}
                          </div>
                        )}
                        <Select value={l.follow_up_status || "none"} onValueChange={(v) => setFollowUpStatus(l, v === "none" ? "" : v)}>
                          <SelectTrigger data-testid={`my-lead-row-followup-${l.id}`} className="h-7 w-32 border-none px-2 text-[11px] font-semibold text-slate-500">
                            <SelectValue placeholder="— follow-up —" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— none —</SelectItem>
                            {FU_STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </td>
                    <td className="max-w-xs px-3 py-2.5 text-slate-600">
                      <InlineEditField
                        value={l.remark}
                        type="textarea"
                        onSave={(v) => updateLead(l, { remark: v }, "Remark updated")}
                        emptyLabel="—"
                        testId={`my-lead-remark-${l.id}`}
                        displayClassName="whitespace-pre-wrap break-words"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-2">
                        <a href={waLink(l.phone, l.name)} target="_blank" rel="noreferrer"
                          data-testid={`my-lead-wa-${l.id}`}
                          className="text-emerald-500 hover:text-emerald-700">
                          <MessageCircle className="h-4 w-4" />
                        </a>
                        <Checkbox checked={!!l.brochure_sent} onCheckedChange={() => toggleBrochure(l)}
                          data-testid={`my-lead-brochure-${l.id}`} title="Brochure sent" />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <InlineBudgetField
                        value={l.budget}
                        onSave={(v) => updateLead(l, { budget: v }, "Budget updated")}
                        formatDisplay={fmtMoney}
                        testId={`my-lead-budget-${l.id}`}
                        displayClassName="justify-end text-right text-slate-600"
                      />
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-800">{fmtDuration(l.total_talk_time)}</td>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        <button onClick={() => removeLead(l.id)} data-testid={`my-lead-delete-${l.id}`}
                          className="text-slate-300 hover:text-rose-500">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {leads && leads.length > PAGE_SIZE && <div className="border-t border-slate-200">{pager}</div>}
        </div>
      </div>
    </div>
  );
}
