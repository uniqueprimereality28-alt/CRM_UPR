import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Phone, Contact, Trophy, Timer, Wallet } from "lucide-react";
import { api, fmtDuration, fmtMoney, fmtDate, STATUS_META } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { Badge } from "../components/ui/badge";

export default function AgentDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get(`/dashboard/agent/${id}`).then((r) => setData(r.data)).catch(() => setData(false));
  }, [id]);

  if (data === null)
    return <div className="grid h-64 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>;
  if (data === false) return <div className="text-sm text-rose-600">Agent not found.</div>;

  const { agent, stats } = data;

  return (
    <div className="space-y-6" data-testid="agent-detail-page">
      <Link to="/team" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> Back to team
      </Link>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-brand-light text-lg font-bold text-brand">
          {agent.name.slice(0, 1)}
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{agent.name}</h1>
          <div className="mt-1 text-sm text-slate-500">
            {agent.username} {agent.email && `· ${agent.email}`} {agent.phone && `· ${agent.phone}`}
          </div>
        </div>
        <Badge variant="outline" className={`ml-auto ${agent.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-500"}`}>
          {agent.active ? "Active" : "Disabled"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Leads" value={stats.leads} sub={`${stats.active} active`} icon={Contact} />
        <StatCard label="Won" value={stats.won} sub={`${stats.conversion}% conversion`} icon={Trophy} accent="emerald" delay={60} />
        <StatCard label="Talk time" value={fmtDuration(stats.talk_time)} sub={`${stats.calls} calls`} icon={Timer} accent="amber" delay={120} />
        <StatCard label="Avg call" value={fmtDuration(stats.avg_call)} sub="Per connected call" icon={Phone} accent="slate" delay={180} />
        <StatCard label="Pipeline" value={fmtMoney(stats.pipeline_value)} sub={`Closed ${fmtMoney(stats.won_value)}`} icon={Wallet} delay={240} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5"><h3 className="text-lg font-semibold">Assigned leads</h3></div>
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {data.leads.length === 0 && <div className="p-6 text-sm text-slate-400">No leads assigned.</div>}
            {data.leads.map((l) => (
              <Link key={l.id} to={`/leads/${l.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50">
                <div className="min-w-32">
                  <div className="font-medium text-slate-800">{l.name}</div>
                  <div className="text-[11px] text-slate-400">{l.phone}</div>
                </div>
                <Badge variant="outline" className={STATUS_META[l.status]?.cls}>{STATUS_META[l.status]?.label}</Badge>
                <span className="ml-auto text-xs text-slate-500">{fmtMoney(l.budget)}</span>
                <span className="w-20 text-right text-xs text-slate-400">{fmtDuration(l.total_talk_time)}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5"><h3 className="text-lg font-semibold">Call log</h3></div>
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {data.calls.length === 0 && <div className="p-6 text-sm text-slate-400">No calls recorded.</div>}
            {data.calls.map((c) => (
              <div key={c._id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <Phone className="h-3.5 w-3.5 text-brand" />
                <Link to={`/leads/${c.lead_id}`} className="font-medium text-slate-800 hover:text-brand">{c.lead_name}</Link>
                <span className="ml-auto font-medium">{fmtDuration(c.duration)}</span>
                <span className="w-36 text-right text-xs text-slate-400">{fmtDate(c.started_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
