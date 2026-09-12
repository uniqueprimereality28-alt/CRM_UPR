import { useState, useRef } from "react";
import {
  Users, FileText, Loader2, CheckCircle2, AlertCircle, PhoneCall,
  Sparkles, Cpu, Mic, RefreshCw, Upload, FileSpreadsheet, User
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

// Helper to extract contacts with both Name and Phone from text lines
function parseContacts(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const contacts = [];
  const seen = new Set();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let name = "";
    let phone = "";

    // Check if line contains a phone number (10 to 13 digits, optional + or country code)
    const phoneMatch = line.match(/(?:\+?91[\s-]?)?[6-9]\d{9}/) || line.match(/\+?\d{10,13}/);
    if (phoneMatch) {
      phone = phoneMatch[0].replace(/[\s-]/g, "");
      // Name is the rest of the line without punctuation
      const remainder = line.replace(phoneMatch[0], "").replace(/^[\t,;|\-–—:\s]+|[\t,;|\-–—:\s]+$/g, "").trim();
      if (remainder && !/^\d+$/.test(remainder)) {
        name = remainder;
      }
    } else {
      const parts = line.split(/[\t,;|]+/).map((p) => p.trim()).filter(Boolean);
      for (const p of parts) {
        const clean = p.replace(/[^0-9+]/g, "");
        if (clean.length >= 10 && clean.length <= 13) {
          phone = clean;
        } else if (!name && p.length >= 2) {
          name = p;
        }
      }
    }

    if (phone && phone.length >= 8) {
      const pKey = phone.replace(/[^0-9]/g, "").slice(-10);
      if (!seen.has(pKey)) {
        seen.add(pKey);
        contacts.push({ name: name || "", phone: phone });
      }
    }
  }
  return contacts;
}

export const BulkDialer = ({ onDispatched }) => {
  const [numbersText, setNumbersText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [modelProvider, setModelProvider] = useState("grok");
  const [voice, setVoice] = useState("sarvam-bulbul");
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [results, setResults] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const fileInputRef = useRef(null);

  const parsedContacts = parseContacts(numbersText);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result || "";
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length === 0) {
        toast.error("The selected file is empty.");
        return;
      }

      // Check for CSV header row
      const firstLineLower = lines[0].toLowerCase();
      const hasHeader =
        firstLineLower.includes("name") ||
        firstLineLower.includes("phone") ||
        firstLineLower.includes("mobile") ||
        firstLineLower.includes("contact");

      let nameCol = -1;
      let phoneCol = -1;

      if (hasHeader) {
        const headers = lines[0].split(/[\t,;|]/).map((h) => h.trim().toLowerCase());
        headers.forEach((h, idx) => {
          if (phoneCol === -1 && (h.includes("phone") || h.includes("mobile") || h.includes("contact") || h.includes("number"))) {
            phoneCol = idx;
          }
          if (nameCol === -1 && (h.includes("name") || h.includes("customer") || h.includes("client") || h.includes("lead"))) {
            nameCol = idx;
          }
        });
      }

      const dataLines = hasHeader ? lines.slice(1) : lines;
      const extracted = [];

      for (const line of dataLines) {
        const parts = line.split(/[\t,;|]/).map((p) => p.trim());
        if (parts.length === 0 || (parts.length === 1 && !parts[0])) continue;

        let name = "";
        let phone = "";

        if (nameCol !== -1 && phoneCol !== -1 && parts[phoneCol]) {
          phone = parts[phoneCol].replace(/[^0-9+]/g, "");
          name = parts[nameCol] || "";
        } else {
          const matched = parseContacts(line);
          if (matched.length > 0) {
            extracted.push(matched[0]);
            continue;
          }
        }

        if (phone.length >= 10 && phone.length <= 13) {
          extracted.push({ name: name.trim(), phone: phone.trim() });
        }
      }

      if (extracted.length > 0) {
        // Merge with existing contacts in textarea
        const existing = parseContacts(numbersText);
        const seen = new Set();
        const combined = [];

        for (const c of [...existing, ...extracted]) {
          const key = c.phone.replace(/[^0-9]/g, "").slice(-10);
          if (!seen.has(key)) {
            seen.add(key);
            combined.push(c);
          }
        }

        const formatted = combined
          .map((c) => (c.name ? `${c.name}, ${c.phone}` : c.phone))
          .join("\n");

        setNumbersText(formatted);
        toast.success(`Loaded ${extracted.length} contacts with names from ${file.name}!`);
      } else {
        toast.error("No valid contacts found in file. Ensure phone numbers have 10-13 digits.");
      }
    };

    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleBulkDispatch = async (e) => {
    e.preventDefault();
    if (parsedContacts.length === 0) {
      toast.error("Please enter at least one contact with a valid phone number");
      return;
    }

    setStatus("loading");
    setResults([]);
    setErrorMessage("");

    try {
      const payload = {
        numbers: parsedContacts.map((c) => c.phone),
        contacts: parsedContacts,
        prompt: prompt.trim() || undefined,
        model_provider: modelProvider,
        voice: voice,
      };

      const res = await api.post("/ai/calls/bulk-dispatch", payload);
      const resResults = res.data?.results || [];
      setResults(resResults);
      setStatus("success");

      const successCount = resResults.filter((r) => r.status === "dispatched").length;
      toast.success(`Successfully dispatched ${successCount} of ${resResults.length} AI calls!`);
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
            Upload CSV/Excel or paste contacts (with Name & Phone) to dispatch AI telecalls using your knowledge base and playbook.
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
            {parsedContacts.length} {parsedContacts.length === 1 ? "contact" : "contacts"} ready
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
              <Users className="h-3.5 w-3.5 text-slate-500" /> Contacts List (Name & Phone) *
            </span>
            <span className="text-[11px] font-normal text-slate-400">
              Format: <code className="text-brand font-semibold">Aarav, 9876543210</code> or just phone number
            </span>
          </Label>
          <Textarea
            required
            rows={5}
            value={numbersText}
            onChange={(e) => setNumbersText(e.target.value)}
            placeholder={"Aarav, +91 9876543210\nRohan, 9811223344\n+91 9911223344"}
            className="mt-2 font-mono text-xs leading-relaxed placeholder:font-mono"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            When a name is provided (e.g. <b>Aarav</b>), Vrinda will greet them personally: <i>"Hello Aarav ji, I'm Vrinda calling from Unique Prime Reality, Gurgaon se..."</i>
          </p>
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
            disabled={status === "loading" || parsedContacts.length === 0}
            className="w-full gap-2 bg-brand py-2.5 text-sm font-semibold hover:bg-brand-dark"
          >
            {status === "loading" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Dispatching {parsedContacts.length} Calls via LiveKit & Vobiz...
              </>
            ) : (
              <>
                <PhoneCall className="h-4 w-4" /> Launch Bulk AI Campaign ({parsedContacts.length} Contacts)
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
                  <div className="flex items-center gap-2">
                    <User className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-medium text-slate-900">{res.name || "Contact"}</span>
                    <span className="font-mono text-slate-500">({res.phoneNumber})</span>
                  </div>
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
