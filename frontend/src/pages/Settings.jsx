import { useEffect, useState } from "react";
import { MapPin, Save, Loader2, Building2, ShieldCheck, AlertTriangle, RotateCcw, Bot, Link2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDate } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "../components/ui/alert-dialog";

export default function Settings() {
  const { user, isVranda } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  // Voice-agent (real AI calling) connection — Vranda-only, stored in the
  // CRM's own database via /api/ai/calls/real/settings, so it can be set
  // straight from this page with no backend code edits or redeploy.
  const [vaForm, setVaForm] = useState(null);
  const [vaBusy, setVaBusy] = useState(false);
  const [vaSecret, setVaSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    api.get("/settings").then((r) => setForm(r.data)).catch(() => setForm(false));
    if (isVranda) {
      api.get("/ai/calls/real/settings")
        .then((r) => setVaForm(r.data))
        .catch(() => setVaForm(false));
    }
  }, [isVranda]);

  const saveVoiceAgent = async (e) => {
    e.preventDefault();
    if (!vaForm?.voice_agent_url) return toast.error("Enter the voice-agent URL first");
    setVaBusy(true);
    try {
      await api.post("/ai/calls/real/settings", {
        voice_agent_url: vaForm.voice_agent_url,
        voice_agent_shared_secret: vaSecret || undefined,
      });
      toast.success("Voice-agent connection saved");
      const { data } = await api.get("/ai/calls/real/settings");
      setVaForm(data);
      setVaSecret("");
    } catch (e2) {
      toast.error(apiError(e2.response?.data?.detail));
    } finally { setVaBusy(false); }
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.put("/settings", {
        office_lat: Number(form.office_lat),
        office_lng: Number(form.office_lng),
        office_radius_m: Number(form.office_radius_m),
        office_start: form.office_start,
        office_end: form.office_end,
        office_label: form.office_label,
      });
      setForm(data);
      toast.success("Office settings updated");
    } catch (e2) {
      toast.error(apiError(e2.response?.data?.detail));
    } finally { setBusy(false); }
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return toast.error("Device has no GPS");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm({ ...form, office_lat: pos.coords.latitude, office_lng: pos.coords.longitude });
        toast.success("Coordinates pulled from your current GPS");
      },
      () => toast.error("Could not get GPS. Ensure permission is granted."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const resetData = async () => {
    if (resetConfirm !== "RESET") return;
    setResetBusy(true);
    try {
      const { data } = await api.post("/settings/reset-data", { confirm: resetConfirm });
      toast.success(`Reset complete — ${data.calls_deleted} call logs and ${data.attendance_deleted} attendance records cleared.`);
      setForm((f) => ({ ...f, data_reset_at: data.reset_at }));
      setResetConfirm("");
      setResetOpen(false);
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    } finally { setResetBusy(false); }
  };

  if (form === null)
    return <div className="grid h-64 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>;
  if (form === false)
    return <div className="text-sm text-rose-600">Could not load settings.</div>;

  return (
    <div className="space-y-6" data-testid="settings-page">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-brand">
          <ShieldCheck className="h-4 w-4" /> Administrator only
        </div>
        <h1 className="mt-1 text-3xl font-bold text-slate-900 md:text-4xl">Office &amp; System Settings</h1>
        <p className="mt-1.5 text-sm text-slate-500">GPS coordinates, allowed radius and default office hours.</p>
      </div>

      <form onSubmit={save} className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <MapPin className="h-5 w-5 text-brand" /> Office GPS
          </div>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label>Office label</Label>
              <Input data-testid="office-label" value={form.office_label || ""}
                onChange={(e) => setForm({ ...form, office_label: e.target.value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Latitude</Label>
                <Input data-testid="office-lat" type="number" step="0.0000001" value={form.office_lat}
                  onChange={(e) => setForm({ ...form, office_lat: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Longitude</Label>
                <Input data-testid="office-lng" type="number" step="0.0000001" value={form.office_lng}
                  onChange={(e) => setForm({ ...form, office_lng: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Allowed radius (metres)</Label>
              <Input data-testid="office-radius" type="number" min={50} value={form.office_radius_m}
                onChange={(e) => setForm({ ...form, office_radius_m: e.target.value })} />
              <div className="text-[11px] text-slate-400">Employees must be within this radius to check in.</div>
            </div>
            <Button type="button" variant="outline" onClick={useMyLocation} data-testid="use-my-location"
              className="w-full gap-2">
              <MapPin className="h-4 w-4" /> Use my current GPS as office
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Building2 className="h-5 w-5 text-brand" /> Default office hours
          </div>
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Start (HH:MM, 24 hr)</Label>
                <Input data-testid="office-start" value={form.office_start}
                  onChange={(e) => setForm({ ...form, office_start: e.target.value })} placeholder="11:00" />
              </div>
              <div className="space-y-1.5">
                <Label>End (HH:MM, 24 hr)</Label>
                <Input data-testid="office-end" value={form.office_end}
                  onChange={(e) => setForm({ ...form, office_end: e.target.value })} placeholder="18:00" />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              These are the defaults for new profiles. Per-person hours can be customised from the Team page.
            </p>
          </div>
          <Button type="submit" disabled={busy} data-testid="save-settings-btn"
            className="mt-6 w-full gap-2 bg-brand hover:bg-brand-dark">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save settings
          </Button>
        </div>
      </form>

      {/* Danger zone — Vranda (superadmin) only */}
      {isSuperadmin && (
      <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-6 shadow-sm">
        <div className="flex items-center gap-2 text-lg font-semibold text-rose-700">
          <AlertTriangle className="h-5 w-5" /> Reset system data
        </div>
        <p className="mt-2 max-w-2xl text-sm text-rose-700/90">
          This permanently deletes <b>every call log</b> and <b>every attendance record</b> in the system.
          Team profiles, leads, and office settings are kept as-is — only call and attendance history is wiped,
          so reporting effectively starts fresh from the moment you confirm this.
        </p>
        {form.data_reset_at && (
          <p className="mt-2 text-xs text-rose-600/80">
            Last reset: <b>{fmtDate(form.data_reset_at)}</b>{form.data_reset_by ? ` by ${form.data_reset_by}` : ""}
          </p>
        )}

        <AlertDialog open={resetOpen} onOpenChange={(v) => { setResetOpen(v); if (!v) setResetConfirm(""); }}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="destructive" data-testid="open-reset-dialog-btn" className="mt-4 gap-2">
              <RotateCcw className="h-4 w-4" /> Reset call logs &amp; attendance
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>This cannot be undone</AlertDialogTitle>
              <AlertDialogDescription>
                All call logs and attendance records will be permanently deleted, and every lead's
                talk-time/call-count will reset to zero. To confirm, type <b>RESET</b> below.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5 py-2">
              <Label>Type RESET to confirm</Label>
              <Input
                data-testid="reset-confirm-input"
                type="password"
                autoFocus
                autoComplete="off"
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                placeholder="RESET"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                data-testid="confirm-reset-btn"
                disabled={resetConfirm !== "RESET" || resetBusy}
                onClick={(e) => { e.preventDefault(); resetData(); }}
                className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
              >
                {resetBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Permanently reset"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      )}

      {/* Real AI voice-calling agent connection — Vranda-only */}
      {isVranda && (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-6 shadow-sm">
        <div className="flex items-center gap-2 text-lg font-semibold text-emerald-800">
          <Bot className="h-5 w-5" /> AI Voice Calling Agent
        </div>
        <p className="mt-2 max-w-2xl text-sm text-emerald-800/80">
          This connects the CRM to your separately-deployed voice-agent service (the one that
          actually places phone calls). Paste its URL and shared secret here — no code edits or
          backend redeploy needed. This section and the "Call now (real)" button are visible only
          on your account.
        </p>

        {vaForm === null ? (
          <div className="mt-4"><Loader2 className="h-4 w-4 animate-spin text-emerald-700" /></div>
        ) : vaForm === false ? (
          <p className="mt-4 text-sm text-rose-600">Could not load voice-agent settings.</p>
        ) : (
          <form onSubmit={saveVoiceAgent} className="mt-4 max-w-xl space-y-3">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" /> Voice-agent URL</Label>
              <Input
                data-testid="voice-agent-url"
                placeholder="https://your-voice-agent.onrender.com"
                value={vaForm.voice_agent_url || ""}
                onChange={(e) => setVaForm({ ...vaForm, voice_agent_url: e.target.value })}
              />
              <div className="text-[11px] text-emerald-700/70">
                Currently: {vaForm.voice_agent_url ? <code>{vaForm.voice_agent_url}</code> : "not set"}
                {" "}({vaForm.source === "database" ? "set from this page" : vaForm.source === "env" ? "set via backend env var" : "unset"})
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Shared secret</Label>
              <div className="relative">
                <Input
                  data-testid="voice-agent-secret"
                  type={showSecret ? "text" : "password"}
                  placeholder={vaForm.secret_configured ? "•••••••• (already set — leave blank to keep it)" : "paste the same secret you set on the voice-agent"}
                  value={vaSecret}
                  onChange={(e) => setVaSecret(e.target.value)}
                  className="pr-9"
                />
                <button type="button" onClick={() => setShowSecret((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-700/60 hover:text-emerald-700">
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="text-[11px] text-emerald-700/70">
                {vaForm.secret_configured ? "A secret is currently set." : "No secret set yet — real calling won't work until one is."}
                {" "}Must exactly match VOICE_AGENT_SHARED_SECRET on the voice-agent service.
              </div>
            </div>
            <Button type="submit" disabled={vaBusy} data-testid="save-voice-agent-btn"
              className="gap-2 bg-emerald-700 hover:bg-emerald-800">
              {vaBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save connection
            </Button>
          </form>
        )}
      </div>
      )}
    </div>
  );
}
