import { useEffect, useState } from "react";
import { MapPin, Loader2, CheckCircle2, XCircle, LogIn, LogOut as OutIcon, Clock, TrendingUp, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDate, fmtDuration } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { StatCard } from "../components/StatCard";

const statusLabel = {
  present: { text: "Present", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  absent: { text: "Absent", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  leave: { text: "On Leave", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

export default function Attendance() {
  const { user, attendanceExempt, isWFH } = useAuth();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [lastError, setLastError] = useState("");

  const load = () => api.get("/attendance/me", { params: { days: 60 } })
    .then((r) => setData(r.data)).catch(() => setData(false));

  useEffect(() => { load(); }, []);

  const today = data?.records?.find((r) => r.date === data?.today);
  const mustMarkAttendance = !attendanceExempt;

  const grabGPS = () => new Promise((resolve) => {
    if (isWFH || !navigator.geolocation) {
      // WFH: send zero coords, backend will accept
      return resolve({ lat: 0, lng: 0, accuracy: null });
    }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsBusy(false);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
      (err) => {
        setGpsBusy(false);
        const msg = err.code === 1
          ? "Location permission denied. Enable it in your browser to mark attendance."
          : "Could not get GPS location. Move to open sky and try again.";
        resolve({ __error: msg });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });

  const checkIn = async () => {
    setLastError("");
    setBusy(true);
    try {
      const loc = await grabGPS();
      if (loc.__error) { setLastError(loc.__error); toast.error(loc.__error); return; }
      const r = await api.post("/attendance/check-in", loc);
      toast.success(r.data.already ? "Already checked in today"
        : isWFH ? "Checked in (work-from-home)" : `Checked in · ${r.data.distance_m} m from office`);
      load();
    } catch (e) {
      const msg = e.response?.data?.detail ? apiError(e.response.data.detail) : e.message;
      setLastError(msg);
      toast.error(msg);
    } finally { setBusy(false); }
  };

  const checkOut = async () => {
    setLastError("");
    setBusy(true);
    try {
      const loc = await grabGPS();
      if (loc.__error) { setLastError(loc.__error); toast.error(loc.__error); return; }
      const r = await api.post("/attendance/check-out", loc);
      toast.success(`Checked out · Worked ${fmtDuration(r.data.worked_seconds)}${r.data.overtime_seconds ? ` (+${fmtDuration(r.data.overtime_seconds)} OT)` : ""}`);
      load();
    } catch (e) {
      const msg = e.response?.data?.detail ? apiError(e.response.data.detail) : e.message;
      setLastError(msg);
      toast.error(msg);
    } finally { setBusy(false); }
  };

  const settings = data?.settings;

  const monthStats = (() => {
    if (!data?.records) return { present: 0, absent: 0, overtime: 0, late: 0 };
    const today = new Date();
    const startOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    const rows = data.records.filter((r) => r.date >= startOfMonth);
    return {
      present: rows.filter((r) => r.status === "present").length,
      absent: rows.filter((r) => r.status === "absent").length,
      overtime: rows.reduce((a, r) => a + (r.overtime_seconds || 0), 0),
      late: rows.reduce((a, r) => a + (r.late_seconds || 0), 0),
    };
  })();

  return (
    <div className="space-y-6" data-testid="attendance-page">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Attendance</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          GPS-verified check-in from within the office. Working hours: <b>{user?.office_start || settings?.office_start || "11:00"}</b> – <b>{user?.office_end || settings?.office_end || "18:00"}</b>.
        </p>
      </div>

      {!mustMarkAttendance && (
        <div className="rounded-xl border border-brand/25 bg-brand-light/60 p-4 text-sm text-brand">
          Attendance marking is not required for your role.
        </div>
      )}

      {/* Check-in / out console */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Today · {data?.today}</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">
              {today?.check_in_at ? (
                today?.check_out_at ? "Checked out ✓" : "Checked in"
              ) : "Not checked in yet"}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {today?.check_in_at && (
                <>Check-in: <b>{fmtDate(today.check_in_at)}</b>
                  {today.late_seconds > 60 && (
                    <span className="ml-2 text-amber-600">({fmtDuration(today.late_seconds)} late)</span>
                  )}
                </>
              )}
              {today?.check_out_at && (
                <> · Check-out: <b>{fmtDate(today.check_out_at)}</b> · Worked {fmtDuration(today.worked_seconds)}
                  {today.overtime_seconds > 0 && <span className="ml-2 text-emerald-600">+{fmtDuration(today.overtime_seconds)} OT</span>}
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!today?.check_in_at ? (
              <Button
                data-testid="attendance-checkin-btn"
                onClick={checkIn}
                disabled={busy || gpsBusy}
                className="gap-2 bg-brand px-6 py-6 text-base font-semibold hover:bg-brand-dark"
              >
                {busy || gpsBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
                {gpsBusy ? "Getting GPS…" : "Check in"}
              </Button>
            ) : !today?.check_out_at ? (
              <Button
                data-testid="attendance-checkout-btn"
                onClick={checkOut}
                disabled={busy || gpsBusy}
                variant="destructive"
                className="gap-2 px-6 py-6 text-base font-semibold"
              >
                {busy || gpsBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <OutIcon className="h-5 w-5" />}
                {gpsBusy ? "Getting GPS…" : "Check out"}
              </Button>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Attendance complete for today
              </div>
            )}
          </div>
        </div>

        {lastError && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" data-testid="attendance-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {lastError}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-4 text-xs text-slate-500">
          <MapPin className="h-4 w-4 text-brand" />
          Office radius: <b className="text-slate-700">{settings?.office_radius_m || 500} m</b>
          <span className="text-slate-300">·</span>
          Office coords: <code className="rounded bg-white px-1.5 py-0.5 text-brand">{settings?.office_lat?.toFixed(4)}, {settings?.office_lng?.toFixed(4)}</code>
          <span className="text-slate-300">·</span>
          Your GPS location is checked against the office coordinates before marking present.
        </div>
      </div>

      {/* This month KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard testId="attendance-kpi-present" label="Present this month" value={monthStats.present} icon={CheckCircle2} accent="emerald" />
        <StatCard testId="attendance-kpi-absent" label="Absent" value={monthStats.absent} icon={XCircle} accent="rose" delay={60} />
        <StatCard testId="attendance-kpi-overtime" label="Overtime" value={fmtDuration(monthStats.overtime)} icon={TrendingUp} accent="brand" delay={120} />
        <StatCard testId="attendance-kpi-late" label="Total late" value={fmtDuration(monthStats.late)} icon={Clock} accent="amber" delay={180} />
      </div>

      {/* History */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <h3 className="text-lg font-semibold text-slate-900">Last 60 days</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-5 py-2.5 text-left">Date</th>
                <th className="px-3 py-2.5 text-left">Status</th>
                <th className="px-3 py-2.5 text-left">Check-in</th>
                <th className="px-3 py-2.5 text-left">Check-out</th>
                <th className="px-3 py-2.5 text-right">Worked</th>
                <th className="px-3 py-2.5 text-right">Late</th>
                <th className="px-5 py-2.5 text-right">Overtime</th>
              </tr>
            </thead>
            <tbody>
              {data === null && (
                <tr><td colSpan={7} className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand" /></td></tr>
              )}
              {data?.records?.length === 0 && (
                <tr><td colSpan={7} className="p-10 text-center text-slate-400">No attendance records yet.</td></tr>
              )}
              {data?.records?.map((r) => {
                const sl = statusLabel[r.status] || statusLabel.present;
                return (
                  <tr key={r._id} data-testid={`attendance-row-${r.date}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-5 py-2.5 font-medium text-slate-800">{r.date}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${sl.cls}`}>{sl.text}</span>
                      {r.edited_by && <span className="ml-2 text-[10px] italic text-slate-400">edited by {r.edited_by}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{r.check_in_at ? fmtDate(r.check_in_at) : "—"}</td>
                    <td className="px-3 py-2.5 text-slate-600">{r.check_out_at ? fmtDate(r.check_out_at) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-medium text-slate-800">{fmtDuration(r.worked_seconds || 0)}</td>
                    <td className="px-3 py-2.5 text-right text-amber-600">{r.late_seconds > 60 ? fmtDuration(r.late_seconds) : "—"}</td>
                    <td className="px-5 py-2.5 text-right font-semibold text-emerald-600">{r.overtime_seconds > 0 ? fmtDuration(r.overtime_seconds) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
