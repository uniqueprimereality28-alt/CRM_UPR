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
  const [modelProvider, setModelProvider] = useState("groq");
  const [voice, setVoice] = useState("sarvam-simran");
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
      setStatusMessage(`Call dispatched to ${phone}! Sarvam Voice Agent is placing the call via Vobiz. Confirming connection…`);
      toast.success("Outbound call dispatched — confirming it connects...");
      if (onCallDispatched) onCallDispatched(res.data);
      // A 200 here only means LiveKit queued the job for a worker — it does
      // NOT mean the voice-agent actually picked it up or that the phone is
      // ringing. Poll the lead for a short while so a silent failure (worker
      // never joined, SIP dial rejected, etc.) is actually shown instead of
      // this success message being the last thing the user ever sees.
      pollCallOutcome(res.data.lead_id);
    } catch (err) {
      setStatus("error");
      const msg = err.response?.data?.detail || err.message || "Failed to dispatch call. Please check your telephony settings.";
      setStatusMessage(msg);
      toast.error(apiError(msg));
    }
  };

  const pollCallOutcome = (leadId) => {
    if (!leadId) return;
    let attempts = 0;
    const maxAttempts = 6; // ~30s at 5s apart — covers the 20s backend worker-pickup check
    const interval = setInterval(async () => {
      attempts += 1;
      try {
        const { data } = await api.get(`/leads/${leadId}`);
        const lead = data?.lead || data; // GET /leads/{id} returns {lead, activities, calls}
        if (lead?.ai_call_status === "failed") {
          clearInterval(interval);
          setStatus("error");
          setStatusMessage(
            lead.ai_call_error ||
              "The call did not connect. Check your Sarvam Voice Agent settings (API Key, Org ID, Agent ID)."
          );
          toast.error("The outbound call failed to connect");
          return;
        }
        if (lead?.ai_call_status === "called") {
          clearInterval(interval);
          setStatus("success");
          setStatusMessage(`Call to ${phone} completed. Check Calls for the transcript and outcome.`);
          return;
        }
      } catch {
        // ignore transient polling errors
      }
      if (attempts >= maxAttempts) clearInterval(interval);
    }, 5000);
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
            Dispatch Vrinda (Simran voice) to call leads via Sarvam Voice Agents & Vobiz telephony.
          </p>
        </div>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
          <span className="mr-1.5 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Live Telephony Ready
        </Badge>
      </div>

      <form onSubmit={handleDispatch} className="mt-5 space-y-4">
        {/* Lead Picker or Quick Fill */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Select Existing CRM Lead (Optional)</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-brand hover:text-brand-dark"
              onClick={() => setShowLeadSearch(!showLeadSearch)}
            >
              <Search className="mr-1 h-3 w-3" /> {showLeadSearch ? "Close search" : "Browse leads"}
            </Button>
          </div>

          {showLeadSearch && (
            <div className="mt-3 space-y-2">
              <Input
                placeholder="Search CRM leads by name or phone..."
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
                className="h-8 text-xs bg-white"
              />
              <div className="max-h-36 overflow-y-auto space-y-1 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white p-1">
                {filteredLeads.length === 0 ? (
                  <div className="p-2 text-center text-xs text-slate-400">No matching leads found.</div>
                ) : (
                  filteredLeads.map((l) => (
                    <button
                      key={l.id || l._id}
                      type="button"
                      onClick={() => handleSelectLead(l)}
                      className="flex w-full items-center justify-between p-2 text-left text-xs hover:bg-brand-light/40 rounded transition"
                    >
                      <span className="font-medium text-slate-800">{l.name}</span>
                      <span className="text-slate-500">{l.phone}</span>
                      {l.tag && <Badge variant="outline" className="text-[10px] uppercase">{l.tag}</Badge>}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs font-medium text-slate-700">Phone number (with country code)</Label>
            <Input
              type="tel"
              placeholder="+91 98765 43210"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setStatus("idle"); setStatusMessage(""); }}
              required
              className="mt-1 font-mono text-sm"
            />
            <span className="mt-1 block text-[11px] text-slate-400">e.g. +919876543210 or 10-digit mobile</span>
          </div>

          <div>
            <Label className="text-xs font-medium text-slate-700">Customer name</Label>
            <Input
              placeholder="e.g. Rahul Sharma"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="mt-1 text-sm"
            />
            <span className="mt-1 block text-[11px] text-slate-400">Used by Simran in the opening greeting</span>
          </div>
        </div>

        <div>
          <Label className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-slate-400" /> Call objective / Special context
          </Label>
          <Textarea
            placeholder="e.g. Following up on Sector 79 3 BHK enquiry. Emphasize ready-to-move discount and metro connectivity."
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="mt-1 text-xs"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs font-medium text-slate-700">LLM Reasoning Brain</Label>
            <Select value={modelProvider} onValueChange={setModelProvider}>
              <SelectTrigger className="mt-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="groq">Groq · Llama 3.3 70B (Ultra-Fast &lt;200ms)</SelectItem>
                <SelectItem value="openai">OpenAI · GPT-4o mini</SelectItem>
                <SelectItem value="grok">Grok (xAI) · Grok 2</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs font-medium text-slate-700">TTS Voice (Sarvam AI / Deepgram)</Label>
            <Select value={voice} onValueChange={setVoice}>
              <SelectTrigger className="mt-1 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sarvam-simran">Sarvam AI · Simran (Indian Female - Natural Telecaller)</SelectItem>
                <SelectItem value="sarvam-priya">Sarvam AI · Priya (Indian Female - Warm & Engaging)</SelectItem>
                <SelectItem value="sarvam-kavya">Sarvam AI · Kavya (Indian Female - Expressive)</SelectItem>
                <SelectItem value="sarvam-aditya">Sarvam AI · Aditya (Indian Male - Professional)</SelectItem>
                <SelectItem value="sarvam-amit">Sarvam AI · Amit (Indian Male - Confident)</SelectItem>
                <SelectItem value="aura-2-thalia-en">Deepgram Aura · Thalia (English)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          type="submit"
          disabled={status === "dispatching" || !phone.trim()}
          className="w-full gap-2 bg-brand hover:bg-brand-dark py-2.5 font-semibold text-white shadow-sm"
        >
          {status === "dispatching" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Dispatching via Sarvam...
            </>
          ) : (
            <>
              Initiate Outbound Call <ArrowUpRight className="h-4 w-4" />
            </>
          )}
        </Button>

        {statusMessage && (
          <div
            className={`flex items-start gap-2.5 rounded-xl border p-3.5 text-xs ${
              status === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            {status === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            )}
            <span className="leading-relaxed">{statusMessage}</span>
          </div>
        )}
      </form>
    </div>
  );
};
