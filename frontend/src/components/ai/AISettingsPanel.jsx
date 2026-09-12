import { useEffect, useState } from "react";
import {
  Loader2, Save, Plus, Trash2, Bot, SlidersHorizontal, Building2,
  PhoneCall, Cpu, CheckCircle2, AlertTriangle, KeyRound
} from "lucide-react";
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
import { Badge } from "../ui/badge";

export const AISettingsPanel = () => {
  const [agent, setAgent] = useState(null);
  const [rules, setRules] = useState(null);
  const [bands, setBands] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [savingAgent, setSavingAgent] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [savingTelephony, setSavingTelephony] = useState(false);
  const [newProj, setNewProj] = useState({ project: "", location: "", config: "", price_range: "", possession: "", highlights: "" });

  const [telephony, setTelephony] = useState({
    livekit_url: "",
    livekit_api_key: "",
    livekit_api_secret: "",
    livekit_agent_name: "upr-calling-agent",
    vobiz_sip_trunk_id: "",
    grok_api_key: "",
    sarvam_api_key: "",
    deepgram_api_key: "",
    sarvam_speaker: "meera",
    sarvam_language: "hi-IN",
  });
  const [telephonyStatus, setTelephonyStatus] = useState(null);

  useEffect(() => {
    api.get("/ai/agents").then((r) => setAgent(r.data[0] || null)).catch(() => {});
    api.get("/ai/scoring-rules").then((r) => { setRules(r.data.rules); setBands(r.data.temperature_bands); }).catch(() => {});
    api.get("/ai/inventory").then((r) => setInventory(r.data)).catch(() => setInventory([]));
    api.get("/ai/calls/real/settings").then((r) => {
      setTelephonyStatus(r.data);
      setTelephony((prev) => ({
        ...prev,
        livekit_url: r.data.livekit_url || "",
        livekit_agent_name: r.data.livekit_agent_name || "upr-calling-agent",
        vobiz_sip_trunk_id: r.data.vobiz_sip_trunk_id || "",
        sarvam_speaker: r.data.sarvam_speaker || "meera",
        sarvam_language: r.data.sarvam_language || "hi-IN",
      }));
    }).catch(() => {});
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

  const saveTelephony = async () => {
    setSavingTelephony(true);
    try {
      await api.post("/ai/calls/real/settings", telephony);
      toast.success("Telephony & AI keys saved!");
      const res = await api.get("/ai/calls/real/settings");
      setTelephonyStatus(res.data);
      setTelephony((prev) => ({
        ...prev,
        livekit_api_key: "",
        livekit_api_secret: "",
        grok_api_key: "",
        sarvam_api_key: "",
        deepgram_api_key: "",
      }));
    } catch (e) { toast.error(apiError(e.response?.data?.detail)); }
    finally { setSavingTelephony(false); }
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
    <div className="space-y-6">
      {/* Telephony & AI Providers */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-brand" />
            <div>
              <h3 className="text-base font-bold text-slate-900">LiveKit Cloud & Vobiz SIP Telephony</h3>
              <p className="text-xs text-slate-500">Connects your Vobiz SIP trunk via LiveKit Cloud for real-time outbound dialing.</p>
            </div>
          </div>
          {telephonyStatus?.livekit_url ? (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 gap-1 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5" /> Configured
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700 gap-1 text-xs">
              <AlertTriangle className="h-3.5 w-3.5" /> Setup Required
            </Badge>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label className="text-xs font-medium text-slate-700">LiveKit Cloud WebSocket URL</Label>
            <Input
              placeholder="wss://your-project.livekit.cloud"
              value={telephony.livekit_url}
              onChange={(e) => setTelephony({ ...telephony, livekit_url: e.target.value })}
              className="mt-1 font-mono text-xs"
            />
          </div>

          <div>
            <Label className="text-xs font-medium text-slate-700">LiveKit API Key</Label>
            <Input
              type="password"
              placeholder={telephonyStatus?.has_livekit_key ? "•••••••••••• (Configured)" : "API..."}
              value={telephony.livekit_api_key}
              onChange={(e) => setTelephony({ ...telephony, livekit_api_key: e.target.value })}
              className="mt-1 font-mono text-xs"
            />
          </div>

          <div>
            <Label className="text-xs font-medium text-slate-700">LiveKit API Secret</Label>
            <Input
              type="password"
              placeholder={telephonyStatus?.has_livekit_secret ? "•••••••••••• (Configured)" : "Secret..."}
              value={telephony.livekit_api_secret}
              onChange={(e) => setTelephony({ ...telephony, livekit_api_secret: e.target.value })}
              className="mt-1 font-mono text-xs"
            />
          </div>

          <div>
            <Label className="text-xs font-medium text-slate-700">Vobiz Outbound SIP Trunk ID</Label>
            <Input
              placeholder="ST_xxxxxxxxxxxx"
              value={telephony.vobiz_sip_trunk_id}
              onChange={(e) => setTelephony({ ...telephony, vobiz_sip_trunk_id: e.target.value })}
              className="mt-1 font-mono text-xs"
            />
            <span className="mt-0.5 block text-[10px] text-slate-400">Created in LiveKit Cloud pointing to your Vobiz SIP credentials</span>
          </div>

          <div>
            <Label className="text-xs font-medium text-slate-700">Registered Agent Worker Name</Label>
            <Input
              value={telephony.livekit_agent_name}
              onChange={(e) => setTelephony({ ...telephony, livekit_agent_name: e.target.value })}
              className="mt-1 text-xs"
            />
          </div>
        </div>

        {/* AI Model Keys */}
        <div className="mt-6 border-t border-slate-100 pt-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5 mb-3">
            <Cpu className="h-3.5 w-3.5" /> AI Providers (Grok, Sarvam AI, Deepgram)
          </h4>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label className="text-xs font-medium text-slate-700">Grok (xAI) API Key</Label>
              <Input
                type="password"
                placeholder={telephonyStatus?.has_grok_key ? "•••••••••••• (Configured)" : "xai-..."}
                value={telephony.grok_api_key}
                onChange={(e) => setTelephony({ ...telephony, grok_api_key: e.target.value })}
                className="mt-1 font-mono text-xs"
              />
            </div>

            <div>
              <Label className="text-xs font-medium text-slate-700">Sarvam AI API Subscription Key</Label>
              <Input
                type="password"
                placeholder={telephonyStatus?.has_sarvam_key ? "•••••••••••• (Configured)" : "Sarvam key..."}
                value={telephony.sarvam_api_key}
                onChange={(e) => setTelephony({ ...telephony, sarvam_api_key: e.target.value })}
                className="mt-1 font-mono text-xs"
              />
            </div>

            <div>
              <Label className="text-xs font-medium text-slate-700">Deepgram STT Key</Label>
              <Input
                type="password"
                placeholder={telephonyStatus?.has_deepgram_key ? "•••••••••••• (Configured)" : "Deepgram key..."}
                value={telephony.deepgram_api_key}
                onChange={(e) => setTelephony({ ...telephony, deepgram_api_key: e.target.value })}
                className="mt-1 font-mono text-xs"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button onClick={saveTelephony} disabled={savingTelephony} className="gap-2 bg-brand hover:bg-brand-dark" size="sm">
              {savingTelephony ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Telephony & Keys
            </Button>
          </div>
        </div>
      </div>

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
        <Section title="Project inventory (Gurgaon)" icon={Building2} testId="inventory-settings" full>
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
    </div>
  );
};

const Section = ({ title, icon: Icon, children, testId, full }) => (
  <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${full ? "lg:col-span-2" : ""}`} data-testid={testId}>
    <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
      <Icon className="h-4 w-4 text-brand" />
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
    </div>
    <div className="mt-4">{children}</div>
  </div>
);

const Field = ({ label, children }) => (
  <div>
    <Label className="text-xs font-medium text-slate-600">{label}</Label>
    <div className="mt-1">{children}</div>
  </div>
);

const Skel = () => <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>;
