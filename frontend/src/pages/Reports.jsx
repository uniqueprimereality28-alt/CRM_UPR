import { useEffect, useState } from "react";
import {
  Loader2, Contact, PhoneCall, Timer, AlarmClock, MapPin, Users,
  Trophy, XCircle, CalendarClock, ShieldAlert,
} from "lucide-react";
import { api, fmtDuration, fmtMoney, STATUS_META } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { Button } from "../components/ui/button";

const PERIODS = [
  { v: "today", label: "Today" },
  { v: "yesterday", label: "Yesterday" },
  { v: "weekly", label: "Weekly" },
  { v: "monthly", label: "Monthly" },
];

export default function Reports() {
  const [period, setPeriod] = useState("today");
  const [report, setReport] = useState(null);

  useEffect(() => {
    setReport(null);
    api.get("/reports/period/summary", { params: { period, tz_offset: new Date().getTimezoneOffset() } })
      .then((r) => setReport(r.data))
      .catch(() => setReport(false));
  }, [period]);

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Admin Reports Dashboard</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            One-click reports with live data — salesperson performance, leads, follow-ups, site visits, bookings and more.
          </p>
        </div>
      </div>

      {/* Period tabs */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        {PERIODS.map((p) => (
          <button
            key={p.v}
            onClick={() => setPeriod(p.v)}
            data-testid={`report-tab-${p.v}`}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
              period === p.v ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {report === null && (
        <div className="grid h-48 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>
      )}
      {report === false && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-600">
          Could not load the report. Try switching tabs again.
        </div>
      )}

      {report && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
            <div className="text-sm font-semibold text-slate-800">{report.title}</div>
            <div className="text-xs text-slate-500">For {report.date_range}</div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard testId="rep-new-leads" label="New Leads" value={report.summary.new_leads} icon={Contact} delay={0} />
            <StatCard testId="rep-calls" label="Calls" value={report.summary.calls} icon={PhoneCall} accent="amber" delay={40} />
            <StatCard testId="rep-talk-time" label="Talk Time" value={fmtDuration(report.summary.talk_time)} icon={Timer} accent="slate" delay={80} />
            <StatCard testId="rep-followups" label="Follow-ups Done" value={report.summary.followups_completed} icon={AlarmClock} accent="emerald" delay={120} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard testId="rep-site-visits" label="Site Visits" value={report.summary.site_visits} icon={MapPin} delay={0} />
            <StatCard testId="rep-meetings" label="Meetings" value={report.summary.meetings} icon={Users} accent="amber" delay={40} />
            <StatCard testId="rep-bookings" label="Bookings (Won)" value={report.summary.bookings}
              sub={fmtMoney(report.summary.bookings_value)} icon={Trophy} accent="emerald" delay={80} />
            <StatCard testId="rep-lost" label="Closed / Lost" value={report.summary.lost} icon={XCircle}
              accent={report.summary.lost ? "rose" : "slate"} delay={120} />
          </div>

          {report.summary.overdue_followups > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <b>{report.summary.overdue_followups}</b>&nbsp;overdue follow-up(s) need attention right now.
            </div>
          )}

          {/* Status-wise pipeline */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">
                Status-wise Lead Distribution <span className="font-normal normal-case text-slate-400">(current full pipeline)</span>
              </h3>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              {report.status_breakdown.map((s) => (
                <div key={s.status} className={`rounded-lg border px-4 py-2.5 text-center ${STATUS_META[s.status]?.cls || "border-slate-200"}`}>
                  <div className="text-lg font-bold">{s.count}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider">{STATUS_META[s.status]?.label || s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Salesperson-wise table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <h3 className="text-lg font-semibold text-slate-900">Salesperson-wise Performance</h3>
              <p className="mt-0.5 text-xs text-slate-500">Names pulled directly from the team roster.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                    <th className="px-5 py-2.5 text-left">Salesperson</th>
                    <th className="px-3 py-2.5 text-right">New Leads</th>
                    <th className="px-3 py-2.5 text-right">Calls</th>
                    <th className="px-3 py-2.5 text-right">Talk time</th>
                    <th className="px-3 py-2.5 text-right">Follow-ups</th>
                    <th className="px-3 py-2.5 text-right">Site Visits</th>
                    <th className="px-3 py-2.5 text-right">Meetings</th>
                    <th className="px-3 py-2.5 text-right">Bookings</th>
                    <th className="px-3 py-2.5 text-right">Booking value</th>
                    <th className="px-5 py-2.5 text-right">Lost</th>
                  </tr>
                </thead>
                <tbody>
                  {report.salespeople.length === 0 && (
                    <tr><td colSpan={10} className="px-5 py-8 text-center text-slate-400">No activity in this period.</td></tr>
                  )}
                  {report.salespeople.map((p) => (
                    <tr key={p.agent_id} data-testid={`rep-agent-row-${p.agent_id}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-light text-xs font-bold text-brand">
                            {(p.name || "?").slice(0, 1)}
                          </div>
                          <div className="font-medium text-slate-800">{p.name || "Unknown"}</div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">{p.new_leads}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{p.calls}</td>
                      <td className="px-3 py-3 text-right font-medium text-slate-800">{fmtDuration(p.talk_time)}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{p.followups_completed}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{p.site_visits}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{p.meetings}</td>
                      <td className="px-3 py-3 text-right font-semibold text-emerald-600">{p.bookings}</td>
                      <td className="px-3 py-3 text-right text-slate-600">{fmtMoney(p.bookings_value)}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{p.lost}</td>
                    </tr>
                  ))}
                </tbody>
                {report.salespeople.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold text-slate-800">
                      <td className="px-5 py-3">Total</td>
                      <td className="px-3 py-3 text-right">{report.totals.new_leads}</td>
                      <td className="px-3 py-3 text-right">{report.totals.calls}</td>
                      <td className="px-3 py-3 text-right">{fmtDuration(report.totals.talk_time)}</td>
                      <td className="px-3 py-3 text-right">{report.totals.followups_completed}</td>
                      <td className="px-3 py-3 text-right">{report.totals.site_visits}</td>
                      <td className="px-3 py-3 text-right">{report.totals.meetings}</td>
                      <td className="px-3 py-3 text-right text-emerald-700">{report.totals.bookings}</td>
                      <td className="px-3 py-3 text-right">{fmtMoney(report.totals.bookings_value)}</td>
                      <td className="px-5 py-3 text-right">{report.totals.lost}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
