import { useState, useRef } from "react";
import {
  Volume2, Play, Square, Loader2, Headphones, Sparkles, AlertCircle, RefreshCw
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "../ui/select";
import { api, apiError } from "../../lib/api";
import { toast } from "sonner";

export function LiveTest() {
  const [customerName, setCustomerName] = useState("Aarav");
  const [speaker, setSpeaker] = useState("bulbul");
  const [activeSegment, setActiveSegment] = useState("budget");
  const [customText, setCustomText] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);

  // Pre-configured script templates
  const scriptTemplates = {
    greeting: `Hello ${customerName || "Aarav"} ji, I'm Vrinda calling from Unique Prime Reality, Gurgaon se. Kya aap Gurgaon mein koi property plan kar rahe hain?`,
    purpose: `Sir aapki requirement ko better understand karne ke liye kya main jaan sakti hu yeh property purchase personal use ke liye hai ya investment purpose ke liye hai?`,
    budget: `Perfect, and aap kitne budget main and konsi configuration main yeh property plan kar rahe hain like studio apartment, one BHK, two BHK, three BHK, four BHK, or penthouse?`,
    market: `We have different projects and every project has its own USP. Agar aap meri advice consider karein, toh best opportunistic location is Dwarka Expressway right now jo IGI airport se sirf 15 minutes par hai.`,
    builders: `We have almost every reputed builder's projects like from Godrej, ATS, Whiteland, Hero Homes, M3M, Elan, Emaar, and many others.`,
    wrapup: `${customerName || "Aarav"} ji maine aapki saari requirement note kar li — aapko 3 BHK property chahiye Dwarka Expressway mein under 2 Cr for personal use. Main ye saari details hamari senior team ke sath share kar rahi hoon and they will get in touch with you shortly. Thank you so much for your time, have a nice day!`,
    ai_disclosure: `Yes, I am an AI assistant working for Unique Prime reality . and please aap Nishchint rahiye main aapki sari requiremnts note kar rahi hu and i will share it with my team, so they can find you with the best property at the earliest.`,
  };

  const currentScript = customText || scriptTemplates[activeSegment] || scriptTemplates.budget;

  const handlePlayVoice = async (textOverride) => {
    const textToSpeak = (textOverride || currentScript).trim();
    if (!textToSpeak) {
      toast.error("Please enter text to test speech synthesis.");
      return;
    }

    if (playing && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
      return;
    }

    setLoading(true);
    try {
      const res = await api.post(
        "/ai/tts/test",
        {
          text: textToSpeak,
          speaker: speaker,
          language_code: "hi-IN",
        },
        { responseType: "blob" }
      );

      if (!res.data || res.data.size < 50) {
        throw new Error("Empty audio response received.");
      }

      const url = URL.createObjectURL(res.data);
      setAudioUrl(url);

      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onplay = () => setPlaying(true);
      audio.onended = () => {
        setPlaying(false);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setPlaying(false);
        toast.error("Audio playback error occurred.");
      };

      await audio.play();
    } catch (err) {
      let msg = apiError(err);
      if (err.response && err.response.data instanceof Blob) {
        try {
          const errText = await err.response.data.text();
          const parsed = JSON.parse(errText);
          if (parsed.detail) msg = parsed.detail;
        } catch {}
      }

      if (msg && (msg.includes("Sarvam") || msg.includes("API Key") || msg.includes("not configured"))) {
        toast.error(msg, { duration: 6000 });
      } else {
        // Fallback: Browser Web Speech API with explicit Indian Female voice selection
        try {
          if ("speechSynthesis" in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(textToSpeak);
            utterance.rate = 0.92;
            utterance.pitch = 1.18; // Distinctly female pitch

            const voices = window.speechSynthesis.getVoices() || [];
            const femaleVoice = voices.find(
              (v) =>
                v.name.includes("Female") ||
                v.name.includes("Zira") ||
                v.name.includes("Kalpana") ||
                v.name.includes("Heera") ||
                v.name.includes("India") ||
                v.lang.startsWith("hi") ||
                v.lang === "en-IN"
            );
            if (femaleVoice) utterance.voice = femaleVoice;

            utterance.onstart = () => setPlaying(true);
            utterance.onend = () => setPlaying(false);
            utterance.onerror = () => setPlaying(false);
            window.speechSynthesis.speak(utterance);
            toast.info("Browser voice fallback (Enter Sarvam API Key in Settings to hear Bulbul).");
          } else {
            toast.error(msg || "Could not synthesize audio.");
          }
        } catch {
          toast.error(msg || "Could not synthesize audio.");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="live-test-studio">
      {/* Header Banner */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-50 via-white to-amber-50/30 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
              <Headphones className="h-4 w-4" /> Speech & Pronunciation Studio
            </div>
            <h2 className="brand-font mt-1 text-2xl font-bold text-slate-900">Voice & Speech Quality Tester</h2>
            <p className="mt-1 text-xs text-slate-600 max-w-2xl">
              Verify how Vrinda speaks, test Indian accents, check project inventory pitches, and tune pronunciation before dispatching live calls to customers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-white text-slate-700 border-slate-300">
              Voice: Sarvam AI ({speaker === "bulbul" ? "Bulbul Conversational" : speaker === "meera" ? "Meera Warm" : "Amit Male"})
            </Badge>
            <Badge className="bg-brand/10 text-brand border-brand/20">
              Active Audio Channel
            </Badge>
          </div>
        </div>
      </div>

      {/* Main Pronunciation Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-6 max-w-4xl mx-auto">
        <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
              <Volume2 className="h-3.5 w-3.5" /> Speech & Pronunciation Tester
            </div>
            <h3 className="brand-font text-lg font-bold text-slate-900 mt-1">Hear Vrinda Speak Any Script</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Select any conversation moment to verify pronunciation, cadence, and Indian accent.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            <span>Tuned for Gurgaon Real Estate</span>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs font-medium text-slate-700">Customer Name in Greeting</Label>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Aarav, Rohan, Pooja"
              className="mt-1.5 text-xs font-medium"
            />
          </div>
          <div>
            <Label className="text-xs font-medium text-slate-700">Voice Synthesis Engine</Label>
            <Select value={speaker} onValueChange={setSpeaker}>
              <SelectTrigger className="mt-1.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bulbul">Sarvam AI - Bulbul (Default Conversational)</SelectItem>
                <SelectItem value="meera">Sarvam AI - Meera (Warm Hindi/Hinglish)</SelectItem>
                <SelectItem value="amit">Sarvam AI - Amit (Male Executive)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label className="text-xs font-medium text-slate-700">Select Script Segment</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              { key: "greeting", label: "1. Opening Greeting" },
              { key: "purpose", label: "2. Step A: Purpose" },
              { key: "budget", label: "3. Step B: Budget & Config" },
              { key: "market", label: "4. Best Now (Dwarka Exp)" },
              { key: "builders", label: "5. Builder Network" },
              { key: "wrapup", label: "6. Final Confirmation Wrap-up" },
              { key: "ai_disclosure", label: "7. AI Disclosure" },
            ].map((seg) => (
              <button
                key={seg.key}
                type="button"
                onClick={() => {
                  setActiveSegment(seg.key);
                  setCustomText("");
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  activeSegment === seg.key && !customText
                    ? "bg-brand text-white shadow-xs"
                    : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {seg.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-slate-700">Script Content to Speak</Label>
            {customText && (
              <button
                type="button"
                onClick={() => setCustomText("")}
                className="text-xs text-brand hover:underline"
              >
                Reset to standard template
              </button>
            )}
          </div>
          <Textarea
            value={currentScript}
            onChange={(e) => setCustomText(e.target.value)}
            rows={4}
            className="mt-1.5 text-xs leading-relaxed font-sans"
            placeholder="Type any custom sentence in Hinglish to test Vrinda's pronunciation..."
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Tip: You can edit this text directly to test how specific project names or numbers sound.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            onClick={() => handlePlayVoice()}
            disabled={loading}
            className={`flex-1 gap-2 py-3 text-sm font-semibold transition-all ${
              playing ? "bg-rose-600 hover:bg-rose-700 text-white" : "bg-brand hover:bg-brand-dark text-white"
            }`}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Synthesizing Audio...
              </>
            ) : playing ? (
              <>
                <Square className="h-4 w-4" /> Stop Audio
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current" /> Play Speech & Pronunciation
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
