import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Phone, Timer } from "lucide-react";
import { api, fmtDuration, fmtDate } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { StatCard } from "../components/StatCard";
import { RecordingPlayer } from "../components/RecordingPlayer";
import { Badge } from "../components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";

export default function Calls() {
  const { isAdmin } = useAuth();
  const [calls, setCalls] = useState(null);
  const [agents, setAgents] = useState([]);
  const [agent, setAgent] = useState("all");

  useEffect(() => {
    api.get("/calls", { params: agent !== "all" ? { agent_id: agent } : {} })
      .then((r) => setCalls(r.data)).catch(() => setCalls(false));
  }, [agent]);

  useEffect(() => {
    if (isAdmin) api.get("/users").then((r) => setAgents(r.data.filter((u) => u.role === "agent")));
  }, [isAdmin]);

  const totals = useMemo(() => {
    const done = (calls || []).filter((c) => c.status === "completed");
    const talk = done.reduce((a, c) => a + (c.duration || 0), 0);
    return { count: done.length, talk, avg: done.length ? Math.round(talk / done.length) : 0 };
  }, [calls]);

  return (
    <div className="space-y-5" data-testid="calls-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Call Logs &amp; Talk Time</h1>
          <p className="mt-1.5 text-sm text-slate-500">Every conversation, duration and outcome.</p>
        </div>
        {isAdmin && (
          <Select value={agent} onValueChange={setAgent}>
            <SelectTrigger className="w-56" data-testid="calls-agent-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard testId="calls-kpi-count" label="Completed Calls" value={totals.count} icon={Phone} />
        <StatCard testId="calls-kpi-talk" label="Total Talk Time" value={fmtDuration(totals.talk)} icon={Timer} accent="amber" delay={60} />
        <StatCard testId="calls-kpi-avg" label="Average Call" value={fmtDuration(totals.avg)} icon={Timer} accent="slate" delay={120} />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-5 py-3 text-left">Lead</th>
                <th className="px-3 py-3 text-left">Agent</th>
                <th className="px-3 py-3 text-left">Outcome</th>
                <th className="px-3 py-3 text-left">Recording</th>
                <th className="px-3 py-3 text-right">Duration</th>
                <th className="px-5 py-3 text-right">Started</th>
              </tr>
            </thead>
            <tbody>
              {calls === null && (
                <tr><td colSpan={6} className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand" /></td></tr>
              )}
              {calls?.length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center text-slate-400">No calls logged yet.</td></tr>
              )}
              {calls?.map((c) => (
                <tr key={c._id} data-testid={`call-row-${c._id}`} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-2.5">
                    <Link to={`/leads/${c.lead_id}`} className="font-medium text-slate-800 hover:text-brand">{c.lead_name}</Link>
                    <div className="text-[11px] text-slate-400">{c.lead_phone}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{c.agent_name}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className="border-slate-200 text-slate-600">{c.outcome || c.status}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    {c.has_recording ? <RecordingPlayer callId={c._id} compact /> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{fmtDuration(c.duration)}</td>
                  <td className="px-5 py-2.5 text-right text-xs text-slate-400">{fmtDate(c.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
