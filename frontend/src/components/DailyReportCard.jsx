import { useEffect, useState, useCallback } from "react";
import { CalendarDays, MessageCircle, PhoneCall, Timer, AlarmClock, UserPlus, FileText } from "lucide-react";
import { api, fmtDuration } from "../lib/api";

export const reportWaHref = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`;

// Still used to build the plain-text link we drop into the WhatsApp message
// (wa.me can only pre-fill text, so this URL is just shown as a reference).
const dailyReportPdfUrl = () => {
  const base = api.defaults.baseURL?.replace(/\/$/, "") || "";
  return `${base}/reports/daily/pdf?tz_offset=${new Date().getTimezoneOffset()}`;
};

export const DailyReportCard = () => {
  const [report, setReport] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    api.get("/reports/daily", { params: { tz_offset: new Date().getTimezoneOffset() } })
      .then((r) => setReport(r.data)).catch(() => setReport(false));
  }, []);

  // The PDF button now goes through the same authenticated axios instance
  // as the rest of the app (Bearer token from localStorage), instead of a
  // plain <a href> link — a raw link navigation never sends the
  // Authorization header, and cross-domain cookies aren't reliable enough
  // to depend on alone.
  const handleDownloadPdf = useCallback(async () => {
    setPdfLoading(true);
    try {
      const res = await api.get("/reports/daily/pdf", {
        params: { tz_offset: new Date().getTimezoneOffset() },
        responseType: "blob",
      });
      const blobUrl = URL.createObjectURL(res.data);
      window.open(blobUrl, "_blank", "noreferrer");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (e) {
      alert("Couldn't open the PDF report. Please make sure you're logged in and try again.");
    } finally {
      setPdfLoading(false);
    }
  }, []);

  if (!report) return null;
  const y = report.yesterday;
  const pdfUrl = dailyReportPdfUrl();

  const whatsappText = `${report.whatsapp_text}\n\n📄 Full report (PDF): ${pdfUrl}`;

  return (
    <div data-testid="daily-report-card" className="overflow-hidden rounded-xl border border-brand/25 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-brand-light/60 px-5 py-4">
        <CalendarDays className="h-5 w-5 text-brand" />
        <div>
          <div className="text-sm font-bold text-slate-900">Daily Report · {report.date}</div>
          <div className="text-[11px] text-slate-500">Auto-prepared every morning at 9 AM</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={pdfLoading}
            data-testid="daily-report-pdf-btn"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            <FileText className="h-4 w-4" /> {pdfLoading ? "Opening…" : "PDF"}
          </button>
          
            href={reportWaHref(whatsappText)}
            target="_blank"
            rel="noreferrer"
            data-testid="daily-report-wa-btn"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
          >
            <MessageCircle className="h-4 w-4" /> Send on WhatsApp
          </a>
        </div>
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
