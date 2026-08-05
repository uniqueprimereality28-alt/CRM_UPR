import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Plus, Search, Upload, UserPlus, Loader2, Trash2, Filter, MessageCircle,
  AlarmClock, Flame, Tag as TagIcon, CalendarClock, Copy, ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDuration, fmtMoney, fmtDate, waLink, STATUS_META, STATUSES } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";

const SOURCES = ["Website", "99acres", "MagicBricks", "Facebook Ads", "Google Ads", "Referral", "Walk-in", "CSV Import"];
const TAGS = [
  { v: "hot", label: "Hot lead", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  { v: "warm", label: "Warm", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  { v: "cold", label: "Cold", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  { v: "raw", label: "Raw data", cls: "bg-slate-50 text-slate-600 border-slate-200" },
  { v: "resale", label: "Re-sale", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  { v: "rent", label: "Rent", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
];
const FU_STATUSES = [
  { v: "interested", label: "Interested" },
  { v: "visit_scheduled", label: "Visit Scheduled" },
  { v: "callback", label: "Callback" },
  { v: "not_interested", label: "Not interested" },
  { v: "converted", label: "Converted" },
];

const tagMeta = (v) => TAGS.find((t) => t.v === v) || (v ? { v, label: v, cls: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200" } : null);

export default function Leads() {
  const { isManager, canViewAll, isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();
  const [leads, setLeads] = useState(null);
  const [agents, setAgents] = useState([]);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("all");
  const [fu, setFu] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [agentFilter, setAgentFilter] = useState(params.get("unassigned") ? "unassigned" : "all");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [assignTo, setAssignTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "", email: "", source: "Website", status: "new", tag: "",
    budget: "", property_interest: "", city: "", notes: "", remark: "", assigned_to: "",
  });
  const [file, setFile] = useState(null);
  const [importAgent, setImportAgent] = useState("none");
  const [importTag, setImportTag] = useState("none");
  const [importRemark, setImportRemark] = useState("");
  const [importResult, setImportResult] = useState(null);
  const [skipDupes, setSkipDupes] = useState(true);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupData, setDupData] = useState(null);
  const [dupBusy, setDupBusy] = useState(false);

  const load = useCallback(async () => {
    const q = {};
    if (status !== "all") q.status = status;
    if (tag !== "all") q.tag = tag;
    if (fu !== "all") q.follow_up_status = fu;
    if (search) q.search = search;
    if (dateFrom) q.follow_up_from = new Date(dateFrom).toISOString();
    if (dateTo) {
      const d = new Date(dateTo); d.setHours(23, 59, 59, 999);
      q.follow_up_to = d.toISOString();
    }
    if (isManager && agentFilter === "unassigned") q.unassigned = true;
    else if (isManager && agentFilter !== "all") q.assigned_to = agentFilter;
    const { data } = await api.get("/leads", { params: q });
    setLeads(data);
    setSelected([]);
  }, [status, tag, fu, dateFrom, dateTo, search, agentFilter, isManager]);

  useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    if (isManager) api.get("/users").then((r) => setAgents(r.data.filter((u) => ["sales", "team_lead"].includes(u.role))));
  }, [isManager]);

  const allSelected = leads?.length > 0 && selected.length === leads.length;
  const toggleAll = () => setSelected(allSelected ? [] : leads.map((l) => l.id));
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const createLead = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        budget: form.budget ? Number(form.budget) : null,
        assigned_to: form.assigned_to || null,
        email: form.email || null,
        tag: form.tag || null,
      };
      await api.post("/leads", payload);
      toast.success("Lead created");
      setAddOpen(false);
      setForm({ name: "", phone: "", email: "", source: "Website", status: "new", tag: "",
        budget: "", property_interest: "", city: "", notes: "", remark: "", assigned_to: "" });
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
      toast.success(`${data.assigned} lead(s) assigned`);
      setAssignTo("");
      load();
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const doImport = async () => {
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    if (importAgent !== "none") fd.append("assigned_to", importAgent);
    if (importTag !== "none") fd.append("default_tag", importTag);
    if (importRemark.trim()) fd.append("default_remark", importRemark.trim());
    fd.append("skip_duplicates", String(skipDupes));
    try {
      const { data } = await api.post("/leads/import", fd);
      setImportResult(data);
      if (data.total_duplicates > 0) {
        toast.warning(`Imported ${data.inserted} · ${data.total_duplicates} duplicate phone(s) ${skipDupes ? "skipped" : "kept"}`);
      } else {
        toast.success(`Imported ${data.inserted} leads (${data.missing || 0} missing name/phone)`);
      }
      load();
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const resetImport = () => {
    setImportOpen(false);
    setFile(null); setImportRemark(""); setImportResult(null);
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

  const bulkDelete = async () => {
    if (selected.length === 0) return;
    if (!window.confirm(`Delete ${selected.length} selected lead(s)? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const { data } = await api.post("/leads/bulk-delete", { lead_ids: selected });
      toast.success(`${data.deleted} lead(s) deleted`);
      setSelected([]);
      load();
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const openDuplicates = async () => {
    setDupOpen(true);
    setDupData(null);
    try {
      const { data } = await api.get("/leads/duplicates");
      setDupData(data);
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
      setDupData({ groups: [], total_duplicate_leads: 0 });
    }
  };

  const clearDuplicates = async (keep) => {
    if (!window.confirm(
      `Clear duplicates and keep the ${keep === "newest" ? "newest" : "oldest"} lead in each group? Extra copies will be permanently deleted.`
    )) return;
    setDupBusy(true);
    try {
      const { data } = await api.post("/leads/duplicates/clear", { keep });
      toast.success(`${data.removed} duplicate lead(s) removed`);
      setDupOpen(false);
      load();
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally { setDupBusy(false); }
  };

  const setLeadTag = async (l, newTag) => {
    try {
      await api.put(`/leads/${l.id}`, { tag: newTag });
      setLeads((prev) => prev.map((x) => (x.id === l.id ? { ...x, tag: newTag } : x)));
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    }
  };

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
    <div className="space-y-5" data-testid="leads-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">{isManager ? "All Leads" : "My Leads"}</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {leads ? `${leads.length} leads · ${fmtDuration(totals.talk)} talk time · ${fmtMoney(totals.value)} value` : "Loading…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button variant="outline" onClick={openDuplicates} data-testid="find-duplicates-btn" className="gap-2">
              <Copy className="h-4 w-4" /> Duplicates
            </Button>
          )}
          {isManager && (
            <Dialog open={importOpen} onOpenChange={(v) => { if (!v) resetImport(); else setImportOpen(true); }}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="import-csv-btn" className="gap-2">
                  <Upload className="h-4 w-4" /> Import CSV
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Bulk import leads</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                    CSV headers supported: <b>name, phone, email, source, status, budget, property_interest, city, notes, tag, remark</b>.
                    Name and phone are required. Default tag/remark below apply to every imported lead.
                  </p>
                  <Input type="file" accept=".csv" data-testid="csv-file-input"
                    onChange={(e) => { setFile(e.target.files?.[0] || null); setImportResult(null); }} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Assign to</Label>
                      <Select value={importAgent} onValueChange={setImportAgent}>
                        <SelectTrigger data-testid="import-agent-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Leave unassigned</SelectItem>
                          {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Default tag</Label>
                      <Select value={importTag} onValueChange={setImportTag}>
                        <SelectTrigger data-testid="import-tag-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— none —</SelectItem>
                          {TAGS.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Default remark (applies to whole file)</Label>
                    <Input data-testid="import-remark-input" value={importRemark}
                      onChange={(e) => setImportRemark(e.target.value)}
                      placeholder="e.g. Q4-Diwali-Facebook-Campaign" />
                  </div>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-amber-50/60 p-3 text-xs text-slate-700">
                    <Checkbox checked={skipDupes} onCheckedChange={setSkipDupes} data-testid="skip-duplicates-checkbox" />
                    <span>Skip rows whose phone number already exists in CRM — <b>duplicate detector</b> prevents calling the same buyer twice.</span>
                  </label>
                  {importResult && (
                    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs" data-testid="import-result">
                      <div className="flex items-center justify-between font-semibold text-slate-700">
                        <span>Import summary</span>
                        <span>{importResult.inserted} inserted · {importResult.skipped} skipped · {importResult.missing || 0} missing name/phone</span>
                      </div>
                      {importResult.total_duplicates > 0 && (
                        <div>
                          <div className="mt-1 font-semibold text-amber-700">
                            {importResult.total_duplicates} duplicate phone(s) detected:
                          </div>
                          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded bg-slate-50 p-2">
                            {importResult.duplicates.slice(0, 20).map((d, i) => (
                              <div key={i} className="flex items-center justify-between text-[11px]">
                                <span className="text-slate-600">{d.name} · {d.phone}</span>
                                <span className="text-slate-400">already: {d.existing_name}</span>
                              </div>
                            ))}
                            {importResult.total_duplicates > 20 && (
                              <div className="text-[10px] text-slate-400">…and {importResult.total_duplicates - 20} more</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button onClick={doImport} disabled={!file || busy} data-testid="csv-upload-submit" className="bg-brand hover:bg-brand-dark">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upload"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}

          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button data-testid="add-lead-btn" className="gap-2 bg-brand hover:bg-brand-dark">
                <Plus className="h-4 w-4" /> New Lead
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader><DialogTitle>Create lead</DialogTitle></DialogHeader>
              <form onSubmit={createLead} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label>Full name *</Label>
                    <Input data-testid="lead-name-input" required value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Phone *</Label>
                    <Input data-testid="lead-phone-input" required value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+919812345678" /></div>
                  <div className="space-y-2"><Label>Email</Label>
                    <Input data-testid="lead-email-input" value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Budget (₹)</Label>
                    <Input data-testid="lead-budget-input" type="number" value={form.budget}
                      onChange={(e) => setForm({ ...form, budget: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Source</Label>
                    <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                      <SelectTrigger data-testid="lead-source-select"><SelectValue /></SelectTrigger>
                      <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select></div>
                  <div className="space-y-2"><Label>Stage</Label>
                    <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                      <SelectTrigger data-testid="lead-status-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
                      </SelectContent>
                    </Select></div>
                  <div className="space-y-2"><Label>Tag</Label>
                    <Select value={form.tag || "none"} onValueChange={(v) => setForm({ ...form, tag: v === "none" ? "" : v })}>
                      <SelectTrigger data-testid="lead-tag-select"><SelectValue placeholder="— none —" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— none —</SelectItem>
                        {TAGS.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select></div>
                  <div className="space-y-2"><Label>Property interest</Label>
                    <Input data-testid="lead-property-input" value={form.property_interest}
                      onChange={(e) => setForm({ ...form, property_interest: e.target.value })} placeholder="3BHK Apartment" /></div>
                  <div className="space-y-2"><Label>City</Label>
                    <Input data-testid="lead-city-input" value={form.city}
                      onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                  <div className="space-y-2"><Label>Custom remark</Label>
                    <Input data-testid="lead-remark-input" value={form.remark}
                      onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="e.g. hot lead - budget flexible" /></div>
                </div>
                {isManager && (
                  <div className="space-y-2"><Label>Assign to</Label>
                    <Select value={form.assigned_to || "none"}
                      onValueChange={(v) => setForm({ ...form, assigned_to: v === "none" ? "" : v })}>
                      <SelectTrigger data-testid="lead-assign-select"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.role})</SelectItem>)}
                      </SelectContent>
                    </Select></div>
                )}
                <div className="space-y-2"><Label>Notes</Label>
                  <Textarea data-testid="lead-notes-input" value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} /></div>
                <DialogFooter>
                  <Button type="submit" disabled={busy} data-testid="lead-submit-btn" className="bg-brand hover:bg-brand-dark">
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
          <Input data-testid="lead-search-input" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, phone, email, remark, city…" className="pl-9" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36" data-testid="filter-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger className="w-36" data-testid="filter-tag"><SelectValue placeholder="Tag" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tags</SelectItem>
            {TAGS.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={fu} onValueChange={setFu}>
          <SelectTrigger className="w-40" data-testid="filter-followup-status"><SelectValue placeholder="Follow-up" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All follow-ups</SelectItem>
            {FU_STATUSES.map((s) => <SelectItem key={s.v} value={s.v}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <CalendarClock className="h-4 w-4 text-slate-400" />
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="filter-date-from" className="w-36" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="filter-date-to" className="w-36" />
        </div>
        {isManager && (
          <Select value={agentFilter} onValueChange={(v) => { setAgentFilter(v); setParams({}); }}>
            <SelectTrigger className="w-48" data-testid="filter-agent"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All members</SelectItem>
              <SelectItem value="unassigned">Unassigned only</SelectItem>
              {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Bulk assign bar */}
      {isManager && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand-light p-4" data-testid="bulk-assign-bar">
          <UserPlus className="h-4 w-4 text-brand" />
          <span className="text-sm font-medium text-brand">{selected.length} selected</span>
          <Select value={assignTo} onValueChange={setAssignTo}>
            <SelectTrigger className="w-56 bg-white" data-testid="bulk-assign-select">
              <SelectValue placeholder="Choose person" />
            </SelectTrigger>
            <SelectContent>
              {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name} ({a.role})</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={doAssign} disabled={!assignTo || busy}
            data-testid="bulk-assign-confirm" className="bg-brand hover:bg-brand-dark">
            Assign leads
          </Button>
          {isAdmin && (
            <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={busy}
              data-testid="bulk-delete-confirm" className="gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> Delete selected
            </Button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                {isManager && (
                  <th className="w-10 px-4 py-3">
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} data-testid="select-all-leads" />
                  </th>
                )}
                <th className="px-4 py-3 text-left">Lead</th>
                <th className="px-3 py-3 text-left">Tag</th>
                <th className="px-3 py-3 text-left">Stage</th>
                <th className="px-3 py-3 text-left">Follow-up</th>
                <th className="px-3 py-3 text-left">Assigned</th>
                <th className="px-3 py-3 text-left">Remark</th>
                <th className="px-3 py-3 text-center">WA</th>
                <th className="px-3 py-3 text-right">Budget</th>
                <th className="px-3 py-3 text-right">Talk</th>
                {isAdmin && <th className="w-12 px-3 py-3" />}
              </tr>
            </thead>
            <tbody>
              {leads === null && (
                <tr><td colSpan={11} className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand" /></td></tr>
              )}
              {leads?.length === 0 && (
                <tr><td colSpan={11} className="p-10 text-center text-slate-400">No leads match these filters.</td></tr>
              )}
              {leads?.map((l) => {
                const tm = tagMeta(l.tag);
                return (
                  <tr key={l.id} data-testid={`lead-row-${l.id}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    {isManager && (
                      <td className="px-4 py-2.5">
                        <Checkbox checked={selected.includes(l.id)} onCheckedChange={() => toggle(l.id)}
                          data-testid={`select-lead-${l.id}`} />
                      </td>
                    )}
                    <td className="px-4 py-2.5">
                      <Link to={`/leads/${l.id}`} className="block" data-testid={`open-lead-${l.id}`}>
                        <div className="font-medium text-slate-800 hover:text-brand">{l.name}</div>
                        <div className="text-[11px] text-slate-400">{l.phone} · {l.source}</div>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <Select value={l.tag || "none"} onValueChange={(v) => setLeadTag(l, v === "none" ? "" : v)}>
                        <SelectTrigger data-testid={`row-tag-${l.id}`} className={`h-7 w-28 border-none px-2 text-[11px] font-semibold ${tm?.cls || "text-slate-400"}`}>
                          <SelectValue placeholder="— tag —" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— none —</SelectItem>
                          {TAGS.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={STATUS_META[l.status]?.cls}>{STATUS_META[l.status]?.label}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {l.follow_up_at ? (
                        <div>
                          <div className="flex items-center gap-1 font-semibold text-amber-700">
                            <AlarmClock className="h-3 w-3" />
                            {fmtDate(l.follow_up_at)}
                          </div>
                          {l.follow_up_status && (
                            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-500">
                              {FU_STATUSES.find((s) => s.v === l.follow_up_status)?.label || l.follow_up_status}
                            </div>
                          )}
                        </div>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {l.assigned_to_name ? (
                        <span className="text-slate-600">{l.assigned_to_name}</span>
                      ) : <span className="text-xs font-medium text-amber-600">Unassigned</span>}
                    </td>
                    <td className="px-3 py-2.5 max-w-[180px] truncate text-slate-600" title={l.remark || ""}>
                      {l.remark || <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-center gap-2">
                        <a href={waLink(l.phone, l.name)} target="_blank" rel="noreferrer"
                          data-testid={`wa-send-${l.id}`}
                          className="text-emerald-500 hover:text-emerald-700">
                          <MessageCircle className="h-4 w-4" />
                        </a>
                        <Checkbox checked={!!l.brochure_sent} onCheckedChange={() => toggleBrochure(l)}
                          data-testid={`brochure-tick-${l.id}`} title="Brochure sent" />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{fmtMoney(l.budget)}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-800">{fmtDuration(l.total_talk_time)}</td>
                    {isAdmin && (
                      <td className="px-3 py-2.5">
                        <button onClick={() => removeLead(l.id)} data-testid={`delete-lead-${l.id}`}
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
        </div>
      </div>

      {isAdmin && (
        <Dialog open={dupOpen} onOpenChange={setDupOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><Copy className="h-4 w-4" /> Duplicate leads</DialogTitle>
            </DialogHeader>
            {dupData === null ? (
              <div className="grid h-32 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>
            ) : dupData.groups.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">No duplicate phone numbers found. Your data is clean 🎉</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {dupData.groups.length} phone number(s) have duplicate leads · {dupData.total_duplicate_leads} extra lead(s) can be removed.
                    Only admin/superadmin can clear duplicates — this permanently deletes the extra copies.
                  </span>
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {dupData.groups.map((g) => (
                    <div key={g.phone} className="rounded-lg border border-slate-200 p-2.5 text-xs">
                      <div className="font-semibold text-slate-700">{g.phone} · {g.count} leads</div>
                      <div className="mt-1 space-y-0.5 text-slate-500">
                        {g.leads.map((ld) => (
                          <div key={ld.id}>{ld.name} — {ld.assigned_to_name || "unassigned"} · {fmtDate(ld.created_at)}</div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={dupBusy} onClick={() => clearDuplicates("oldest")}
                    data-testid="clear-duplicates-keep-oldest" className="gap-1.5 bg-brand hover:bg-brand-dark">
                    {dupBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Clear duplicates (keep oldest)
                  </Button>
                  <Button size="sm" variant="outline" disabled={dupBusy} onClick={() => clearDuplicates("newest")}
                    data-testid="clear-duplicates-keep-newest">
                    Clear duplicates (keep newest)
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
