import { useEffect, useState } from "react";
import {
  Loader2, Save, Plus, Trash2, Bot, SlidersHorizontal, Building2,
  PhoneCall, Cpu, CheckCircle2, AlertTriangle, KeyRound, BookOpen,
  Headphones, ShieldAlert, Sparkles, Check, RotateCcw, ArrowRight,
  PhoneForwarded, MessageSquare, HelpCircle
} from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../ui/select";
import { Badge } from "../ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";

const VRINDA_PRESET = {
  agent_name: "Vrinda",
  company_name: "Unique Prime Reality",
  market: "Gurgaon, Haryana (Dwarka Expressway, Golf Course Ext, Manesar Corridor, Sohna Road)",
  custom_greeting: "Hello {name} ji, I'm Vrinda calling from Unique Prime Reality, Gurgaon se. Kya aap Gurgaon mein koi property plan kar rahe hain?",
  gate_no_response: "Thank you for your time, have a nice day!",
  purpose_question: "Sir aapki requirement ko better understand karne ke liye kya main jaan sakti hu yeh property purchase personal use ke liye hai ya investment purpose ke liye hai?",
  budget_config_question: "Perfect, and aap kitne budget main and konsi configuration main yeh property plan kar rahe hain like studio apartment, 1 BHK, 2 BHK, 3 BHK, 4 BHK, or penthouse?",
  best_now_answer: "Hamare paas different projects available hain and every project has its own USP. Agar aap meri advice consider karein, toh best opportunistic location is Dwarka Expressway right now.",
  location_question: "Is there any specific preferred location in mind?",
  builders_options: "We have almost every reputed builder's projects like from Godrej, ATS, Whiteland / Wal Developer, Hero Homes, M3M, Elan, Emaar, and many others.",
  final_summary_template: "Maine aapki saari requirement note kar li hai — aapko {config} property chahiye {location} mein under {budget} for {purpose}.",
  ai_disclosure_answer: "Yes, I am an AI assistant working for Unique Prime reality . and please aap Nishchint rahiye main aapki sari requiremnts note kar rahi hu and i will share it with my team, so they can find you with the best property at the earliest.",
  transfer_number: "7351735035",
  transfer_target_name: "Vrinda Aggarwal",
  transfer_phrase: "{name} ji please stay on the line, while I am connecting the call.",
  transfer_enabled: true,
  tone: "Warm, polite, natural Hinglish. Always acknowledge with 'Noted' or 'Perfect' before asking the next question.",
  call_objective: "Qualify property requirements (Purpose, Budget, Configuration, Location) and book site visits or WhatsApp brochures.",
};

