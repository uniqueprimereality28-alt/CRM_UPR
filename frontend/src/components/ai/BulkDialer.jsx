import { useState, useRef } from "react";
import {
  Users, FileText, Loader2, CheckCircle2, AlertCircle, PhoneCall,
  Sparkles, Cpu, Mic, RefreshCw, Upload, FileSpreadsheet
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

export const BulkDialer = ({ onDispatched }) => {
  const [numbersText, setNumbersText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [modelProvider, setModelProvider] = useState("grok");
  const [voice, setVoice] = useState("sarvam-meera");
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [results, setResults] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const fileInputRef = useRef(null);

  const parsedNumbers = numbersText
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result || "";
      // Extract phone numbers (look for 10-13 digit sequences or full lines)
      const lines = text.split(/\r?\n/);
      const extracted = [];
      for (const line of lines) {
        const parts = line.split(/[\t,;]/);
        for (const part of parts) {
          const clean = part.trim().replace(/[^0-9+]/g, "");
          if (clean.length >= 10 && clean.length <= 13) {
            extracted.push(clean);
          }
        }
      }

      if (extracted.length > 0) {
        const combined = Array.from(new Set([...(parsedNumbers || []), ...extracted])).join("\n");
        setNumbersText(combined);
        toast.success(`Extracted ${extracted.length} phone numbers from ${file.name}!`);
      } else {
        toast.error("No valid phone numbers found in file. Please check columns.");
      }
    };
    reader.readAsText(file);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleBulkDispatch = async (e) => {
    e.preventDefault();
    if (parsedNumbers.length === 0) {
      toast.error("Please enter at least one valid phone number");
      return;
    }

    setStatus("loading");
    setResults([]);
    setErrorMessage("");

    try {
      const payload = {
        numbers: parsedNumbers,
        prompt: prompt.trim() || undefined,
        model_provider: modelProvider,
        voice: voice,
      };

      const res = await api.post("/ai/calls/bulk-dispatch", payload);
      const resResults = res.data?.results || [];
      setResults(resResults);
      setStatus("success");

      const successCount = resResults.filter((r) => r.status === "dispatched").length;
      toast.success(`Successfully dispatched ${successCount} of ${resResults.length} calls!`);
      if (onDispatched) onDispatched();
    } catch (err) {
      setStatus("error");
      const msg = err.response?.data?.detail || err.message || "Failed to start bulk dispatch.";
      setErrorMessage(msg);
      toast.error(apiError(msg));
    }
  };

  const clearForm = () => {
    setNumbersText("");
    setPrompt("");
    setResults([]);
    setStatus("idle");
    setErrorMessage("");
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Users className="h-5 w-5 text-brand" />
              AI Bulk Outbound Calling
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Launch autonomous AI calling campaigns with Grok intelligence and Sarvam AI voice.
            </p>
          </div>
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
            LiveKit SIP Active
          </Badge>
        </div>

        <form onSubmit={handleBulkDispatch} className="mt-6 space-y-5">
          {/* Numbers Input with File Upload */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label htmlFor="bulk-numbers" className="text-sm font-medium text-slate-700">
                Target Phone Numbers ({parsedNumbers.length} detected)
              </Label>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".csv,.txt"
                  className="hidden"
                  id="bulk-file-upload"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-7 text-xs gap-1.5 border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  <Upload className="h-3.5 w-3.5 text-brand" />
                  Upload CSV / TXT
                </Button>
                {numbersText && (
                  <button
                    type="button"
                    onClick={() => setNumbersText("")}
                    className="text-xs text-rose-600 hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <Textarea
              id="bulk-numbers"
              rows={4}
              placeholder="Paste numbers separated by newlines or commas (e.g. +919876543210, +919988776655) or upload a CSV file above..."
              value={numbersText}
              onChange={(e) => setNumbersText(e.target.value)}
              className="font-mono text-xs"
              disabled={status === "loading"}
            />
          </div>

          {/* Model and Voice Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 mb-1.5">
                <Cpu className="h-3.5 w-3.5 text-brand" />
                AI Intelligence Model
              </Label>
              <Select value={modelProvider} onValueChange={setModelProvider} disabled={status === "loading"}>
                <SelectTrigger>
                  <SelectValue placeholder="Select LLM" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="grok">xAI Grok (Fast Conversational)</SelectItem>
                  <SelectItem value="groq">Groq Llama 3.3 (Ultra-Low Latency)</SelectItem>
                  <SelectItem value="openai">OpenAI GPT-4o-mini</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 mb-1.5">
                <Mic className="h-3.5 w-3.5 text-brand" />
                Indian Voice & Accent
              </Label>
              <Select value={voice} onValueChange={setVoice} disabled={status === "loading"}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Voice" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sarvam-meera">Sarvam AI: Meera (Warm Female - Indian)</SelectItem>
                  <SelectItem value="sarvam-bulbul">Sarvam AI: Bulbul (Engaging Female - Indian)</SelectItem>
                  <SelectItem value="cartesia-saloni">Cartesia: Saloni (Professional Female)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Optional Prompt Override */}
          <div>
            <Label htmlFor="bulk-prompt" className="text-sm font-medium text-slate-700 flex items-center gap-1 mb-1.5">
              <Sparkles className="h-3.5 w-3.5 text-brand" />
              Campaign Objective / Custom Instruction (Optional)
            </Label>
            <Input
              id="bulk-prompt"
              placeholder="e.g. Inquire if they are interested in luxury 3BHK villas on Dwarka Expressway and offer site visits."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={status === "loading"}
            />
            <p className="text-xs text-slate-400 mt-1">
              Leave blank to use the standard Real Estate Sales Script configured in Knowledge Base.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              type="submit"
              disabled={status === "loading" || parsedNumbers.length === 0}
              className="bg-brand hover:bg-brand-dark text-white gap-2"
            >
              {status === "loading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Dispatching {parsedNumbers.length} Calls...
                </>
              ) : (
                <>
                  <PhoneCall className="h-4 w-4" />
                  Launch Batch Dispatch ({parsedNumbers.length} numbers)
                </>
              )}
            </Button>
            {status !== "idle" && (
              <Button type="button" variant="outline" onClick={clearForm}>
                <RefreshCw className="h-4 w-4 mr-1.5" />
                Reset Form
              </Button>
            )}
          </div>
        </form>

        {/* Status Error Display */}
        {status === "error" && (
          <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2 text-rose-700 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Results Display */}
        {results.length > 0 && (
          <div className="mt-6 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Dispatch Summary ({results.length} Leads)
            </h3>
            <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
              {results.map((res, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 text-xs bg-white hover:bg-slate-50">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-slate-700">{res.phone_number}</span>
                    {res.status === "dispatched" ? (
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                        Queued for LiveKit
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">
                        Failed
                      </Badge>
                    )}
                  </div>
                  <div className="text-slate-500 font-mono text-[11px]">
                    {res.dispatch_id ? `ID: ${res.dispatch_id.slice(0, 10)}...` : res.error || "Ready"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BulkDialer;
