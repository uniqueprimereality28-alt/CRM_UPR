import { useEffect, useState } from "react";
import {
  Loader2, Save, Plus, Trash2, Bot, SlidersHorizontal, Building2,
  PhoneCall, Cpu, CheckCircle2, AlertTriangle, KeyRound, BookOpen,
  Headphones, ShieldAlert, Sparkles, Check, RotateCcw
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";

export const AISettingsPanel = () => {
  const [activeSubTab, setActiveSubTab] = useState("telephony");
  const [rules, setRules] = useState(null);
  const [bands, setBands] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [kb, setKb] = useState(null);

  const [savingRules, setSavingRules] = useState(false);
  const [savingTelephony, setSavingTelephony] = useState(false);
  const [savingKb, setSavingKb] = useState(false);
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
    api.get("/ai/scoring-rules").then((r) => { setRules(r.data.rules); setBands(r.data.temperature_bands); }).catch(() => {});
    api.get("/ai/inventory").then((r) => setInventory(r.data)).catch(() => setInventory([]));
    api.get("/ai/knowledge-base").then((r) => setKb(r.data)).catch(() => {});
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

  const saveKnowledgeBase = async () => {
    if (!kb) return;
    setSavingKb(true);
    try {
      await api.post("/ai/knowledge-base", kb);
      toast.success("AI Knowledge Base & Playbook saved!");
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    } finally {
      setSavingKb(false);
    }
  };

  const updateKb = (key, value) => {
    setKb((prev) => ({ ...prev, [key]: value }));
  };

  const saveRules = async () => {
    setSavingRules(true);
    try {
      await api.put("/ai/scoring-rules", { rules });
      toast.success("Scoring rules updated");
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    } finally {
      setSavingRules(false);
    }
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
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    } finally {
      setSavingTelephony(false);
    }
  };

  const addProject = async () => {
    if (!newProj.project.trim() || !newProj.location.trim()) return toast.error("Project & location required");
    try {
      const { data } = await api.post("/ai/inventory", newProj);
      setInventory([...(inventory || []), data]);
      setNewProj({ project: "", location: "", config: "", price_range: "", possession: "", highlights: "" });
      toast.success("Project added");
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  const delProject = async (id) => {
    try {
      await api.delete(`/ai/inventory/${id}`);
      setInventory(inventory.filter((p) => p.id !== id));
      toast.success("Project removed");
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 bg-slate-100 p-1 rounded-xl">
          <TabsTrigger value="telephony" className="gap-1.5 text-xs font-semibold">
            <PhoneCall className="h-3.5 w-3.5" /> Telephony & API Keys
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-1.5 text-xs font-semibold">
            <BookOpen className="h-3.5 w-3.5" /> Knowledge Base & Strategy
          </TabsTrigger>
          <TabsTrigger value="scoring" className="gap-1.5 text-xs font-semibold">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Lead Scoring Engine
          </TabsTrigger>
          <TabsTrigger value="inventory" className="gap-1.5 text-xs font-semibold">
            <Building2 className="h-3.5 w-3.5" /> Project Inventory
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Telephony Credentials */}
        <TabsContent value="telephony" className="mt-5 space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
                  <KeyRound className="h-3.5 w-3.5" /> Telephony Configuration
                </div>
                <h2 className="brand-font mt-1 text-xl font-bold text-slate-900">LiveKit Cloud & Vobiz SIP Trunk</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Enter your credentials here. They are stored securely in MongoDB and injected automatically without redeploying.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {telephonyStatus?.is_ready ? (
                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Active & Configured
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 gap-1">
                    <AlertTriangle className="h-3 w-3" /> Incomplete Setup
                  </Badge>
                )}
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className="text-xs font-medium text-slate-700">LiveKit Cloud WebSocket URL *</Label>
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
                  placeholder={telephonyStatus?.has_livekit_key ? "•••••••••••• (Configured)" : "API key..."}
                  value={telephony.livekit_api_key}
                  onChange={(e) => setTelephony({ ...telephony, livekit_api_key: e.target.value })}
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div>
                <Label className="text-xs font-medium text-slate-700">LiveKit API Secret</Label>
                <Input
                  type="password"
                  placeholder={telephonyStatus?.has_livekit_secret ? "•••••••••••• (Configured)" : "API secret..."}
                  value={telephony.livekit_api_secret}
                  onChange={(e) => setTelephony({ ...telephony, livekit_api_secret: e.target.value })}
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div>
                <Label className="text-xs font-medium text-slate-700">Vobiz Outbound SIP Trunk ID</Label>
                <Input
                  placeholder="ST_xxxxxxxxx"
                  value={telephony.vobiz_sip_trunk_id}
                  onChange={(e) => setTelephony({ ...telephony, vobiz_sip_trunk_id: e.target.value })}
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div>
                <Label className="text-xs font-medium text-slate-700">LiveKit Agent Worker Name</Label>
                <Input
                  placeholder="upr-calling-agent"
                  value={telephony.livekit_agent_name}
                  onChange={(e) => setTelephony({ ...telephony, livekit_agent_name: e.target.value })}
                  className="mt-1 font-mono text-xs"
                />
              </div>

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
                <Label className="text-xs font-medium text-slate-700">Deepgram STT API Key</Label>
                <Input
                  type="password"
                  placeholder={telephonyStatus?.has_deepgram_key ? "•••••••••••• (Configured)" : "Deepgram key..."}
                  value={telephony.deepgram_api_key}
                  onChange={(e) => setTelephony({ ...telephony, deepgram_api_key: e.target.value })}
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div>
                <Label className="text-xs font-medium text-slate-700">Sarvam Speaker Voice</Label>
                <Select value={telephony.sarvam_speaker} onValueChange={(v) => setTelephony({ ...telephony, sarvam_speaker: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meera">Meera (Female · Natural Hindi/Hinglish)</SelectItem>
                    <SelectItem value="bulbul">Bulbul (Female · Warm Conversational)</SelectItem>
                    <SelectItem value="amit">Amit (Male · Professional)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
              <Button onClick={saveTelephony} disabled={savingTelephony} className="gap-2 bg-brand hover:bg-brand-dark">
                {savingTelephony ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Telephony & Credentials
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* Tab 2: Full Knowledge Base & Strategy (Zero Backend Edits!) */}
        <TabsContent value="knowledge" className="mt-5 space-y-5">
          {!kb ? (
            <Skel />
          ) : (
            <div className="space-y-6">
              {/* Identity & Contact */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <Bot className="h-4 w-4 text-brand" />
                  <h3 className="text-base font-semibold text-slate-900">Identity & Company Facts</h3>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs font-medium text-slate-700">AI Agent Name *</Label>
                    <Input value={kb.agent_name || ""} onChange={(e) => updateKb("agent_name", e.target.value)} className="mt-1 text-sm" placeholder="Simran" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-700">Company Name *</Label>
                    <Input value={kb.company_name || ""} onChange={(e) => updateKb("company_name", e.target.value)} className="mt-1 text-sm" placeholder="Unique Prime Reality" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-700">Company Phone</Label>
                    <Input value={kb.company_phone || ""} onChange={(e) => updateKb("company_phone", e.target.value)} className="mt-1 text-sm" placeholder="+91 7351735035" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-700">Company Website</Label>
                    <Input value={kb.company_website || ""} onChange={(e) => updateKb("company_website", e.target.value)} className="mt-1 text-sm" placeholder="https://uniqueprimereality.com" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs font-medium text-slate-700">Company Description</Label>
                    <Textarea rows={2} value={kb.company_description || ""} onChange={(e) => updateKb("company_description", e.target.value)} className="mt-1 text-sm" placeholder="A premier real estate consultancy selling luxury homes in Gurgaon..." />
                  </div>
                </div>
              </div>

              {/* Market & Business Knowledge */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <Building2 className="h-4 w-4 text-brand" />
                  <h3 className="text-base font-semibold text-slate-900">Market & Operational Knowledge</h3>
                </div>
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs font-medium text-slate-700">Target Real Estate Market / Locations</Label>
                      <Input value={kb.market || ""} onChange={(e) => updateKb("market", e.target.value)} className="mt-1 text-sm" placeholder="Gurgaon (Golf Course Ext, Sector 79, Sohna Road)..." />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-slate-700">Office Hours</Label>
                      <Input value={kb.office_hours || ""} onChange={(e) => updateKb("office_hours", e.target.value)} className="mt-1 text-sm" placeholder="Monday–Saturday, 10:00 AM–7:00 PM IST" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-700">Office Address</Label>
                    <Input value={kb.address || ""} onChange={(e) => updateKb("address", e.target.value)} className="mt-1 text-sm" placeholder="Gurgaon, Haryana, India" />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-700">Services & Products Offered</Label>
                    <Textarea rows={2} value={kb.services || ""} onChange={(e) => updateKb("services", e.target.value)} className="mt-1 text-sm" placeholder="Residential apartment sales, luxury builder floors, investment consultation, site visit coordination..." />
                  </div>
                </div>
              </div>

              {/* Strategy & Call Playbook */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <Sparkles className="h-4 w-4 text-brand" />
                  <h3 className="text-base font-semibold text-slate-900">Call Strategy & Playbook</h3>
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <Label className="text-xs font-medium text-slate-700">Primary Call Objective *</Label>
                    <Textarea rows={2} value={kb.call_objective || ""} onChange={(e) => updateKb("call_objective", e.target.value)} className="mt-1 text-sm" placeholder="Qualify buyer requirement (BHK, budget, location, timeline) and book site visits or WhatsApp brochure follow-ups." />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-700">Qualification Goals (Information to Gather)</Label>
                    <Textarea rows={2} value={kb.qualification_goals || ""} onChange={(e) => updateKb("qualification_goals", e.target.value)} className="mt-1 text-sm" placeholder="Confirm customer name, preferred BHK, budget range in Lakhs/Crores, preferred Gurgaon sector, buying timeline." />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs font-medium text-slate-700">Special Pitch / Offer</Label>
                      <Textarea rows={2} value={kb.offer || ""} onChange={(e) => updateKb("offer", e.target.value)} className="mt-1 text-sm" placeholder="Exclusive pre-launch pricing on Sector 79 Prime Elmwood Residences, and special payment plans for Skyline Towers." />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-slate-700">Success Criteria</Label>
                      <Textarea rows={2} value={kb.success_criteria || ""} onChange={(e) => updateKb("success_criteria", e.target.value)} className="mt-1 text-sm" placeholder="Leave the customer with a confirmed site visit, WhatsApp project details, or scheduled senior consultant callback." />
                    </div>
                  </div>
                </div>
              </div>

              {/* Guardrails, Objections & Human Transfer */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <ShieldAlert className="h-4 w-4 text-brand" />
                  <h3 className="text-base font-semibold text-slate-900">Behavior, Objections & Safe Handoff</h3>
                </div>
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs font-medium text-slate-700">Opening Greeting Style</Label>
                      <Select value={kb.opening_style || "permission"} onValueChange={(v) => updateKb("opening_style", v)}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="permission">Ask Permission First ("Kya aapse 2 minute baat ho sakti hai?")</SelectItem>
                          <SelectItem value="direct">Direct Introduction ("Main new residential projects ke regarding call kar rahi hoon")</SelectItem>
                          <SelectItem value="warm">Warm Relationship Opening ("Aapse baat karke bahut khushi hui")</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-slate-700">Voice Tone</Label>
                      <Input value={kb.tone || ""} onChange={(e) => updateKb("tone", e.target.value)} className="mt-1 text-sm" placeholder="Warm, polite, respectful, and never pushy. Fluent Hinglish." />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-slate-700">Custom Opening Greeting (Overrides default if set)</Label>
                    <Input value={kb.custom_greeting || ""} onChange={(e) => updateKb("custom_greeting", e.target.value)} className="mt-1 text-sm" placeholder="Namaste! Main {agentName} bol rahi hoon, {companyName} Gurgaon se..." />
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-slate-700">Objection Handling Playbook</Label>
                    <Textarea rows={2} value={kb.objection_handling || ""} onChange={(e) => updateKb("objection_handling", e.target.value)} className="mt-1 text-sm" placeholder="Acknowledge concerns respectfully, provide confirmed facts on location/metro/pricing, and offer a WhatsApp brochure or consultant callback if unsure." />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs font-medium text-slate-700">Human Escalation & Handoff Target</Label>
                      <Input value={kb.transfer_number || ""} onChange={(e) => updateKb("transfer_number", e.target.value)} className="mt-1 text-sm" placeholder="7351735035" />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-slate-700">Senior Consultant Name</Label>
                      <Input value={kb.transfer_target_name || ""} onChange={(e) => updateKb("transfer_target_name", e.target.value)} className="mt-1 text-sm" placeholder="Vranda Aggarwal" />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-slate-700">Escalation Trigger Rules</Label>
                    <Textarea rows={2} value={kb.escalation_rules || ""} onChange={(e) => updateKb("escalation_rules", e.target.value)} className="mt-1 text-sm" placeholder="Offer immediate human transfer to Vranda Aggarwal (+91 7351735035) if customer demands human, asks for legal/bank details, or requests an on-the-spot price commitment." />
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-slate-700">Compliance & Boundaries</Label>
                    <Textarea rows={2} value={kb.compliance_notes || ""} onChange={(e) => updateKb("compliance_notes", e.target.value)} className="mt-1 text-sm" placeholder="Disclose that you are an AI assistant from Unique Prime Reality if asked directly. Never promise guaranteed investment returns." />
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button onClick={saveKnowledgeBase} disabled={savingKb} className="gap-2 bg-brand px-6 py-2.5 hover:bg-brand-dark">
                  {savingKb ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save AI Knowledge Base & Playbook
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Tab 3: Lead Scoring Engine (Preserved 100%) */}
        <TabsContent value="scoring" className="mt-5">
          <Section title="Lead scoring engine" icon={SlidersHorizontal} testId="scoring-settings" full>
            {!rules ? <Skel /> : (
              <div className="space-y-4">
                <p className="text-xs text-slate-500">
                  Points per detected signal. Temperature bands — Hot {bands?.hot}, Warm {bands?.warm}, Cold {bands?.cold}, Lost {bands?.lost}.
                </p>
                <div className="grid gap-3 sm:grid-cols-2 max-h-96 overflow-y-auto pr-1">
                  {Object.entries(rules).map(([key, r]) => (
                    <div key={key} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3" data-testid={`rule-${key}`}>
                      <span className="flex-1 text-sm text-slate-700 font-medium">{r.label}</span>
                      <Input type="number" className="w-24 text-right" value={r.points}
                        onChange={(e) => setRules({ ...rules, [key]: { ...r, points: Number(e.target.value) } })}
                        data-testid={`rule-input-${key}`} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-end pt-2">
                  <Button onClick={saveRules} disabled={savingRules} className="gap-2 bg-brand hover:bg-brand-dark" data-testid="save-rules-btn">
                    {savingRules ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Scoring Rules
                  </Button>
                </div>
              </div>
            )}
          </Section>
        </TabsContent>

        {/* Tab 4: Project Inventory (Preserved 100%) */}
        <TabsContent value="inventory" className="mt-5">
          <Section title="Project inventory (Gurgaon)" icon={Building2} testId="inventory-settings" full>
            {!inventory ? <Skel /> : (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {inventory.map((p) => (
                    <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={`project-${p.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-bold text-slate-900">{p.project}</div>
                        <button onClick={() => delProject(p.id)} className="text-slate-300 hover:text-rose-500" data-testid={`delete-project-${p.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{p.location}</div>
                      <div className="mt-1 text-xs font-semibold text-brand">{p.config} · {p.price_range}</div>
                      <div className="text-[11px] text-slate-400 mt-1">Possession: {p.possession}</div>
                      {p.highlights && <div className="text-[11px] text-slate-500 mt-1 italic">{p.highlights}</div>}
                    </div>
                  ))}
                </div>
                <div className="rounded-2xl border border-dashed border-slate-300 p-5 bg-slate-50/50">
                  <div className="mb-3 text-xs font-bold uppercase tracking-wider text-brand">Add New Project to Inventory</div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Input placeholder="Project name" value={newProj.project} onChange={(e) => setNewProj({ ...newProj, project: e.target.value })} data-testid="proj-name-input" />
                    <Input placeholder="Location" value={newProj.location} onChange={(e) => setNewProj({ ...newProj, location: e.target.value })} data-testid="proj-location-input" />
                    <Input placeholder="Config e.g. 2/3 BHK" value={newProj.config} onChange={(e) => setNewProj({ ...newProj, config: e.target.value })} />
                    <Input placeholder="Price range" value={newProj.price_range} onChange={(e) => setNewProj({ ...newProj, price_range: e.target.value })} />
                    <Input placeholder="Possession" value={newProj.possession} onChange={(e) => setNewProj({ ...newProj, possession: e.target.value })} />
                    <Input placeholder="Highlights" value={newProj.highlights} onChange={(e) => setNewProj({ ...newProj, highlights: e.target.value })} />
                  </div>
                  <Button onClick={addProject} className="mt-4 gap-2 bg-brand hover:bg-brand-dark" size="sm" data-testid="add-project-btn">
                    <Plus className="h-4 w-4" /> Add Project to Inventory
                  </Button>
                </div>
              </div>
            )}
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const Section = ({ title, icon: Icon, children, testId, full }) => (
  <div className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ${full ? "" : ""}`} data-testid={testId}>
    <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
      <Icon className="h-4 w-4 text-brand" />
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
    </div>
    <div className="mt-4">{children}</div>
  </div>
);

const Skel = () => <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>;
