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
    setStatus("idle");
    setResults([]);
    setErrorMessage("");
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
            <Users className="h-3.5 w-3.5" /> Campaign Bulk Calling
          </div>
          <h2 className="brand-font mt-1 text-xl font-bold text-slate-900">Reach Multiple Contacts</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Upload CSV/Excel or paste contacts to dispatch AI telecalls using your knowledge base and playbook.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".csv,.txt,.tsv"
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5 text-xs text-brand border-brand/30 hover:bg-brand-light"
          >
            <Upload className="h-3.5 w-3.5" /> Upload CSV / TXT
          </Button>
          <Badge variant="outline" className="bg-slate-50 text-slate-700">
            {parsedNumbers.length} {parsedNumbers.length === 1 ? "number" : "numbers"} ready
          </Badge>
          {results.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearForm} className="gap-1 text-xs text-slate-500">
              <RefreshCw className="h-3 w-3" /> Reset
            </Button>
          )}
        </div>
      </div>

      <form onSubmit={handleBulkDispatch} className="mt-6 space-y-5">
        <div>
          <Label className="flex items-center justify-between text-xs font-medium text-slate-700">
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-slate-500" /> Phone Numbers List *
            </span>
            <span className="text-[11px] font-normal text-slate-400">
              One number per line, comma separated, or upload CSV above
            </span>
          </Label>
          <Textarea
            required
            rows={5}
            value={numbersText}
            onChange={(e) => setNumbersText(e.target.value)}
            placeholder={"+91 9876543210\n+91 7351735035\n+91 9911223344"}
            className="mt-2 font-mono text-xs leading-relaxed placeholder:font-mono"
          />
        </div>

        <div>
          <Label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
            <FileText className="h-3.5 w-3.5 text-slate-500" /> Campaign Context / Custom Script
            <span className="text-[11px] font-normal text-slate-400">(Optional)</span>
          </Label>
          <Input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Follow up on Sector 79 project interest, offer pre-launch discount and site visit"
            className="mt-1.5 text-sm"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <Cpu className="h-3.5 w-3.5 text-slate-500" /> AI LLM Engine
            </Label>
            <Select value={modelProvider} onValueChange={setModelProvider}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grok">Grok (xAI) · Ultra-Fast Reasoning</SelectItem>
                <SelectItem value="openai">OpenAI · GPT-4o Realtime</SelectItem>
                <SelectItem value="groq">Groq · Llama 3.3 (High Speed)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <Mic className="h-3.5 w-3.5 text-slate-500" /> Voice Synthesis (TTS)
            </Label>
            <Select value={voice} onValueChange={setVoice}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sarvam-meera">Sarvam AI · Meera (Hindi/Hinglish Natural)</SelectItem>
                <SelectItem value="sarvam-bulbul">Sarvam AI · Bulbul (Conversational)</SelectItem>
                <SelectItem value="sarvam-amit">Sarvam AI · Amit (Male Professional)</SelectItem>
                <SelectItem value="deepgram-aura">Deepgram · Aura (English)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="pt-2">
          <Button
            type="submit"
            disabled={status === "loading" || parsedNumbers.length === 0}
            className="w-full gap-2 bg-brand py-2.5 text-sm font-semibold hover:bg-brand-dark"
          >
            {status === "loading" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Dispatching {parsedNumbers.length} Calls via LiveKit & Vobiz...
              </>
            ) : (
              <>
                <PhoneCall className="h-4 w-4" /> Launch Bulk AI Campaign ({parsedNumbers.length} Numbers)
              </>
            )}
          </Button>
        </div>

        {status === "error" && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <div>
              <div className="font-semibold">Campaign Dispatch Failed</div>
              <div className="mt-0.5 text-xs text-rose-700">{errorMessage}</div>
            </div>
          </div>
        )}

        {status === "success" && results.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span>{results.filter((r) => r.status === "dispatched").length} of {results.length} calls successfully queued</span>
              </div>
            </div>
            <div className="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
              {results.map((res, i) => (
                <div
                  key={`${res.phoneNumber}-${i}`}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <span className="font-mono text-slate-800">{res.phoneNumber}</span>
                  <div className="flex items-center gap-2">
                    {res.status === "dispatched" ? (
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                        Dispatched
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px]">
                        {res.error ? `Failed: ${res.error}` : "Failed"}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  );
};
