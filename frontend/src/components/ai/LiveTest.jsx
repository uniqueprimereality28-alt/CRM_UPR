import { useState, useRef } from "react";
import {
  Volume2, Play, Square, Loader2, Sparkles, Bot, User,
  CheckCircle2, AlertCircle, RefreshCw, Send, SlidersHorizontal,
  Flame, Sun, Snowflake, Mic, Headphones, Building2
} from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../ui/select";

export const LiveTest = () => {
  // Voice Pronunciation Tester State
  const [customerName, setCustomerName] = useState("Aarav");
  const [selectedPhraseKey, setSelectedPhraseKey] = useState("greeting");
  const [customText, setCustomText] = useState("");
  const [speaker, setSpeaker] = useState("meera");
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);

  // Virtual Call Simulator State
  const [simLeadName, setSimLeadName] = useState("Aarav");
  const [simPhone, setSimPhone] = useState("+91 9876543210");
  const [simInput, setSimInput] = useState("");
  const [simLoading, setSimLoading] = useState(false);
  const [simHistory, setSimHistory] = useState([
    {
      speaker: "Vrinda",
      text: "Hello Aarav ji, I'm Vrinda calling from Unique Prime Reality, Gurgaon se. Kya aap Gurgaon mein koi property plan kar rahe hain?",
    },
  ]);
  const [simAnalysis, setSimAnalysis] = useState(null);

  const samplePhrases = {
    greeting: `Hello ${customerName || "ji"}, I'm Vrinda calling from Unique Prime Reality, Gurgaon se. Kya aap Gurgaon mein koi property plan kar rahe hain?`,
    purpose: `Sir aapki requirement ko better understand karne ke liye kya main jaan sakti hu yeh property purchase personal use ke liye hai ya investment purpose ke liye hai?`,
    budget: `Perfect, and aap kitne budget main and konsi configuration main yeh property plan kar rahe hain like studio apartment, 1 BHK, 2 BHK, 3 BHK, 4 BHK, or penthouse?`,
    market: `Hamare paas different projects available hain and every project has its own USP. Agar aap meri advice consider karein, toh best opportunistic location is Dwarka Expressway right now.`,
    builders: `We have almost every reputed builder's projects like from Godrej, ATS, Whiteland / Wal Developer, Hero Homes, M3M, Elan, Emaar, and many others.`,
    wrapup: `${customerName || "Sir"} ji maine aapki saari requirement note kar li — aapko 3 BHK property chahiye Dwarka Expressway mein under 2.5 Cr for personal use. Main ye saari details hamari senior team ke sath share kar rahi hoon and they will get in touch with you shortly. Thank you so much for your time, have a nice day!`,
    ai_disclosure: `Yes, I am an AI assistant working for Unique Prime reality . and please aap Nishchint rahiye main aapki sari requiremnts note kar rahi hu and i will share it with my team, so they can find you with the best property at the earliest.`,
    transfer: `${customerName || "Sir"} ji please stay on the line, while I am connecting the call.`,
  };

  const currentSpeechText = selectedPhraseKey === "custom" ? customText : samplePhrases[selectedPhraseKey] || "";

  const handlePlayVoice = async (overrideText) => {
    const textToSpeak = overrideText || currentSpeechText;
    if (!textToSpeak.trim()) {
      toast.error("Please enter or select text for Vrinda to speak");
      return;
    }

    if (playing) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      setPlaying(false);
      return;
    }

    setPlaying(true);

    try {
      // 1. Try server-side Sarvam AI TTS
      const res = await api.post("/ai/tts/test", {
        text: textToSpeak,
        speaker: speaker,
        language: "hi-IN",
      });

      if (res.data?.audio_base64) {
        const audioSrc = `data:audio/wav;base64,${res.data.audio_base64}`;
        const audio = new Audio(audioSrc);
        audioRef.current = audio;
        audio.onended = () => setPlaying(false);
        audio.onerror = () => {
          fallbackBrowserSpeech(textToSpeak);
        };
        await audio.play();
        toast.success(`Playing through Sarvam AI (${speaker})!`);
        return;
      }
    } catch (e) {
      // Backend test error or no API key yet -> fallback gracefully
    }

    // 2. Fallback: Browser Web Speech API
    fallbackBrowserSpeech(textToSpeak);
  };

  const fallbackBrowserSpeech = (text) => {
    if (!window.speechSynthesis) {
      toast.error("Speech synthesis is not supported on this browser.");
      setPlaying(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.05;
    utterance.lang = "hi-IN";
    utterance.onend = () => setPlaying(false);
    utterance.onerror = () => setPlaying(false);
    window.speechSynthesis.speak(utterance);
    toast.info("Playing audio via browser voice synthesizer.");
  };

  const handleSendSimReply = async (e) => {
    e?.preventDefault();
    if (!simInput.trim()) return;

    const userText = simInput.trim();
    setSimInput("");
    const newHist = [...simHistory, { speaker: "Customer", text: userText }];
    setSimHistory(newHist);
    setSimLoading(true);

    try {
      const res = await api.post("/ai/calls/simulate", {
        lead_name: simLeadName,
        phone: simPhone,
        customer_message: userText,
        history: newHist,
      });

      const vrindaReply = res.data?.reply || res.data?.summary || "Noted ji. Main ye saari details hamari senior team ke sath share kar rahi hoon and they will get in touch with you shortly. Thank you so much for your time, have a nice day!";
      setSimHistory((prev) => [...prev, { speaker: "Vrinda", text: vrindaReply }]);
      setSimAnalysis(res.data);
      // Automatically speak the response
      handlePlayVoice(vrindaReply);
    } catch (err) {
      // Offline fallback reply logic
      let fallbackReply = "Noted ji! Gurgaon mein agar hum prime corridors dekhein — toh kya aap Dwarka Expressway, Golf Course Extension Road, Sohna Road, ya New Gurgaon side prefer karenge?";
      const lower = userText.toLowerCase();
      if (lower.includes("dwarka") || lower.includes("bhk") || lower.includes("cr")) {
        fallbackReply = `Aapke requirement ke liye hamare paas Dwarka Expressway Luxury Residences mein premium options available hain. ${simLeadName} ji maine aapki requirement note kar li hai and our team will get in touch with you shortly. Thank you so much!`;
      }
      setSimHistory((prev) => [...prev, { speaker: "Vrinda", text: fallbackReply }]);
      handlePlayVoice(fallbackReply);
    } finally {
      setSimLoading(false);
    }
  };

  const resetSimulator = () => {
    setSimHistory([
      {
        speaker: "Vrinda",
        text: `Hello ${simLeadName || "ji"}, I'm Vrinda calling from Unique Prime Reality, Gurgaon se. Kya aap Gurgaon mein koi property plan kar rahe hain?`,
      },
    ]);
    setSimAnalysis(null);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-amber-50/40 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-800">
              <Headphones className="h-4 w-4 text-amber-600" /> Virtual Voice & Pronunciation Studio
            </div>
            <h2 className="brand-font mt-1 text-2xl font-bold text-slate-900">Live Test (Zero Phone Cost)</h2>
            <p className="mt-1 text-xs text-slate-600 max-w-2xl">
              Experience how Vrinda speaks, tests accents, checks project inventory pitches, and answers questions in real-time without dialing a phone number and without Vobiz telephony.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
              Free Browser Audio
            </Badge>
            <Badge variant="outline" className="bg-white text-slate-700">
              Sarvam AI (Meera) & Grok
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Voice Pronunciation Tester */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-6 space-y-5">
          <div className="border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
              <Volume2 className="h-3.5 w-3.5" /> Speech & Pronunciation Tester
            </div>
            <h3 className="brand-font text-lg font-bold text-slate-900 mt-1">Hear Vrinda Speak Any Script</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Select any conversation moment to verify pronunciation, cadence, and Indian accent.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
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
                  <SelectItem value="meera">Sarvam AI · Meera (Warm Hindi/Hinglish)</SelectItem>
                  <SelectItem value="bulbul">Sarvam AI · Bulbul (Conversational)</SelectItem>
                  <SelectItem value="amit">Sarvam AI · Amit (Male Executive)</SelectItem>
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
                { key: "budget", label: "3. Step B: Budget" },
                { key: "market", label: "4. Best Now (Dwarka Exp)" },
                { key: "builders", label: "5. Builder Network" },
                { key: "wrapup", label: "6. Final Confirmation Wrap-up" },
                { key: "ai_disclosure", label: "7. AI Disclosure" },
                { key: "custom", label: "✏️ Custom Text" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSelectedPhraseKey(item.key)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
                    selectedPhraseKey === item.key
                      ? "bg-brand text-white shadow-2xs"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {selectedPhraseKey === "custom" ? (
            <div>
              <Label className="text-xs font-medium text-slate-700">Type Custom Script</Label>
              <Textarea
                rows={4}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Type any Hindi or Hinglish sentence to test how Vrinda pronounces it..."
                className="mt-1.5 font-mono text-xs leading-relaxed"
              />
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Script to be spoken:
              </span>
              <p className="text-xs font-medium leading-relaxed text-slate-800">
                "{currentSpeechText}"
              </p>
            </div>
          )}

          <Button
            onClick={() => handlePlayVoice()}
            className={`w-full gap-2 py-2.5 text-sm font-semibold transition-all ${
              playing ? "bg-rose-600 hover:bg-rose-700 text-white" : "bg-brand hover:bg-brand-dark text-white"
            }`}
          >
            {playing ? (
              <>
                <Square className="h-4 w-4" /> Stop Audio
              </>
            ) : (
              <>
                <Play className="h-4 w-4 fill-current" /> Play Voice & Pronunciation
              </>
            )}
          </Button>
        </div>

        {/* Right Column: Virtual Conversation Simulator */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-6 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
                  <Bot className="h-3.5 w-3.5" /> Virtual Call Simulator
                </div>
                <h3 className="brand-font text-lg font-bold text-slate-900 mt-1">Talk with Vrinda's AI Brain</h3>
              </div>
              <Button variant="ghost" size="sm" onClick={resetSimulator} className="gap-1 text-xs text-slate-500">
                <RefreshCw className="h-3 w-3" /> Reset
              </Button>
            </div>

            {/* Chat Transcript Area */}
            <div className="mt-4 max-h-72 min-h-60 overflow-y-auto space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-xs">
              {simHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2.5 ${
                    msg.speaker === "Vrinda" ? "justify-start" : "justify-end"
                  }`}
                >
                  {msg.speaker === "Vrinda" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white text-[10px] font-bold">
                      V
                    </div>
                  )}
                  <div
                    className={`max-w-[82%] rounded-2xl p-3 shadow-2xs ${
                      msg.speaker === "Vrinda"
                        ? "bg-white border border-slate-200 text-slate-800"
                        : "bg-brand text-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-bold text-[10px] opacity-80 uppercase tracking-wider">
                        {msg.speaker}
                      </span>
                      {msg.speaker === "Vrinda" && (
                        <button
                          type="button"
                          onClick={() => handlePlayVoice(msg.text)}
                          className="text-brand hover:text-brand-dark"
                          title="Replay Audio"
                        >
                          <Volume2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <p className="leading-relaxed">{msg.text}</p>
                  </div>
                  {msg.speaker === "Customer" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-white text-[10px] font-bold">
                      You
                    </div>
                  )}
                </div>
              ))}
              {simLoading && (
                <div className="flex items-center gap-2 text-xs text-slate-500 italic p-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" /> Vrinda is analyzing & matching inventory...
                </div>
              )}
            </div>

            {/* Quick response chips */}
            <div className="mt-3 flex flex-wrap gap-1 text-xs">
              <span className="text-[11px] text-slate-400 mr-1 self-center">Try:</span>
              {[
                "Haan, 3 BHK dekh raha hu Dwarka Expressway par",
                "Personal use ke liye chahiye",
                "Budget 2 se 2.5 Cr hai",
                "Kya naya aaya hai Gurgaon mein?",
                "Are you an AI?",
                "Call me in the evening",
              ].map((chip, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setSimInput(chip);
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-brand-light hover:text-brand transition-colors"
                >
                  "{chip}"
                </button>
              ))}
            </div>
          </div>

          {/* User Input Form */}
          <form onSubmit={handleSendSimReply} className="mt-3 flex items-center gap-2">
            <Input
              value={simInput}
              onChange={(e) => setSimInput(e.target.value)}
              placeholder="Reply to Vrinda as a customer..."
              className="text-xs"
            />
            <Button type="submit" disabled={simLoading || !simInput.trim()} className="bg-brand text-white shrink-0 px-4">
              <Send className="h-3.5 w-3.5" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};
