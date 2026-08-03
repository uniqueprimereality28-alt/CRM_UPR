import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlarmClock, CalendarClock, Check, Loader2, MessageCircle, PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDate, waLink, STATUS_META } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { StatCard } from "../components/StatCard";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";

const TONES = {
  overdue: { ring: "bg-rose-100 text-rose-600", border: "border-rose-200" },
  today: { ring: "bg-amber-100 text-amber-600", border: "border-amber-200" },
  upcoming: { ring: "bg-blue-50 text-brand", border: "border-slate-200" },
};

export default function Followups() {
  const { isAdmin } = useAuth();
  const [items, setItems] = useState(null);
  const [agents, setAgents] = useState([]);
  const [agent, setAgent] = useState("all");

  const load = useCallback(() => {
    api.get("/followups", { params: agent !== "all" ? { agent_id: agent } : {} })
      .then((r) => setItems(r.data)).catch(() => setItems(false));
  }, [agent]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isAdmin) api.get("/users").then((r) => setAgents(r.data.filter((u) => u.role === "agent")));
  }, [isAdmin]);

  const complete = async (id) => {
    try {
      await api.post(`/followups/${id}/complete`);
      toast.success("Follow-up marked done");
      load();
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  const now = new Date();
  const endToday = new Date(now); endToday.setHours(23, 59, 59, 999);
  const groups = { overdue: [], today: [], upcoming: [] };
  (items || []).forEach((l) => {
    const d = new Date(l.follow_up_at);
    if (d < now) groups.overdue.push(l);
    else if (d <= endToday) groups.today.push(l);
    else groups.upcoming.push(l);
  });

  const Card = ({ l, tone }) => (
    <div data-testid={`followup-card-${l.id}`}
      className={`flex flex-wrap items-center gap-3 rounded-xl border ${TONES[tone].border} bg-white p-4 shadow-sm`}>
      <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${TONES[tone].ring}`}>
        <AlarmClock className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <Link to={`/leads/${l.id}`} className="font-semibold text-slate-800 hover:text-brand" data-testid={`followup-lead-link-${l.id}`}>
          {l.name}
        </Link>
        <div className="text-xs text-slate-500">
          {l.phone}{isAdmin && l.assigned_to_name ? ` · ${l.assigned_to_name}` : ""}
        </div>
        {l.follow_up_note && <div className="mt-0.5 text-xs italic text-slate-500">“{l.follow_up_note}”</div>}
      </div>
      <div className="text-right">
        <div className="text-sm font-bold text-slate-800">{fmtDate(l.follow_up_at)}</div>
        <div className="mt-1 flex items-center justify-end gap-1.5">
          {l.brochure_sent && (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Brochure ✓</Badge>
          )}
          <Badge variant="outline" className={STATUS_META[l.status]?.cls}>{STATUS_META[l.status]?.label}</Badge>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <a href={waLink(l.phone, l.name)} target="_blank" rel="noreferrer" data-testid={`followup-wa-${l.id}`}
          className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-200 text-emerald-600 transition-colors hover:bg-emerald-50">
          <MessageCircle className="h-4 w-4" />
        </a>
        <Link to={`/leads/${l.id}`} data-testid={`followup-call-${l.id}`}
          className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white transition-colors hover:bg-brand-dark">
          <PhoneCall className="h-4 w-4" />
        </Link>
        <Button size="sm" variant="outline" onClick={() => complete(l.id)} data-testid={`followup-done-${l.id}`} className="gap-1.5">
          <Check className="h-3.5 w-3.5" /> Done
        </Button>
      </div>
    </div>
  );

  const Section = ({ title, list, tone }) => (
    <div className="space-y-3">
      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">{title} ({list.length})</h3>
      {list.length === 0
        ? <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-400">Nothing here.</div>
        : list.map((l) => <Card key={l.id} l={l} tone={tone} />)}
    </div>
  );

  return (
    <div className="space-y-6" data-testid="followups-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Follow-ups &amp; To-do</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Every scheduled call-back in one place — an alarm rings 10 minutes before each one.
          </p>
        </div>
        {isAdmin && (
          <Select value={agent} onValueChange={setAgent}>
            <SelectTrigger className="w-56" data-testid="followups-agent-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sales persons</SelectItem>
              {agents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {items === null ? (
        <div className="grid h-48 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard testId="followups-kpi-overdue" label="Overdue" value={groups.overdue.length} icon={AlarmClock} accent="rose" />
            <StatCard testId="followups-kpi-today" label="Due Today" value={groups.today.length} icon={CalendarClock} accent="amber" delay={60} />
            <StatCard testId="followups-kpi-upcoming" label="Upcoming" value={groups.upcoming.length} icon={CalendarClock} delay={120} />
          </div>
          <Section title="Overdue — call immediately" list={groups.overdue} tone="overdue" />
          <Section title="Due today" list={groups.today} tone="today" />
          <Section title="Upcoming" list={groups.upcoming} tone="upcoming" />
        </>
      )}
    </div>
  );
}
