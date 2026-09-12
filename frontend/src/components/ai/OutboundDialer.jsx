import { useState, useEffect } from "react";
import {
  Phone, Bot, ArrowUpRight, CheckCircle2, AlertCircle, Loader2,
  SlidersHorizontal, MessageSquare, User, Search
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

export const OutboundDialer = ({ onCallDispatched }) => {
  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [modelProvider, setModelProvider] = useState("grok");
  const [voice, setVoice] = useState("sarvam-meera");
  const [status, setStatus] = useState("idle"); // idle | dispatching | success | error
  const [statusMessage, setStatusMessage] = useState("");
  const [recentLeads, setRecentLeads] = useState([]);
  const [leadSearch, setLeadSearch] = useState("");
  const [showLeadSearch, setShowLeadSearch] = useState(false);

  useEffect(() => {
    // Load recent leads for quick picking
    api.get("/leads", { params: { limit: 25, status: "new" } })
      .then((r) => setRecentLeads(r.data.leads || r.data || []))
      .catch(() => setRecentLeads([]));
  }, []);

  const handleSelectLead = (lead) => {
    setSelectedLeadId(lead.id || lead._id);
    setPhone(lead.phone || "");
    setCustomerName(lead.name || "");
    setPrompt(
      lead.property_interest
        ? `Customer interested in ${lead.property_interest}. City: ${lead.city || 'Gurgaon'}. Budget: ${lead.budget ? '₹' + lead.budget : 'Flexible'}.`
        : lead.remark || ""
    );
    setShowLeadSearch(false);
    setStatus("idle");
    setStatusMessage("");
  };

  const handleDispatch = async (e) => {
    e.preventDefault();
    if (!phone.trim()) {
      toast.error("Please enter a valid phone number");
      return;
    }

    setStatus("dispatching");
    setStatusMessage("");

    try {
      const payload = {
        lead_id: selectedLeadId || undefined,
        phone: phone.trim(),
        lead_name: customerName.trim() || undefined,
        prompt: prompt.trim() || undefined,
        model_provider: modelProvider,
        voice: voice,
      };

      const res = await api.post("/ai/calls/real/trigger", payload);
      setStatus("success");
      setStatusMessage(`Call dispatched to ${phone}! The LiveKit agent is placing the call via Vobiz SIP.`);
      toast.success("Outbound call dispatched successfully!");
      if (onCallDispatched) onCallDispatched(res.data);
    } catch (err) {
      setStatus("error");
      const msg = err.response?.data?.detail || err.message || "Failed to dispatch call. Please check your telephony settings.";
      setStatusMessage(msg);
      toast.error(apiError(msg));
    }
  };

  const filteredLeads = recentLeads.filter((l) =>
    (l.name && l.name.toLowerCase().includes(leadSearch.toLowerCase())) ||
    (l.phone && l.phone.includes(leadSearch))
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
            <Phone className="h-3.5 w-3.5" /> Outbound AI Telecalling
          </div>
          <h2 className="brand-font mt-1 text-xl font-bold text-slate-900">Start an Outbound AI Call</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Dispatch Simran to dial the lead via Vobiz SIP with real-time Sarvam AI voice & Grok reasoning.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowLeadSearch(!showLeadSearch)}
          className="gap-1.5 text-xs"
        >
          <Search className="h-3.5 w-3.5" />
          {showLeadSearch ? "Hide Lead Picker" : "Select from CRM Leads"}
        </Button>
      </div>

      {showLeadSearch && (
        <div className="mt-4 rounded-xl border border-brand/20 bg-brand-light/30 p-4">
          <div className="text-xs font-semibold text-brand uppercase tracking-wider mb-2">
            Quick Pick from Leads
          </div>
          <Input
            placeholder="Search lead by name or phone..."
            value={leadSearch}
            onChange={(e) => setLeadSearch(e.target.value)}
            className="mb-3 bg-white text-xs"
          />
          <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
            {filteredLeads.length === 0 ? (
              <div className="text-xs text-slate-400 py-2">No matching leads found.</div>
            ) : (
              filteredLeads.slice(0, 10).map((l) => (
                <button
                  key={l.id || l._id}
                  type="button"
                  onClick={() => handleSelectLead(l)}
                  className="w-full text-left flex items-center justify-between rounded-lg p-2 text-xs hover:bg-white transition-colors border border-transparent hover:border-slate-200"
                >
                  <div>
                    <span className="font-semibold text-slate-800">{l.name}</span>
                    <span className="ml-2 font-mono text-slate-500">{l.phone}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {l.property_interest || l.status || "Lead"}
                  </Badge>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleDispatch} className="mt-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs font-medium text-slate-700">Customer Phone Number *</Label>
            <Input
              required
              type="tel"
              placeholder="+91 9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1.5 font-mono text-sm"
            />
            <span className="mt-1 block text-[11px] text-slate-400">
              Format: +919876543210 or 10-digit mobile number
            </span>
          </div>

          <div>
            <Label className="text-xs font-medium text-slate-700">Customer Name</Label>
            <Input
              type="text"
              placeholder="e.g. Rajesh Kumar"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1.5 text-sm"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs font-medium text-slate-700">
            Call Context / Specific Objective
          </Label>
          <Textarea
            rows={3}
            placeholder="e.g. Enquired about 3 BHK in Sector 79 under 1.8 Cr. Pitch Prime Elmwood Residences pre-launch discount and invite for Saturday site visit."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="mt-1.5 text-sm"
          />
          <span className="mt-1 block text-[11px] text-slate-400">
            Injected dynamically into Simran's prompt for this specific call.
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs font-medium text-slate-700">LLM Reasoning Engine</Label>
            <Select value={modelProvider} onValueChange={setModelProvider}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="grok">Grok (xAI) · Recommended for Real Estate</SelectItem>
                <SelectItem value="openai">OpenAI (GPT-4o) · High Precision</SelectItem>
                <SelectItem value="groq">Groq (Llama 3.3) · Fast Response</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs font-medium text-slate-700">Voice Synthesis (TTS)</Label>
            <Select value={voice} onValueChange={setVoice}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sarvam-meera">Sarvam AI · Meera (Natural Indian Accent)</SelectItem>
                <SelectItem value="sarvam-bulbul">Sarvam AI · Bulbul (Warm & Engaging)</SelectItem>
                <SelectItem value="sarvam-amit">Sarvam AI · Amit (Male Professional)</SelectItem>
                <SelectItem value="deepgram-aura">Deepgram · Aura (English Only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="pt-2">
          <Button
            type="submit"
            disabled={status === "dispatching"}
            className="w-full gap-2 bg-brand py-2.5 text-sm font-semibold hover:bg-brand-dark"
          >
            {status === "dispatching" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Connecting to LiveKit Cloud & Dialing via Vobiz...
              </>
            ) : (
              <>
                <Phone className="h-4 w-4" />
                Initiate AI Phone Call Now
              </>
            )}
          </Button>
        </div>

        {status === "success" && (
          <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <div>
              <div className="font-semibold">Call Dispatched Successfully</div>
              <div className="mt-0.5 text-xs text-emerald-700">{statusMessage}</div>
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div>
              <div className="font-semibold">Dispatch Failed</div>
              <div className="mt-0.5 text-xs text-rose-700">{statusMessage}</div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};
