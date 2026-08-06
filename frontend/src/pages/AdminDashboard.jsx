import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Contact, Trophy, PhoneCall, Timer, UserCheck, Wallet, TrendingUp, Loader2, AlertCircle, Copy, CalendarClock,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDuration, fmtMoney, fmtDate, STATUS_META } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { StatCard } from "../components/StatCard";
import { DailyReportCard } from "../components/DailyReportCard";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";

const PIE_COLORS = ["#1a3fbf", "#10b981", "#f59e0b", "#64748b", "#0ea5e9", "#8b5cf6", "#ef4444"];

export default function AdminDashboard() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [dupBusy, setDupBusy] = useState(false);

  useEffect(() => {
    api.get("/dashboard/admin").then((r) => setData(r.data)).catch(() => setData(false));
  }, []);

  const removeDuplicates = async () => {
    setDupBusy(true);
    try {
      const { data: res } = await api.post("/leads/duplicates/clear", { keep: "oldest" });
      if (res.removed > 0) {
        toast.success(`${res.removed} duplicate lead(s) removed`);
      } else {
        toast.success("No duplicates found — your data is clean");
      }
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally { setDupBusy(false); }
  };

  if (data === null)
    return <div className="grid h-64 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>;
  if (data === false)
    return <div className="text-sm text-rose-600">Could not load dashboard.</div>;

  const k = data.kpis;

  return (
    <div className="space-y-6" data-testid="admin-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Command Center</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Full visibility across leads, sales team performance and talk time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Button
              onClick={removeDuplicates}
              disabled={dupBusy}
              data-testid="remove-duplicates-btn"
              variant="outline"
              className="gap-2 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            >
              {dupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
              Remove duplicates
            </Button>
          )}
          <Link
            to="/leads?unassigned=1"
            data-testid="unassigned-shortcut"
            className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100"
          >
            <AlertCircle className="h-4 w-4" /> {k.unassigned} unassigned leads
          </Link>
        </div>
      </div>

      <DailyReportCard />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard testId="kpi-total-leads" label="Total Leads" value={k.total_leads}
          sub={`${k.active_leads} active in pipeline`} icon={Contact} delay={0} />
        <StatCard testId="kpi-conversion" label="Conversion" value={`${k.conversion}%`}
          sub={`${k.won} deals won`} icon={Trophy} accent="emerald" delay={60} />
        <StatCard testId="kpi-talk-time" label="Total Talk Time" value={fmtDuration(k.total_talk_time)}
          sub={`${k.total_calls} calls · avg ${fmtDuration(k.avg_call)}`} icon={Timer} accent="amber" delay={120} />
        <StatCard testId="kpi-agents" label="Sales Team" value={k.active_agents}
          sub={`${k.agents} total accounts`} icon={UserCheck} accent="slate" delay={180} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard testId="kpi-today-talk-time" label="Today's Talk Time" value={fmtDuration(k.today_total_talk_time)}
          sub={`${k.today_total_calls} calls today · all agents`} icon={CalendarClock} accent="amber" delay={90} />
        <StatCard testId="kpi-pipeline" label="Pipeline Value" value={fmtMoney(k.pipeline_value)}
          sub="Open opportunities" icon={Wallet} delay={200} />
        <StatCard testId="kpi-won-value" label="Closed Value" value={fmtMoney(k.won_value)}
          sub="Won deals" icon={TrendingUp} accent="emerald" delay={240} />
        <StatCard testId="kpi-calls" label="Calls Logged" value={k.total_calls}
          sub="Across all agents" icon={PhoneCall} accent="slate" delay={280} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="text-lg font-semibold text-slate-900">Leads &amp; Talk Time · Last 14 days</h3>
          <div className="mt-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trend}>
                <defs>
                  <linearGradient id="gLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1a3fbf" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#1a3fbf" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gTalk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="leads" name="New leads" stroke="#1a3fbf" strokeWidth={2} fill="url(#gLeads)" />
                <Area type="monotone" dataKey="talk_minutes" name="Talk (min)" stroke="#10b981" strokeWidth={2} fill="url(#gTalk)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Lead Sources</h3>
          <div className="mt-2 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.by_source} dataKey="count" nameKey="source" innerRadius={52} outerRadius={82} paddingAngle={3}>
                  {data.by_source.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Pipeline by Stage</h3>
          <div className="mt-5 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_status.map((s) => ({ ...s, label: STATUS_META[s.status]?.label || s.status }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={54} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Bar dataKey="count" name="Leads" fill="#1a3fbf" radius={[5, 5, 0, 0]} barSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-2" data-testid="leaderboard">
          <div className="flex items-center justify-between border-b border-slate-200 p-5">
            <h3 className="text-lg font-semibold text-slate-900">Sales Team Leaderboard</h3>
            <Link to="/team" className="text-xs font-semibold text-brand hover:underline">Manage team →</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2.5 text-center">Rank</th>
                  <th className="px-5 py-2.5 text-left">Agent</th>
                  <th className="px-3 py-2.5 text-right">Leads</th>
                  <th className="px-3 py-2.5 text-right">Won</th>
                  <th className="px-3 py-2.5 text-right">Conv.</th>
                  <th className="px-3 py-2.5 text-right">Talk time</th>
                  <th className="px-3 py-2.5 text-right">Today</th>
                  <th className="px-5 py-2.5 text-right">Closed</th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-400">No agents yet.</td></tr>
                )}
                {data.leaderboard.map((a, i) => (
                  <tr key={a.agent_id} data-testid={`leaderboard-row-${i}`} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50">
                    <td className="px-3 py-3 text-center" data-testid={`leaderboard-rank-${i}`}>
                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        a.rank === 1 ? "bg-amber-100 text-amber-700" :
                        a.rank === 2 ? "bg-slate-200 text-slate-600" :
                        a.rank === 3 ? "bg-orange-100 text-orange-700" : "text-slate-400"
                      }`}>
                        {a.rank <= 3 ? ["🥇", "🥈", "🥉"][a.rank - 1] : `#${a.rank}`}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <Link to={`/team/${a.agent_id}`} className="flex items-center gap-3">
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-light text-xs font-bold text-brand">
                          {a.name.slice(0, 1)}
                        </div>
                        <div>
                          <div className="font-medium text-slate-800 hover:text-brand">{a.name}</div>
                          <div className="text-[11px] text-slate-400">{a.username}</div>
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600">{a.leads}</td>
                    <td className="px-3 py-3 text-right font-semibold text-emerald-600">{a.won}</td>
                    <td className="px-3 py-3 text-right text-slate-600">{a.conversion}%</td>
                    <td className="px-3 py-3 text-right font-medium text-slate-800">{fmtDuration(a.talk_time)}</td>
                    <td className="px-3 py-3 text-right text-slate-600" data-testid={`leaderboard-today-${i}`}>
                      {a.today_calls} calls · {fmtDuration(a.today_talk_time)}
                    </td>
                    <td className="px-5 py-3 text-right text-slate-600">{fmtMoney(a.won_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <h3 className="text-lg font-semibold text-slate-900">Recent Calls</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {data.recent_calls.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-400">No calls recorded yet.</div>
          )}
          {data.recent_calls.map((c) => (
            <div key={c._id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50">
              <PhoneCall className="h-4 w-4 text-brand" />
              <Link to={`/leads/${c.lead_id}`} className="font-medium text-slate-800 hover:text-brand">{c.lead_name}</Link>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500">{c.agent_name}</span>
              <Badge variant="outline" className="ml-auto border-slate-200 text-slate-600">{fmtDuration(c.duration)}</Badge>
              <span className="w-40 text-right text-xs text-slate-400">{fmtDate(c.started_at)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
