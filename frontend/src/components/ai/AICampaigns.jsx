import { useEffect, useState } from "react";
import {
  Plus, Play, Loader2, Trash2, Users, Search, CheckCircle2, Megaphone,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "../../lib/api";
import { SCRIPT_TEMPLATES, LANG_STYLES, tempMeta, DISPO_META } from "../../lib/ai";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "../ui/dialog";

export const AICampaigns = ({ isAdmin, onChanged }) => {
  const [campaigns, setCampaigns] = useState(null);
  const [agents, setAgents] = useState([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", agent_id: "", script_template: "first_contact", language_style: "formal_hinglish", call_limit: 1000, max_retries: 2 });
  const [running, setRunning] = useState(null);
  const [assignFor, setAssignFor] = useState(null);

  const load = () => api.get("/ai/campaigns").then((r) => setCampaigns(r.data)).catch(() => setCampaigns([]));
  useEffect(() => { load(); api.get("/ai/agents").then((r) => setAgents(r.data)).catch(() => {}); }, []);

  const create = async () => {
    if (!form.name.trim()) return toast.error("Campaign name required");
    try {
      await api.post("/ai/campaigns", { ...form, agent_id: form.agent_id || null });
      toast.success("Campaign created");
      setCreating(false);
      setForm({ name: "", agent_id: "", script_template: "first_contact", language_style: "formal_hinglish", call_limit: 1000, max_retries: 2 });
      load();
    } catch (e) { toast.error(apiError(e.response?.data?.detail)); }
  };

  const runQueue = async (c) => {
    setRunning(c.id);
    try {
      const { data } = await api.post(`/ai/campaigns/${c.id}/run`, { limit: 5 });
      if (data.dialing === 0 && data.failed === 0) toast.info("No queued leads to call");
      else toast.success(`${data.dialing} real call(s) dialing now${data.failed ? ` · ${data.failed} failed to start` : ""} · ${data.remaining} left in queue`);
      load(); onChanged?.();
    } catch (e) { toast.error(apiError(e.response?.data?.detail)); }
    finally { setRunning(null); }
  };

  const remove = async (id) => {
    try { await api.delete(`/ai/campaigns/${id}`); toast.success("Campaign deleted"); load(); onChanged?.(); }
    catch (e) { toast.error(apiError(e.response?.data?.detail)); }
  };

  if (campaigns === null) return <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>;

  return (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)} className="gap-2 bg-brand hover:bg-brand-dark" data-testid="new-campaign-btn">
            <Plus className="h-4 w-4" /> New campaign
          </Button>
        </div>
      )}

      {campaigns.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <Megaphone className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-500">No AI campaigns yet. Create one, assign leads, then run the auto-dialer.</p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {campaigns.map((c) => {
          const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
          return (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" data-testid={`campaign-${c.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="brand-font text-lg font-bold text-slate-900">{c.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {SCRIPT_TEMPLATES.find((s) => s.value === c.script_template)?.label || c.script_template}
                  </div>
                </div>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{c.status}</Badge>
              </div>

              <div className="mt-4 flex items-center gap-3 text-sm">
                <span className="text-slate-500">Queue</span>
                <span className="font-semibold text-slate-800">{c.done}/{c.total}</span>
                <span className="text-slate-400">· {c.queued} pending</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
              </div>

              {isAdmin && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAssignFor(c)} data-testid={`assign-leads-${c.id}`}>
                    <Users className="h-3.5 w-3.5" /> Assign leads
                  </Button>
                  <Button size="sm" className="gap-1.5 bg-brand hover:bg-brand-dark" disabled={running === c.id || c.queued === 0}
                    onClick={() => runQueue(c)} data-testid={`run-campaign-${c.id}`}>
                    {running === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    Call next 5 (real)
                  </Button>
                  <Button size="sm" variant="ghost" className="gap-1.5 text-rose-600 hover:bg-rose-50" onClick={() => remove(c.id)} data-testid={`delete-campaign-${c.id}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create campaign */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent data-testid="create-campaign-dialog">
          <DialogHeader>
            <DialogTitle>New AI call campaign</DialogTitle>
            <DialogDescription>Configure the auto-dialing campaign for your assigned leads.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Campaign name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Gurgaon Q3 raw leads" data-testid="campaign-name-input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>AI agent</Label>
                <Select value={form.agent_id || "default"} onValueChange={(v) => setForm({ ...form, agent_id: v === "default" ? "" : v })}>
                  <SelectTrigger data-testid="campaign-agent-select"><SelectValue placeholder="Default" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default agent</SelectItem>
                    {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Script template</Label>
                <Select value={form.script_template} onValueChange={(v) => setForm({ ...form, script_template: v })}>
                  <SelectTrigger data-testid="campaign-script-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SCRIPT_TEMPLATES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Language style</Label>
                <Select value={form.language_style} onValueChange={(v) => setForm({ ...form, language_style: v })}>
                  <SelectTrigger data-testid="campaign-lang-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANG_STYLES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Daily call limit</Label>
                <Input type="number" value={form.call_limit} onChange={(e) => setForm({ ...form, call_limit: Number(e.target.value) })} data-testid="campaign-limit-input" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={create} className="bg-brand hover:bg-brand-dark" data-testid="save-campaign-btn">Create campaign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {assignFor && <AssignLeadsDialog campaign={assignFor} onClose={() => setAssignFor(null)} onDone={() => { setAssignFor(null); load(); onChanged?.(); }} />}
    </div>
  );
};

const AssignLeadsDialog = ({ campaign, onClose, onDone }) => {
  const [leads, setLeads] = useState(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get("/leads").then((r) => setLeads(r.data)).catch(() => setLeads([])); }, []);

  const filtered = (leads || []).filter((l) =>
    !q || (l.name || "").toLowerCase().includes(q.toLowerCase()) || (l.phone || "").includes(q));
  const chosen = Object.keys(sel).filter((k) => sel[k]);

  const assign = async () => {
    if (!chosen.length) return toast.error("Select at least one lead");
    setSaving(true);
    try {
      const { data } = await api.post(`/ai/campaigns/${campaign.id}/assign`, { lead_ids: chosen });
      toast.success(`${data.added} lead(s) assigned to AI queue`);
      onDone();
    } catch (e) { toast.error(apiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg" data-testid="assign-leads-dialog">
        <DialogHeader>
          <DialogTitle>Assign leads to “{campaign.name}”</DialogTitle>
          <DialogDescription>Selected leads enter the AI outbound calling queue.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone…" className="pl-9" data-testid="assign-search" />
        </div>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
          {leads === null ? (
            <div className="grid h-24 place-items-center"><Loader2 className="h-4 w-4 animate-spin text-brand" /></div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-400">No leads found.</div>
          ) : filtered.map((l) => (
            <label key={l.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50" data-testid={`assign-lead-${l.id}`}>
              <Checkbox checked={!!sel[l.id]} onCheckedChange={(v) => setSel({ ...sel, [l.id]: !!v })} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{l.name || "(no name)"}</div>
                <div className="text-xs text-slate-500">{l.phone}</div>
              </div>
              {l.assigned_agent_type === "ai" && <Badge variant="outline" className="border-brand/20 bg-brand-light text-brand text-[10px]">AI</Badge>}
            </label>
          ))}
        </div>
        <DialogFooter>
          <div className="mr-auto flex items-center gap-1.5 text-sm text-slate-500">
            <CheckCircle2 className="h-4 w-4 text-brand" /> {chosen.length} selected
          </div>
          <Button onClick={assign} disabled={saving} className="gap-2 bg-brand hover:bg-brand-dark" data-testid="confirm-assign-btn">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Assign to AI queue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
