import { useEffect, useState } from "react";
import { MapPin, Save, Loader2, Building2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export default function Settings() {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/settings").then((r) => setForm(r.data)).catch(() => setForm(false));
  }, []);
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
    </div>
  );
}
