import { useEffect, useState } from "react";
import { Loader2, Save, Plus, Trash2, Bot, SlidersHorizontal, Building2 } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "../../lib/api";
import { LANG_STYLES } from "../../lib/ai";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../ui/select";

export const AISettingsPanel = () => {
  const [agent, setAgent] = useState(null);
  const [rules, setRules] = useState(null);
  const [bands, setBands] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [savingAgent, setSavingAgent] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [newProj, setNewProj] = useState({ project: "", location: "", config: "", price_range: "", possession: "", highlights: "" });

  useEffect(() => {
    api.get("/ai/agents").then((r) => setAgent(r.data[0] || null)).catch(() => {});
    api.get("/ai/scoring-rules").then((r) => { setRules(r.data.rules); setBands(r.data.temperature_bands); }).catch(() => {});
    api.get("/ai/inventory").then((r) => setInventory(r.data)).catch(() => setInventory([]));
  }, []);

  const saveAgent = async () => {
    setSavingAgent(true);
    try {
      const payload = { name: agent.name, voice_gender: agent.voice_gender, voice_accent: agent.voice_accent, language_style: agent.language_style, personality: agent.personality, intro_line: agent.intro_line, guardrails: agent.guardrails, active: true };
      const { data } = agent.id ? await api.put(`/ai/agents/${agent.id}`, payload) : await api.post("/ai/agents", payload);
      setAgent(data);
      toast.success("Agent persona saved");
    } catch (e) { toast.error(apiError(e.response?.data?.detail)); }
    finally { setSavingAgent(false); }
  };

  const saveRules = async () => {
    setSavingRules(true);
    try { await api.put("/ai/scoring-rules", { rules }); toast.success("Scoring rules updated"); }
    catch (e) { toast.error(apiError(e.response?.data?.detail)); }
    finally { setSavingRules(false); }
  };

  const addProject = async () => {
    if (!newProj.project.trim() || !newProj.location.trim()) return toast.error("Project & location required");
    try {
      const { data } = await api.post("/ai/inventory", newProj);
      setInventory([...(inventory || []), data]);
      setNewProj({ project: "", location: "", config: "", price_range: "", possession: "", highlights: "" });
      toast.success("Project added to inventory");
    } catch (e) { toast.error(apiError(e.response?.data?.detail)); }
  };

  const delProject = async (id) => {
    try { await api.delete(`/ai/inventory/${id}`); setInventory(inventory.filter((p) => p.id !== id)); toast.success("Removed"); }
    catch (e) { toast.error(apiError(e.response?.data?.detail)); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {/* Agent persona */}
      <Section title="Agent voice & personality" icon={Bot} testId="agent-settings">
        {!agent ? <Skel /> : (
          <div className="space-y-3">
            <Field label="Agent name"><Input value={agent.name || ""} onChange={(e) => setAgent({ ...agent, name: e.target.value })} data-testid="agent-name-input" /></Field>
            <Field label="Voice / accent"><Input value={agent.voice_accent || ""} onChange={(e) => setAgent({ ...agent, voice_accent: e.target.value })} data-testid="agent-voice-input" /></Field>
            <Field label="Language style">
              <Select value={agent.language_style} onValueChange={(v) => setAgent({ ...agent, language_style: v })}>
                <SelectTrigger data-testid="agent-lang-select"><SelectValue /></SelectTrigger>
                <SelectContent>{LANG_STYLES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Personality"><Textarea rows={2} value={agent.personality || ""} onChange={(e) => setAgent({ ...agent, personality: e.target.value })} data-testid="agent-personality-input" /></Field>
            <Field label="Intro line"><Textarea rows={2} value={agent.intro_line || ""} onChange={(e) => setAgent({ ...agent, intro_line: e.target.value })} data-testid="agent-intro-input" /></Field>
            <Field label="Guardrails / safe responses"><Textarea rows={3} value={agent.guardrails || ""} onChange={(e) => setAgent({ ...agent, guardrails: e.target.value })} data-testid="agent-guardrails-input" /></Field>
            <Button onClick={saveAgent} disabled={savingAgent} className="gap-2 bg-brand hover:bg-brand-dark" data-testid="save-agent-btn">
              {savingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save persona
            </Button>
          </div>
        )}
      </Section>

      {/* Scoring engine */}
      <Section title="Lead scoring engine" icon={SlidersHorizontal} testId="scoring-settings">
        {!rules ? <Skel /> : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Points per detected signal. Temperature bands — Hot {bands?.hot}, Warm {bands?.warm}, Cold {bands?.cold}, Lost {bands?.lost}.
            </p>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {Object.entries(rules).map(([key, r]) => (
                <div key={key} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5" data-testid={`rule-${key}`}>
                  <span className="flex-1 text-sm text-slate-700">{r.label}</span>
                  <Input type="number" className="w-20 text-right" value={r.points}
                    onChange={(e) => setRules({ ...rules, [key]: { ...r, points: Number(e.target.value) } })}
                    data-testid={`rule-input-${key}`} />
                </div>
              ))}
            </div>
            <Button onClick={saveRules} disabled={savingRules} className="gap-2 bg-brand hover:bg-brand-dark" data-testid="save-rules-btn">
              {savingRules ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save scoring rules
            </Button>
          </div>
        )}
      </Section>

      {/* Inventory */}
      <Section title="Project inventory" icon={Building2} testId="inventory-settings" full>
        {!inventory ? <Skel /> : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {inventory.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`project-${p.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-slate-800">{p.project}</div>
                    <button onClick={() => delProject(p.id)} className="text-slate-300 hover:text-rose-500" data-testid={`delete-project-${p.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{p.location}</div>
                  <div className="mt-1 text-xs text-slate-600">{p.config} · {p.price_range}</div>
                  <div className="text-[11px] text-slate-400">Possession {p.possession}</div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-dashed border-slate-300 p-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Add project</div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Input placeholder="Project name" value={newProj.project} onChange={(e) => setNewProj({ ...newProj, project: e.target.value })} data-testid="proj-name-input" />
                <Input placeholder="Location" value={newProj.location} onChange={(e) => setNewProj({ ...newProj, location: e.target.value })} data-testid="proj-location-input" />
                <Input placeholder="Config e.g. 2/3 BHK" value={newProj.config} onChange={(e) => setNewProj({ ...newProj, config: e.target.value })} />
                <Input placeholder="Price range" value={newProj.price_range} onChange={(e) => setNewProj({ ...newProj, price_range: e.target.value })} />
                <Input placeholder="Possession" value={newProj.possession} onChange={(e) => setNewProj({ ...newProj, possession: e.target.value })} />
                <Input placeholder="Highlights" value={newProj.highlights} onChange={(e) => setNewProj({ ...newProj, highlights: e.target.value })} />
              </div>
              <Button onClick={addProject} className="mt-3 gap-2 bg-brand hover:bg-brand-dark" size="sm" data-testid="add-project-btn">
                <Plus className="h-4 w-4" /> Add project
              </Button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
};

const Section = ({ title, icon: Icon, children, testId, full }) => (
  <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${full ? "lg:col-span-2" : ""}`} data-testid={testId}>
    <div className="mb-4 flex items-center gap-2">
      <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-light text-brand"><Icon className="h-4 w-4" /></div>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
    </div>
    {children}
  </div>
);

const Field = ({ label, children }) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</Label>
    {children}
  </div>
);

const Skel = () => <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>;
