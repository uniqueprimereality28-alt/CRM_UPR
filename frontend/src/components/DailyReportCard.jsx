import { useEffect, useState } from "react";
import { CalendarDays, MessageCircle, PhoneCall, Timer, AlarmClock, UserPlus } from "lucide-react";
import { api, fmtDuration } from "../lib/api";

export const reportWaHref = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export const DailyReportCard = () => {
  const [report, setReport] = useState(null);

  useEffect(() => {
    api.get("/reports/daily", { params: { tz_offset: new Date().getTimezoneOffset() } })
      .then((r) => setReport(r.data)).catch(() => setReport(false));
  }, []);

  if (!report) return null;
  const y = report.yesterday;

  return (
    <div data-testid="daily-report-card" className="overflow-hidden rounded-xl border border-brand/25 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-brand-light/60 px-5 py-4">
        <CalendarDays className="h-5 w-5 text-brand" />
        <div>
          <div className="text-sm font-bold text-slate-900">Daily Report · {report.date}</div>
          <div className="text-[11px] text-slate-500">Auto-prepared every morning at 9 AM</div>
        </div>
        <a
          href={reportWaHref(report.whatsapp_text)}
          target="_blank"
          rel="noreferrer"
          data-testid="daily-report-wa-btn"
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
        >
          <MessageCircle className="h-4 w-4" /> Send on WhatsApp
        </a>
      </div>
      <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <PhoneCall className="h-3 w-3" /> Yesterday's calls
          </div>
          <div className="mt-1 text-xl font-bold text-slate-900" data-testid="report-yesterday-calls">{y.calls}</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <Timer className="h-3 w-3" /> Talk time
          </div>
          <div className="mt-1 text-xl font-bold text-slate-900">{fmtDuration(y.talk_time)}</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <UserPlus className="h-3 w-3" /> New leads
          </div>
          <div className="mt-1 text-xl font-bold text-slate-900">{y.new_leads}</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <AlarmClock className="h-3 w-3" /> Follow-ups today
          </div>
          <div className="mt-1 text-xl font-bold text-slate-900">
            {report.today_followups.length}
            {report.overdue_followups.length > 0 && (
              <span className="ml-2 text-sm font-semibold text-rose-600">+{report.overdue_followups.length} overdue</span>
            )}
          </div>
        </div>
      </div>
      {y.per_agent.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3">
          {y.per_agent.map((a) => (
            <span key={a.name} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
              <b className="text-slate-800">{a.name}</b> · {a.calls} calls · {fmtDuration(a.talk_time)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
