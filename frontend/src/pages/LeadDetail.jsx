import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Phone, PhoneOff, Loader2, Mail, MapPin, Wallet, Building2, Clock,
  MessageSquarePlus, CircleDot, UserCog, Mic, MicOff, PhoneForwarded, PhoneCall,
  AlarmClock, Check, MessageCircle, Flag, Bot, Sparkles, Eye, Loader2 as Spin,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDuration, fmtMoney, fmtDate, waLink, telHref, STATUS_META, STATUSES } from "../lib/api";
import { tempMeta } from "../lib/ai";
import { TranscriptDialog } from "../components/ai/TranscriptDialog";
import { useAuth } from "../context/AuthContext";
import { RecordingPlayer } from "../components/RecordingPlayer";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Textarea } from "../components/ui/textarea";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Label } from "../components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "../components/ui/dialog";

const ACTIVITY_ICON = {
  call_logged: Phone,
  call_started: Phone,
  recording: Mic,
  status_change: CircleDot,
  assignment: UserCog,
  note: MessageSquarePlus,
  created: CircleDot,
};

const TEMPERATURES = ["hot", "warm", "cold"];
const DEAL_TYPES = [
  { value: "resale", label: "Resale", cls: "border-violet-200 bg-violet-50 text-violet-700" },
  { value: "rent", label: "Rent", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
];

const pickMime = () => {
  if (typeof MediaRecorder === "undefined") return null;
  return (
    ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) =>
      MediaRecorder.isTypeSupported(t)
    ) || ""
  );
};