export const AISettingsPanel = () => {
  const [activeSubTab, setActiveSubTab] = useState("knowledge");
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
    api.get("/ai/knowledge-base").then((r) => {
      // Merge with defaults so every field is pre-populated
      setKb({ ...VRINDA_PRESET, ...(r.data || {}) });
    }).catch(() => setKb(VRINDA_PRESET));
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
      toast.success("Vrinda's AI Telecalling Script & Playbook saved!");
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    } finally {
      setSavingKb(false);
    }
  };

  const loadVrindaPreset = () => {
    setKb(VRINDA_PRESET);
    toast.success("Loaded Vrinda's exact telecalling script preset!");
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
          <TabsTrigger value="knowledge" className="gap-1.5 text-xs font-semibold">
            <BookOpen className="h-3.5 w-3.5" /> Call Script & Playbook
          </TabsTrigger>
          <TabsTrigger value="telephony" className="gap-1.5 text-xs font-semibold">
            <PhoneCall className="h-3.5 w-3.5" /> Telephony & API Keys
          </TabsTrigger>
          <TabsTrigger value="scoring" className="gap-1.5 text-xs font-semibold">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Lead Scoring Engine
          </TabsTrigger>
          <TabsTrigger value="inventory" className="gap-1.5 text-xs font-semibold">
            <Building2 className="h-3.5 w-3.5" /> Project Inventory
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Knowledge Base & Script Playbook (Completely Redesigned!) */}
        <TabsContent value="knowledge" className="mt-5 space-y-6">
          {!kb ? (
            <Skel />
          ) : (
            <div className="space-y-6">
              {/* Header Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
                    <Bot className="h-4 w-4" /> Telecalling Dialogue Builder
                  </div>
                  <h2 className="text-xl font-bold text-slate-900 mt-1">{"Vrinda's"} Outbound Calling Script & Knowledge Flow</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Controls exactly what Vrinda says on the phone, how she qualifies leads, handles questions, and escalates to humans.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={loadVrindaPreset}
                    className="gap-1.5 border-slate-200 text-slate-700 hover:bg-slate-50 text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Reset to {"Vrinda's"} Preset
                  </Button>
                  <Button
                    onClick={saveKnowledgeBase}
                    disabled={savingKb}
                    className="gap-2 bg-brand hover:bg-brand-dark text-white text-xs px-4"
                  >
                    {savingKb ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save Script & Playbook
                  </Button>
                </div>
              </div>

              {/* Visual Flow Indicator */}
              <div className="rounded-xl border border-brand/20 bg-brand/5 p-4">
                <div className="text-xs font-semibold text-brand-dark mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> Live Conversation Roadmap
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-xs">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
                    <span className="font-bold text-brand block mb-1">1. Opening Hook</span>
                    Greeting & check if planning property in Gurgaon.
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
                    <span className="font-bold text-rose-600 block mb-1">2. Exit if "No"</span>
                    Ends politely: "Thank you for your time, have a nice day!"
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
                    <span className="font-bold text-emerald-600 block mb-1">3. If "Yes": Purpose</span>
                    Personal use vs. Investment purpose.
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
                    <span className="font-bold text-sky-600 block mb-1">4. Budget & Location</span>
                    BHK config, Dwarka Exp advice, & top builder portfolio.
                  </div>
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
                    <span className="font-bold text-purple-600 block mb-1">5. Confirm & Repeat</span>
                    Repeats requirement, notes key points, & scores lead.
                  </div>
                </div>
              </div>

              {/* Step 1: Persona & Identity */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <Bot className="h-4 w-4 text-brand" />
                  <h3 className="text-base font-semibold text-slate-900">1. Agent Persona & Identity</h3>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs font-medium text-slate-700">Agent Name Spoken</Label>
                    <Input
                      value={kb.agent_name || ""}
                      onChange={(e) => updateKb("agent_name", e.target.value)}
                      className="mt-1 text-sm font-medium"
                      placeholder="Vrinda"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-700">Company Name</Label>
                    <Input
                      value={kb.company_name || ""}
                      onChange={(e) => updateKb("company_name", e.target.value)}
                      className="mt-1 text-sm font-medium"
                      placeholder="Unique Prime Reality"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-700">Target Market & Region</Label>
                    <Input
                      value={kb.market || ""}
                      onChange={(e) => updateKb("market", e.target.value)}
                      className="mt-1 text-sm"
                      placeholder="Gurgaon, Haryana"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Label className="text-xs font-medium text-slate-700 flex items-center justify-between">
                      <span>Response if Customer asks: "Are you an AI agent? / Kya aap AI ho?"</span>
                      <Badge variant="outline" className="text-[10px] text-brand border-brand/30">AI Transparency Rule</Badge>
                    </Label>
                    <Input
                      value={kb.ai_disclosure_answer || ""}
                      onChange={(e) => updateKb("ai_disclosure_answer", e.target.value)}
                      className="mt-1 text-sm bg-slate-50 font-medium text-slate-800"
                      placeholder="Yes, I am an AI assistant and I am noting your requirement..."
                    />
                  </div>
                </div>
              </div>

              {/* Step 2: Opening Hook & Drop-Off Rule */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <PhoneCall className="h-4 w-4 text-brand" />
                    <h3 className="text-base font-semibold text-slate-900">2. Opening Hook & Graceful Exit</h3>
                  </div>
                  <span className="text-xs text-slate-400">First 10 seconds of call</span>
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <Label className="text-xs font-medium text-slate-700">
                      Initial Greeting & Opening Hook (Supports <code className="text-brand font-bold">{"{name}"}</code> variable)
                    </Label>
                    <Textarea
                      rows={2}
                      value={kb.custom_greeting || ""}
                      onChange={(e) => updateKb("custom_greeting", e.target.value)}
                      className="mt-1 text-sm font-mono text-slate-800"
                      placeholder="Hello {name} ji, I'm Vrinda calling from Unique Prime Reality, Gurgaon se..."
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Spoken immediately when customer answers. If lead name is "Rahul", it automatically says "Hello Rahul ji...".
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-rose-700 flex items-center gap-1">
                      <span>If Customer replies "NO" / Not Interested (Graceful Exit):</span>
                      <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[10px]">Auto Disconnect</Badge>
                    </Label>
                    <Input
                      value={kb.gate_no_response || ""}
                      onChange={(e) => updateKb("gate_no_response", e.target.value)}
                      className="mt-1 text-sm border-rose-200 bg-rose-50/40 text-rose-900 font-medium"
                      placeholder="Thank you for your time, have a nice day!"
                    />
                  </div>
                </div>
              </div>

              {/* Step 3: Qualification Flow (If YES) */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-brand" />
                    <h3 className="text-base font-semibold text-slate-900">3. Lead Qualification Sequence (If YES)</h3>
                  </div>
                  <span className="text-xs text-slate-400">Step-by-step buyer qualification</span>
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <Label className="text-xs font-medium text-slate-700">
                      Step A: Purpose Question (Personal Use vs. Investment)
                    </Label>
                    <Textarea
                      rows={2}
                      value={kb.purpose_question || ""}
                      onChange={(e) => updateKb("purpose_question", e.target.value)}
                      className="mt-1 text-sm font-medium"
                      placeholder="Sir aapki requirement ko better understand karne ke liye kya main jaan sakti hu..."
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-700">
                      Step B: Budget & Configuration Plan Question
                    </Label>
                    <Textarea
                      rows={2}
                      value={kb.budget_config_question || ""}
                      onChange={(e) => updateKb("budget_config_question", e.target.value)}
                      className="mt-1 text-sm font-medium"
                      placeholder="Perfect, and aap kitne budget main and konsi configuration main yeh property plan kar rahe hain..."
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-700">
                      Step C: Preferred Location Question
                    </Label>
                    <Input
                      value={kb.location_question || ""}
                      onChange={(e) => updateKb("location_question", e.target.value)}
                      className="mt-1 text-sm font-medium"
                      placeholder="Is there any specific preferred location in mind?"
                    />
                  </div>
                </div>
              </div>

              {/* Step 4: Dynamic Market Advice & Builder Network */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-brand" />
                    <h3 className="text-base font-semibold text-slate-900">4. Market Advice & Builder Network</h3>
                  </div>
                  <span className="text-xs text-slate-400">Objection handling & recommendations</span>
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <Label className="text-xs font-medium text-slate-700">
                      Response when customer asks: "Best kya hai abhi?" (Consultant Advice)
                    </Label>
                    <Textarea
                      rows={2}
                      value={kb.best_now_answer || ""}
                      onChange={(e) => updateKb("best_now_answer", e.target.value)}
                      className="mt-1 text-sm font-medium"
                      placeholder="We have different projects and every project has its own USP. Agar aap meri advice consider karein, toh best opportunistic location is Dwarka Expressway right now."
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium text-slate-700">
                      Reputed Builders Portfolio (When customer asks for options or builder names)
                    </Label>
                    <Textarea
                      rows={2}
                      value={kb.builders_options || ""}
                      onChange={(e) => updateKb("builders_options", e.target.value)}
                      className="mt-1 text-sm font-medium"
                      placeholder="We have almost every reputed builder's projects like from Godrej, ATS, Whiteland / Wal Developer, Hero Homes, M3M, Elan, Emaar, and many others."
                    />
                  </div>
                </div>
              </div>

              {/* Step 5: Summary, Confirmation & Human Escalation */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <PhoneForwarded className="h-4 w-4 text-brand" />
                    <h3 className="text-base font-semibold text-slate-900">5. Closing Confirmation & Human Transfer</h3>
                  </div>
                  <span className="text-xs text-slate-400">Wrap-up & live handoff</span>
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <Label className="text-xs font-medium text-slate-700">
                      Final Requirement Confirmation Template (Repeated back before ending)
                    </Label>
                    <Input
                      value={kb.final_summary_template || ""}
                      onChange={(e) => updateKb("final_summary_template", e.target.value)}
                      className="mt-1 text-sm font-mono text-slate-800"
                      placeholder="Maine aapki saari requirement note kar li hai — aapko {config} property chahiye {location} mein under {budget} for {purpose}."
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Vrinda repeats this back, says "Noted", and tells the customer her team will share the best properties at the earliest.
                    </p>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs font-medium text-slate-700">Human Escalation Target Phone Number</Label>
                      <Input
                        value={kb.transfer_number || ""}
                        onChange={(e) => updateKb("transfer_number", e.target.value)}
                        className="mt-1 text-sm font-mono"
                        placeholder="7351735035"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-slate-700">Senior Consultant Name</Label>
                      <Input
                        value={kb.transfer_target_name || ""}
                        onChange={(e) => updateKb("transfer_target_name", e.target.value)}
                        className="mt-1 text-sm"
                        placeholder="Vrinda Aggarwal"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs font-medium text-slate-700">
                      Response when customer asks: "Transfer my call to a human / manager se baat karao"
                    </Label>
                    <Input
                      value={kb.transfer_phrase || ""}
                      onChange={(e) => updateKb("transfer_phrase", e.target.value)}
                      className="mt-1 text-sm"
                      placeholder="Sure, let me connect you directly to our senior consultant right away. Please stay on the line."
                    />
                  </div>
                </div>
              </div>

              {/* Bottom Action */}
              <div className="flex justify-end pt-2">
                <Button
                  onClick={saveKnowledgeBase}
                  disabled={savingKb}
                  className="gap-2 bg-brand px-6 py-2.5 hover:bg-brand-dark text-white"
                >
                  {savingKb ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save {"Vrinda's"} Script & Playbook
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Tab 2: Telephony Credentials */}
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
              <div>
                <Label className="text-xs font-medium text-slate-700">LiveKit WebSocket URL (Cloud)</Label>
                <Input
                  placeholder="wss://your-project.livekit.cloud"
                  value={telephony.livekit_url}
                  onChange={(e) => setTelephony({ ...telephony, livekit_url: e.target.value })}
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div>
                <Label className="text-xs font-medium text-slate-700">LiveKit Agent Name</Label>
                <Input
                  placeholder="upr-calling-agent"
                  value={telephony.livekit_agent_name}
                  onChange={(e) => setTelephony({ ...telephony, livekit_agent_name: e.target.value })}
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div>
                <Label className="text-xs font-medium text-slate-700">LiveKit API Key</Label>
                <Input
                  type="password"
                  placeholder={telephonyStatus?.has_livekit_key ? "•••••••••••• (Configured)" : "API Key..."}
                  value={telephony.livekit_api_key}
                  onChange={(e) => setTelephony({ ...telephony, livekit_api_key: e.target.value })}
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div>
                <Label className="text-xs font-medium text-slate-700">LiveKit API Secret</Label>
                <Input
                  type="password"
                  placeholder={telephonyStatus?.has_livekit_secret ? "•••••••••••• (Configured)" : "API Secret..."}
                  value={telephony.livekit_api_secret}
                  onChange={(e) => setTelephony({ ...telephony, livekit_api_secret: e.target.value })}
                  className="mt-1 font-mono text-xs"
                />
              </div>

              <div>
                <Label className="text-xs font-medium text-slate-700">Vobiz Outbound SIP Trunk ID</Label>
                <Input
                  placeholder="ST_xxxxxx from LiveKit SIP Trunk"
                  value={telephony.vobiz_sip_trunk_id}
                  onChange={(e) => setTelephony({ ...telephony, vobiz_sip_trunk_id: e.target.value })}
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
  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid={testId}>
    <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
      <Icon className="h-4 w-4 text-brand" />
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
    </div>
    <div className="mt-4">{children}</div>
  </div>
);

const Skel = () => <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>;
export default AISettingsPanel;
