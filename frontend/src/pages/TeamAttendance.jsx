import { useEffect, useState } from "react";
import { Loader2, Users, UserX, Timer, Award } from "lucide-react";
import { api, fmtDate, fmtDuration } from "../lib/api";
import { StatCard } from "../components/StatCard";

const statusLabel = {
  present: { text: "Present", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  absent: { text: "Absent", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  leave: { text: "On Leave", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

export default function TeamAttendance() {
  const [period, setPeriod] = useState("week");
  const [stats, setStats] = useState(null);
  const [today, setToday] = useState(null);

  const loadStats = (p) => api.get("/attendance/stats", { params: { period: p } })
    .then((r) => setStats(r.data)).catch(() => setStats(false));

  const loadToday = () => api.get("/attendance/today")
    .then((r) => setToday(r.data)).catch(() => setToday(false));

  useEffect(() => { loadStats(period); }, [period]);
  useEffect(() => { loadToday(); }, []);

  const perUser = stats?.per_user || [];
  const totalOvertime = perUser.reduce((a, u) => a + (u.overtime_seconds || 0), 0);
  const absenteeCount = perUser.filter((u) => u.absent_days > 0).length;
  const maxWorked = Math.max(1, ...perUser.map((u) => u.worked_seconds || 0));

  return (
    <div className="space-y-6" data-testid="team-attendance-page">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Team Attendance</h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Weekly and monthly attendance stats across the whole team.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Team Attendance Dashboard</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {stats ? `${stats.start} to ${stats.end} · ${stats.working_days} working days` : "Loading…"}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {["week", "month"].map((p) => (
            <button
              key={p}
              data-testid={`attendance-period-${p}`}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold capitalize transition ${
                period === p ? "bg-brand text-white" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              This {p}
            </button>
          ))}
        </div>
      </div>

      {stats === null && (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>
      )}

      {stats === false && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Couldn't load team attendance stats.
        </div>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard testId="team-kpi-tracked" label="Team members tracked" value={perUser.length} icon={Users} accent="brand" />
            <StatCard testId="team-kpi-ontime" label="On-time (no lates)" value={stats.on_time_count} icon={Award} accent="emerald" delay={60} />
            <StatCard testId="team-kpi-absentees" label="Have absences" value={absenteeCount} icon={UserX} accent="rose" delay={120} />
            <StatCard testId="team-kpi-overtime" label="Total overtime" value={fmtDuration(totalOvertime)} icon={Timer} accent="amber" delay={180} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Top overtime */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Top overtime this {period}</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {stats.top_overtime.length === 0 && (
                  <div className="p-6 text-center text-sm text-slate-400">No overtime logged</div>
                )}
                {stats.top_overtime.map((u, i) => (
                  <div key={u.user_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{i + 1}</span>
                      <span className="font-medium text-slate-800">{u.name}</span>
                      {u.team_lead_name && <span className="text-xs text-slate-400">· {u.team_lead_name}</span>}
                    </div>
                    <span className="font-semibold text-emerald-600">{fmtDuration(u.overtime_seconds)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top absentees */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Most absences this {period}</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {stats.top_absent.length === 0 && (
                  <div className="p-6 text-center text-sm text-slate-400">No absences — 🎉</div>
                )}
                {stats.top_absent.map((u, i) => (
                  <div key={u.user_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{i + 1}</span>
                      <span className="font-medium text-slate-800">{u.name}</span>
                      {u.team_lead_name && <span className="text-xs text-slate-400">· {u.team_lead_name}</span>}
                    </div>
                    <span className="font-semibold text-rose-600">{u.absent_days}d absent</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Worked-hours bar comparison */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Hours worked this {period}</h3>
            </div>
            <div className="space-y-3 p-4">
              {perUser.length === 0 && <div className="py-6 text-center text-sm text-slate-400">No data yet</div>}
              {perUser
                .slice()
                .sort((a, b) => (b.worked_seconds || 0) - (a.worked_seconds || 0))
                .map((u) => (
                  <div key={u.user_id} className="flex items-center gap-3 text-sm">
                    <div className="w-32 shrink-0 truncate font-medium text-slate-700">{u.name}</div>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${Math.max(2, ((u.worked_seconds || 0) / maxWorked) * 100)}%` }}
                      />
                    </div>
                    <div className="w-20 shrink-0 text-right text-xs font-semibold text-slate-500">
                      {fmtDuration(u.worked_seconds || 0)}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Top late */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Most late-arrivals this {period}</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {stats.top_late.length === 0 && (
                <div className="p-6 text-center text-sm text-slate-400">No late arrivals</div>
              )}
              {stats.top_late.map((u, i) => (
                <div key={u.user_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{i + 1}</span>
                    <span className="font-medium text-slate-800">{u.name}</span>
                    <span className="text-xs text-slate-400">· {u.late_days} late day{u.late_days === 1 ? "" : "s"}</span>
                  </div>
                  <span className="font-semibold text-amber-600">{fmtDuration(u.late_seconds)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Live today */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Today, live</h3>
          {today && <span className="text-xs text-slate-400">{today.date}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Check-in</th>
                <th className="px-3 py-2 text-left">Check-out</th>
                <th className="px-4 py-2 text-right">Worked</th>
              </tr>
            </thead>
            <tbody>
              {today === null && (
                <tr><td colSpan={6} className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand" /></td></tr>
              )}
              {today?.rows?.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-slate-400">No one to show yet.</td></tr>
              )}
              {today?.rows?.map((r) => {
                const sl = statusLabel[r.status] || statusLabel.absent;
                return (
                  <tr key={r.user_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-800">{r.user_name}{r.check_in_wfh && <span className="ml-1 text-[10px] text-slate-400">(WFH)</span>}</td>
                    <td className="px-3 py-2 capitalize text-slate-500">{r.role?.replace("_", " ")}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${sl.cls}`}>{sl.text}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.check_in_at ? fmtDate(r.check_in_at) : "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{r.check_out_at ? fmtDate(r.check_out_at) : "—"}</td>
                    <td className="px-4 py-2 text-right font-medium text-slate-800">{r.worked_seconds ? fmtDuration(r.worked_seconds) : "—"}</td>
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
