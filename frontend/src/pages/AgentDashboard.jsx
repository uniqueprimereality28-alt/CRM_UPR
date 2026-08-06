import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Contact, Trophy, Timer, PhoneCall, Wallet, Loader2, ArrowRight, CalendarClock, MessageCircle } from "lucide-react";
import { api, fmtDuration, fmtMoney, STATUS_META } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { reportWaHref } from "../components/DailyReportCard";
import { useAuth } from "../context/AuthContext";
import { Badge } from "../components/ui/badge";

export default function AgentDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/dashboard/agent").then((r) => setData(r.data)).catch(() => setData(false));
  }, []);

  if (data === null)
    return <div className="grid h-64 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>;
  if (data === false) return <div className="text-sm text-rose-600">Could not load dashboard.</div>;

  const s = data.stats;
  const shareText = `📞 My day so far — ${s.today_calls} calls · ${fmtDuration(s.today_talk_time)} talk time.\n— ${user?.name || ""}, Unique Prime Reality`;

  return (
    <div className="space-y-6" data-testid="agent-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Hello, {user?.name?.split(" ")[0]}</h1>
          <p className="mt-1.5 text-sm text-slate-500">Your leads, your calls, your numbers.</p>
        </div>
        <a
          href={reportWaHref(shareText)}
          target="_blank"
          rel="noreferrer"
          data-testid="agent-share-day-wa-btn"
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
        >
          <MessageCircle className="h-4 w-4" /> Share today's numbers
        </a>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard testId="agent-kpi-today" label="Today's Talk Time" value={fmtDuration(s.today_talk_time)}
          sub={`${s.today_calls} calls today`} icon={CalendarClock} accent="amber" delay={0} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard testId="agent-kpi-leads" label="My Leads" value={s.leads} sub={`${s.active} active`} icon={Contact} />
        <StatCard testId="agent-kpi-won" label="Won" value={s.won} sub={`${s.conversion}% conversion`} icon={Trophy} accent="emerald" delay={60} />
        <StatCard testId="agent-kpi-talk" label="Talk Time" value={fmtDuration(s.talk_time)} sub={`avg ${fmtDuration(s.avg_call)}`} icon={Timer} accent="amber" delay={120} />
        <StatCard testId="agent-kpi-calls" label="Calls" value={s.calls} sub="Completed" icon={PhoneCall} accent="slate" delay={180} />
        <StatCard testId="agent-kpi-pipeline" label="Pipeline" value={fmtMoney(s.pipeline_value)} sub={`Closed ${fmtMoney(s.won_value)}`} icon={Wallet} delay={240} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">My Talk Time · Last 14 days</h3>
          <div className="mt-5 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Line type="monotone" dataKey="talk_minutes" name="Minutes" stroke="#1a3fbf" strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="calls" name="Calls" stroke="#64748b" strokeWidth={1.6} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">My Pipeline</h3>
          <div className="mt-5 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_status.map((x) => ({ ...x, label: STATUS_META[x.status]?.label || x.status }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={54} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Bar dataKey="count" name="Leads" fill="#1a3fbf" radius={[5, 5, 0, 0]} barSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <h3 className="text-lg font-semibold text-slate-900">Work queue</h3>
          <Link to="/leads" className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
            All my leads <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="divide-y divide-slate-100">
          {data.my_leads.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-400">No leads assigned to you yet.</div>
          )}
          {data.my_leads.map((l) => (
            <Link
              key={l.id}
              to={`/leads/${l.id}`}
              data-testid={`queue-lead-${l.id}`}
              className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-slate-50"
            >
              <div className="min-w-40">
                <div className="font-medium text-slate-800">{l.name}</div>
                <div className="text-[11px] text-slate-400">{l.phone}</div>
              </div>
              <Badge variant="outline" className={STATUS_META[l.status]?.cls}>{STATUS_META[l.status]?.label}</Badge>
              <span className="text-xs text-slate-500">{l.property_interest || "—"}</span>
              <span className="ml-auto text-xs text-slate-500">{fmtMoney(l.budget)}</span>
              <span className="w-24 text-right text-xs text-slate-400">{fmtDuration(l.total_talk_time)}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