export default function LeadDetail() {
  const { id } = useParams();
  const { isAdmin, isVranda } = useAuth();
  const [data, setData] = useState(null);
  const [agents, setAgents] = useState([]);
  const [note, setNote] = useState("");
  const [call, setCall] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [endOpen, setEndOpen] = useState(false);
  const [outcome, setOutcome] = useState("connected");
  const [callNotes, setCallNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [recState, setRecState] = useState("off"); // off | on | denied
  const [wantRecording, setWantRecording] = useState(false);
  const [followUpAt, setFollowUpAt] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [panelFu, setPanelFu] = useState("");
  const [aiOpen, setAiOpen] = useState(null);
  const [aiRunning, setAiRunning] = useState(false);
  const [realCallRunning, setRealCallRunning] = useState(false);
  const timer = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const load = () => api.get(`/leads/${id}`).then((r) => setData(r.data)).catch((e) => {
    toast.error(apiError(e.response?.data?.detail));
    setData(false);
  });

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  useEffect(() => {
    if (isAdmin) api.get("/users").then((r) => setAgents(r.data.filter((u) => u.role === "agent")));
  }, [isAdmin]);

  // stop mic if the page unmounts mid-call
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  useEffect(() => {
    if (call) {
      timer.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      clearInterval(timer.current);
      setElapsed(0);
    }
    return () => clearInterval(timer.current);
  }, [call]);

  if (data === null)
    return <div className="grid h-64 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>;
  if (data === false) return <div className="text-sm text-rose-600">Lead not available.</div>;

  const lead = data.lead;

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      rec.start(1000);
      mediaRef.current = rec;
      streamRef.current = stream;
      setRecState("on");
    } catch {
      setRecState("denied");
      toast.warning("Microphone blocked — the call will be logged without a recording");
    }
  };

  const stopRecording = () =>
    new Promise((resolve) => {
      const rec = mediaRef.current;
      const finish = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        mediaRef.current = null;
        streamRef.current = null;
        setRecState("off");
        const type = (rec?.mimeType || "audio/webm").split(";")[0];
        const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type }) : null;
        chunksRef.current = [];
        resolve(blob);
      };
      if (!rec || rec.state === "inactive") return finish();
      rec.onstop = finish;
      rec.stop();
    });

  const startCall = async () => {
    try {
      const { data: res } = await api.post("/calls/start", { lead_id: id });
      setCall(res);
      if (wantRecording) {
        await startRecording();
        toast.success("Call started — dial on speaker so the conversation is recorded");
      } else {
        toast.success("Call started — dial normally, no recording");
      }
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  const finishCall = async () => {
    setSaving(true);
    try {
      await api.post(`/calls/${call.call_id}/end`, {
        duration: elapsed, outcome, notes: callNotes || null,
        follow_up_at: followUpAt ? new Date(followUpAt).toISOString() : null,
        follow_up_note: followUpAt ? (followUpNote || null) : null,
      });
      const blob = await stopRecording();
      if (blob && blob.size > 0) {
        const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
        const fd = new FormData();
        fd.append("file", blob, `call-recording.${ext}`);
        try {
          await api.post(`/calls/${call.call_id}/recording`, fd);
          toast.success(`Call logged with recording · ${fmtDuration(elapsed)}`);
        } catch {
          toast.warning("Call logged, but the recording upload failed");
        }
      } else {
        toast.success(`Call logged · ${fmtDuration(elapsed)}`);
      }
      setCall(null);
      setWantRecording(false);
      setEndOpen(false);
      setCallNotes("");
      setFollowUpAt("");
      setFollowUpNote("");
      load();
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status) => {
    try {
      await api.put(`/leads/${id}`, { status });
      toast.success("Stage updated");
      load();
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  const changeTemperature = async (tag) => {
    try {
      await api.put(`/leads/${id}`, { tag: tag === "none" ? null : tag });
      toast.success("Lead temperature updated");
      load();
    } catch (e) { toast.error(apiError(e.response?.data?.detail)); }
  };

  const toggleDealType = async (dealType) => {
    try {
      await api.put(`/leads/${id}`, { deal_type: lead.deal_type === dealType ? null : dealType });
      toast.success(lead.deal_type === dealType ? "Listing flag removed" : "Listing flag updated");
      load();
    } catch (e) { toast.error(apiError(e.response?.data?.detail)); }
  };

  const reassign = async (agentId) => {
    try {
      await api.put(`/leads/${id}`, { assigned_to: agentId === "none" ? null : agentId });
      toast.success("Lead reassigned");
      load();
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    try {
      await api.post(`/leads/${id}/activities`, { type: "note", message: note.trim() });
      setNote("");
      load();
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  const completeFollowUp = async () => {
    try {
      await api.post(`/followups/${id}/complete`);
      toast.success("Follow-up marked done");
      load();
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  const savePanelFollowUp = async () => {
    if (!panelFu) return;
    try {
      await api.put(`/leads/${id}`, { follow_up_at: new Date(panelFu).toISOString() });
      toast.success("Follow-up reminder set");
      setPanelFu("");
      load();
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  const toggleBrochure = async () => {
    try {
      await api.put(`/leads/${id}`, { brochure_sent: !lead.brochure_sent });
      toast.success(!lead.brochure_sent ? "Marked: brochure sent ✓" : "Brochure tick removed");
      load();
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  const runAiCall = async () => {
    setAiRunning(true);
    try {
      const { data } = await api.post("/ai/calls/run", { lead_id: id });
      toast.success(`AI call done · ${data.temperature?.toUpperCase()} (${data.intent_score} pts)`);
      load();
      setAiOpen(data.call_id);
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    } finally {
      setAiRunning(false);
    }
  };

  // Places a REAL phone call via the voice-agent microservice. The result
  // is not immediate — the call happens live, and the CRM updates once the
  // voice-agent posts the finished transcript back to /ai/calls/ingest.
  const runRealCall = async () => {
    setRealCallRunning(true);
    try {
      const { data } = await api.post("/ai/calls/real/trigger", { lead_id: id });
      toast.success(`Dialing ${lead.name || "lead"} now — call is live (uuid: ${data.call_uuid || "pending"})`);
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    } finally {
      setRealCallRunning(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="lead-detail-page">
      <Link to="/leads" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand" data-testid="back-to-leads">
        <ArrowLeft className="h-4 w-4" /> Back to leads
      </Link>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* Left */}
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex flex-wrap gap-2">
                  {DEAL_TYPES.map((type) => <Button key={type.value} size="sm" variant="outline" onClick={() => toggleDealType(type.value)}
                    className={`h-7 gap-1 px-2 text-xs ${lead.deal_type === type.value ? type.cls : "text-slate-500"}`}>
                    <Flag className="h-3 w-3" /> {type.label}
                  </Button>)}
                </div>
                <h1 className="text-3xl font-bold text-slate-900" data-testid="lead-name">{lead.name || "(no name)"}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{lead.phone}</span>
                  {lead.email && <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{lead.email}</span>}
                  {lead.city && <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{lead.city}</span>}
                </div>
              </div>
              <Badge variant="outline" className={`${STATUS_META[lead.status]?.cls} px-3 py-1`} data-testid="lead-status-badge">
                {STATUS_META[lead.status]?.label}
              </Badge>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                [Wallet, "Budget", fmtMoney(lead.budget)],
                [Building2, "Interest", lead.property_interest || "—"],
                [Clock, "Talk time", fmtDuration(lead.total_talk_time)],
                [Phone, "Calls", String(lead.call_count || 0)],
              ].map(([Icon, label, value]) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <Icon className="h-3 w-3" /> {label}
                  </div>
                  <div className="mt-1.5 text-sm font-semibold text-slate-800">{value}</div>
                </div>
              ))}
            </div>

            {/* Call console */}
            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-3">
                {!call ? (
                  <>
                    <Button onClick={startCall} data-testid="click-to-call-btn" className="gap-2 bg-brand hover:bg-brand-dark">
                      <Phone className="h-4 w-4" /> Start call
                    </Button>
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                      <Checkbox
                        checked={wantRecording}
                        onCheckedChange={(v) => setWantRecording(!!v)}
                        data-testid="record-call-toggle"
                      />
                      Record this call (needs speakerphone)
                    </label>
                  </>
                ) : (
                  <>
                    <div className="pulse-ring flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white">
                      <span className="h-2 w-2 rounded-full bg-white" />
                      <span data-testid="call-timer">{fmtDuration(elapsed)}</span>
                    </div>
                    <a
                      href={telHref(lead.phone)}
                      data-testid="dial-on-phone-link"
                      className="inline-flex items-center gap-2 rounded-lg border border-brand/30 bg-white px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-light"
                    >
                      <PhoneForwarded className="h-4 w-4" /> Dial {lead.phone}
                    </a>
                    {wantRecording && (
                      <span
                        data-testid="recording-indicator"
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                          recState === "on" ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-500"
                        }`}
                      >
                        {recState === "on" ? (
                          <><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-600" /> <Mic className="h-3 w-3" /> Recording</>
                        ) : (
                          <><MicOff className="h-3 w-3" /> No recording</>
                        )}
                      </span>
                    )}
                    <Button variant="destructive" onClick={() => setEndOpen(true)} data-testid="end-call-btn" className="gap-2">
                      <PhoneOff className="h-4 w-4" /> End &amp; log
                    </Button>
                  </>
                )}
                <span className="basis-full text-xs text-slate-500">
                  Every call is logged with duration and notes automatically. Recording is optional —
                  tick the box only for calls you actually want an audio copy of, and put the call on
                  speakerphone for that one.
                </span>
              </div>
            </div>
          </div>

          {/* Activity timeline */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <h3 className="text-lg font-semibold text-slate-900">Activity timeline</h3>
            </div>
            <div className="space-y-3 p-5">
              <div className="flex gap-2">
                <Textarea data-testid="note-input" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Log a note, follow-up or client requirement…" rows={2} />
                <Button onClick={addNote} data-testid="add-note-btn" className="self-end bg-brand hover:bg-brand-dark">Add</Button>
              </div>

              <div className="relative mt-6 space-y-5 pl-6">
                <div className="absolute bottom-2 left-[7px] top-2 w-px bg-slate-200" />
                {data.activities.length === 0 && <div className="text-sm text-slate-400">No activity yet.</div>}
                {data.activities.map((a) => {
                  const Icon = ACTIVITY_ICON[a.type] || CircleDot;
                  return (
                    <div key={a._id} className="relative" data-testid={`activity-${a._id}`}>
                      <div className="absolute -left-6 top-0.5 grid h-[15px] w-[15px] place-items-center rounded-full border-2 border-white bg-brand">
                        <Icon className="h-2 w-2 text-white" />
                      </div>
                      <div className="text-sm text-slate-800">{a.message}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{a.actor_name} · {fmtDate(a.created_at)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900">Manage</h3>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pipeline stage</Label>
                <Select value={lead.status} onValueChange={changeStatus}>
                  <SelectTrigger data-testid="change-status-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Lead temperature</Label>
                <Select value={lead.tag || "none"} onValueChange={changeTemperature}>
                  <SelectTrigger data-testid="change-temperature-select"><SelectValue placeholder="Select temperature" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No temperature</SelectItem>
                    {TEMPERATURES.map((temperature) => <SelectItem key={temperature} value={temperature}>{temperature[0].toUpperCase() + temperature.slice(1)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {isAdmin && (
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Assigned sales person</Label>
                  <Select value={lead.assigned_to || "none"} onValueChange={reassign}>
                    <SelectTrigger data-testid="reassign-select"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Follow-up reminder</Label>
                {lead.follow_up_at ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="followup-info">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                      <AlarmClock className="h-4 w-4" /> {fmtDate(lead.follow_up_at)}
                    </div>
                    {lead.follow_up_note && <div className="mt-1 text-xs text-amber-700">{lead.follow_up_note}</div>}
                    <div className="mt-1 text-[11px] text-amber-600">Alarm rings 10 minutes before.</div>
                    <Button size="sm" variant="outline" className="mt-2 gap-1.5 bg-white"
                      onClick={completeFollowUp} data-testid="followup-done-btn">
                      <Check className="h-3.5 w-3.5" /> Mark done
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input type="datetime-local" value={panelFu} onChange={(e) => setPanelFu(e.target.value)}
                      data-testid="set-followup-input" />
                    <Button size="sm" className="self-stretch bg-brand hover:bg-brand-dark" disabled={!panelFu}
                      onClick={savePanelFollowUp} data-testid="set-followup-btn">Set</Button>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">WhatsApp brochure</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <a href={waLink(lead.phone, lead.name)} target="_blank" rel="noreferrer" data-testid="whatsapp-send-btn"
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600">
                    <MessageCircle className="h-4 w-4" /> Send on WhatsApp
                  </a>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                    <Checkbox checked={!!lead.brochure_sent} onCheckedChange={toggleBrochure} data-testid="brochure-tick" />
                    Brochure sent {lead.brochure_sent ? "✓" : ""}
                  </label>
                </div>
                {lead.brochure_sent_at && (
                  <div className="text-[11px] text-slate-400">Sent · {fmtDate(lead.brochure_sent_at)}</div>
                )}
              </div>
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
                <div>Source · <b className="text-slate-700">{lead.source}</b></div>
                <div className="mt-1">Created · {fmtDate(lead.created_at)}</div>
                <div className="mt-1">Last contact · {lead.last_contacted_at ? fmtDate(lead.last_contacted_at) : "Never"}</div>
                <div className="mt-1">Owner · {lead.assigned_to_name || "Unassigned"}</div>
              </div>
              {lead.notes && (
                <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-600">{lead.notes}</div>
              )}
              <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Remarks</div>
                <div className="whitespace-pre-wrap break-words">{lead.remark || "No remarks added."}</div>
              </div>
            </div>
          </div>

          {/* AI Calling insights — Vranda-only feature, hidden entirely for everyone else */}
          {isVranda && (
          <div className="rounded-xl border border-brand/20 bg-white shadow-sm" data-testid="ai-insights-card">
            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Bot className="h-5 w-5 text-brand" /> AI Calling
              </h3>
              {lead.ai_temperature && (() => {
                const m = tempMeta(lead.ai_temperature);
                return (
                  <Badge variant="outline" className={`${m.cls} px-2.5 py-0.5`} data-testid="ai-temp-badge">
                    <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.label} · {lead.ai_intent_score} pts
                  </Badge>
                );
              })()}
            </div>
            <div className="space-y-4 p-5">
              {lead.ai_summary ? (
                <>
                  <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm text-slate-700">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Last call summary</div>
                    {lead.ai_summary}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {[["BHK", lead.ai_bhk], ["Budget", lead.ai_bhk && fmtMoney(lead.budget)], ["Location", lead.ai_location_preference], ["Possession", lead.ai_possession_timeline], ["Parking", lead.ai_parking], ["Urgency", lead.ai_urgency_score ? `${lead.ai_urgency_score}/10` : null]].map(([k, v]) => (
                      <div key={k} className="rounded-lg border border-slate-100 bg-white p-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{k}</div>
                        <div className="mt-0.5 font-medium text-slate-800">{v || "—"}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {lead.ai_human_transfer_required && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                        <PhoneForwarded className="h-3 w-3" /> Transfer to Vranda · {lead.ai_transfer_target_number}
                      </span>
                    )}
                    {lead.ai_whatsapp_status === "sent" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                        <MessageCircle className="h-3 w-3" /> WhatsApp sent
                      </span>
                    )}
                    {lead.ai_next_followup_at && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                        <AlarmClock className="h-3 w-3" /> Follow-up {fmtDate(lead.ai_next_followup_at)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {lead.ai_transcript_ref && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAiOpen(lead.ai_transcript_ref)} data-testid="view-ai-transcript-btn">
                        <Eye className="h-3.5 w-3.5" /> View transcript
                      </Button>
                    )}
                    {isVranda && (
                      <Button size="sm" className="gap-1.5 bg-brand hover:bg-brand-dark" disabled={aiRunning} onClick={runAiCall} data-testid="run-ai-call-btn">
                        {aiRunning ? <Spin className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Re-run AI call (simulated)
                      </Button>
                    )}
                    {isVranda && (
                      <Button size="sm" variant="outline" className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50" disabled={realCallRunning} onClick={runRealCall} data-testid="run-real-call-btn">
                        {realCallRunning ? <Spin className="h-3.5 w-3.5 animate-spin" /> : <PhoneCall className="h-3.5 w-3.5" />} Call now (real)
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center">
                  <p className="text-sm text-slate-500">No AI call yet for this lead.</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {isVranda && (
                      <Button size="sm" className="gap-1.5 bg-brand hover:bg-brand-dark" disabled={aiRunning} onClick={runAiCall} data-testid="run-ai-call-btn">
                        {aiRunning ? <Spin className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Run AI call now (simulated)
                      </Button>
                    )}
                    {isVranda && (
                      <Button size="sm" variant="outline" className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50" disabled={realCallRunning} onClick={runRealCall} data-testid="run-real-call-btn">
                        {realCallRunning ? <Spin className="h-3.5 w-3.5 animate-spin" /> : <PhoneCall className="h-3.5 w-3.5" />} Call now (real)
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <h3 className="text-lg font-semibold text-slate-900">Call history</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {data.calls.length === 0 && <div className="p-5 text-sm text-slate-400">No calls yet.</div>}
              {data.calls.map((c) => (
                <div key={c._id} className="px-5 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    <Phone className="h-3.5 w-3.5 shrink-0 text-brand" />
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800">{fmtDuration(c.duration)} · {c.outcome || c.status}</div>
                      <div className="text-[11px] text-slate-400">{c.agent_name} · {fmtDate(c.started_at)}</div>
                    </div>
                  </div>
                  {c.has_recording && (
                    <div className="mt-2 pl-6">
                      <RecordingPlayer callId={c._id} compact />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={endOpen} onOpenChange={setEndOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log this call · {fmtDuration(elapsed)}</DialogTitle>
            <DialogDescription>Choose the outcome and add notes. Your recording is attached automatically.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Outcome</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger data-testid="call-outcome-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="connected">Connected</SelectItem>
                  <SelectItem value="interested">Interested</SelectItem>
                  <SelectItem value="visit_scheduled">Visit scheduled</SelectItem>
                  <SelectItem value="callback">Callback requested</SelectItem>
                  <SelectItem value="not_interested">Not interested</SelectItem>
                  <SelectItem value="converted">Converted</SelectItem>
                  <SelectItem value="no_answer">No answer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Call remarks</Label>
              <Textarea data-testid="call-notes-input" value={callNotes} onChange={(e) => setCallNotes(e.target.value)} rows={3}
                placeholder="What was discussed, client requirement, next step…" />
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                <AlarmClock className="h-4 w-4" /> Schedule follow-up (optional)
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Date &amp; time</Label>
                  <Input type="datetime-local" data-testid="followup-datetime-input" className="bg-white"
                    value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Follow-up remark</Label>
                  <Input data-testid="followup-note-input" className="bg-white" placeholder="e.g. share payment plan"
                    value={followUpNote} onChange={(e) => setFollowUpNote(e.target.value)} />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-amber-700">
                An alarm will ring 10 minutes before this time — no follow-up gets missed.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={finishCall} disabled={saving} data-testid="save-call-btn" className="gap-2 bg-brand hover:bg-brand-dark">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Saving recording…" : "Save call log"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TranscriptDialog callId={aiOpen} open={!!aiOpen} onOpenChange={(v) => !v && setAiOpen(null)} />
    </div>
  );
}
