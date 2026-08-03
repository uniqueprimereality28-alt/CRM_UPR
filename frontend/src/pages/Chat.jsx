import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus, Send, Loader2, Users, Megaphone, Search, ArrowLeft, BellRing, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDate } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "../components/ui/dialog";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "../components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";

const DURATIONS = [
  { v: 6, label: "6 hours" },
  { v: 12, label: "12 hours" },
  { v: 24, label: "1 day" },
  { v: 72, label: "3 days" },
  { v: 168, label: "1 week" },
  { v: 840, label: "5 weeks" },
];

function formatRemaining(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `expires in ${Math.floor(h / 24)}d ${h % 24}h`;
  if (h >= 1) return `expires in ${h}h ${m}m`;
  return `expires in ${m}m`;
}

export default function Chat() {
  const { user, isManager } = useAuth();
  const [groups, setGroups] = useState(null);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [alerts, setAlerts] = useState([]);
  const [users, setUsers] = useState([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: "", member_ids: [] });
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertForm, setAlertForm] = useState({ message: "", target: "all", priority: "normal", duration_hours: 24 });
  const [pushEnabled, setPushEnabled] = useState(false);
  const scrollRef = useRef(null);

  // Request browser notification permission on mount, and fire native push for new alerts.
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") setPushEnabled(true);
    else if (Notification.permission === "default") {
      Notification.requestPermission().then((p) => setPushEnabled(p === "granted"));
    }
  }, []);

  const lastAlertRef = useRef(0);
  useEffect(() => {
    if (!alerts.length) return;
    if (!pushEnabled) return;
    const latest = Math.max(...alerts.map((a) => new Date(a.created_at).getTime()));
    const seen = Number(localStorage.getItem("upr_push_last") || 0);
    if (latest > seen && latest > lastAlertRef.current) {
      const fresh = alerts.filter((a) => new Date(a.created_at).getTime() > seen);
      fresh.slice(0, 3).forEach((a) => {
        try {
          new Notification("Unique Prime Reality", {
            body: `${a.from_name}: ${a.message}`,
            tag: a._id,
            badge: "/favicon.ico",
            requireInteraction: a.priority === "high",
          });
        } catch { /* ignore */ }
      });
      lastAlertRef.current = latest;
      localStorage.setItem("upr_push_last", String(latest));
    }
  }, [alerts, pushEnabled]);

  const loadGroups = useCallback(async () => {
    try {
      const { data } = await api.get("/groups");
      setGroups(data);
      if (!active && data.length > 0) setActive(data[0]);
    } catch { setGroups(false); }
  }, [active]);

  const loadMessages = useCallback(async (groupId) => {
    if (!groupId) return;
    try {
      const { data } = await api.get(`/groups/${groupId}/messages`);
      setMessages(data);
      setTimeout(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, 30);
    } catch { /* ignore */ }
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const { data } = await api.get("/alerts");
      setAlerts(data);
      localStorage.setItem("upr_alerts_seen", String(Date.now()));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadGroups(); loadAlerts(); }, [loadGroups, loadAlerts]);
  useEffect(() => { if (active) loadMessages(active._id); }, [active, loadMessages]);

  // Poll alerts every 30s for near real-time push
  useEffect(() => {
    const t = setInterval(loadAlerts, 30000);
    return () => clearInterval(t);
  }, [loadAlerts]);

  // Poll active group messages every 8s
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => loadMessages(active._id), 8000);
    return () => clearInterval(t);
  }, [active, loadMessages]);

  useEffect(() => {
    api.get("/users").then((r) => setUsers(r.data));
  }, []);

  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() || !active) return;
    try {
      const { data } = await api.post(`/groups/${active._id}/messages`, { text: text.trim() });
      setMessages((m) => [...m, data]);
      setText("");
      setTimeout(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, 30);
    } catch (e2) {
      toast.error(apiError(e2.response?.data?.detail));
    }
  };

  const createGroup = async () => {
    if (!newGroup.name.trim()) return;
    try {
      const { data } = await api.post("/groups", newGroup);
      setGroups((g) => [data, ...(g || [])]);
      setActive(data);
      setNewOpen(false);
      setNewGroup({ name: "", member_ids: [] });
      toast.success("Group created");
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  const sendAlert = async () => {
    if (!alertForm.message.trim()) return;
    try {
      await api.post("/alerts", alertForm);
      toast.success("Alert sent");
      setAlertOpen(false);
      setAlertForm({ message: "", target: "all", priority: "normal", duration_hours: 24 });
      loadAlerts();
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  return (
    <div className="space-y-5" data-testid="chat-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Team Communication</h1>
          <p className="mt-1.5 text-sm text-slate-500">Broadcast alerts and per-team chat groups.</p>
          {!pushEnabled && typeof Notification !== "undefined" && Notification.permission !== "denied" && (
            <button
              onClick={() => Notification.requestPermission().then((p) => setPushEnabled(p === "granted"))}
              data-testid="enable-push-btn"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
            >
              <BellRing className="h-3.5 w-3.5" /> Turn on push notifications for new alerts
            </button>
          )}
          {pushEnabled && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
              <BellRing className="h-3.5 w-3.5" /> Push notifications enabled
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={alertOpen} onOpenChange={setAlertOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="new-alert-btn">
                <Megaphone className="h-4 w-4" /> Send alert
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Broadcast alert</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Message</Label>
                  <Textarea data-testid="alert-message" rows={3} value={alertForm.message}
                    onChange={(e) => setAlertForm({ ...alertForm, message: e.target.value })}
                    placeholder="Reminder: Weekly team huddle at 4 PM in the main office" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Send to</Label>
                    <Select value={alertForm.target} onValueChange={(v) => setAlertForm({ ...alertForm, target: v })}>
                      <SelectTrigger data-testid="alert-target"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Everyone</SelectItem>
                        <SelectItem value="admin">Administrators</SelectItem>
                        <SelectItem value="team_lead">Team Leaders</SelectItem>
                        <SelectItem value="sales">Sales team</SelectItem>
                        <SelectItem value="employee">Employees</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Priority</Label>
                    <Select value={alertForm.priority} onValueChange={(v) => setAlertForm({ ...alertForm, priority: v })}>
                      <SelectTrigger data-testid="alert-priority"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Show for</Label>
                    <Select value={String(alertForm.duration_hours)} onValueChange={(v) => setAlertForm({ ...alertForm, duration_hours: Number(v) })}>
                      <SelectTrigger data-testid="alert-duration"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DURATIONS.map((d) => <SelectItem key={d.v} value={String(d.v)}>{d.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <div className="text-[11px] text-slate-400">Alert auto-hides after this window.</div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={sendAlert} data-testid="send-alert-btn" className="bg-brand hover:bg-brand-dark">
                  Send
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-brand hover:bg-brand-dark" data-testid="new-group-btn">
                <Plus className="h-4 w-4" /> New group
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create chat group</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Group name</Label>
                  <Input data-testid="group-name-input" value={newGroup.name}
                    onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                    placeholder="Sales Champions" />
                </div>
                <div className="space-y-1.5">
                  <Label>Add members</Label>
                  <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                    {users.filter((u) => u.id !== user?.id).map((u) => (
                      <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                        <Checkbox
                          checked={newGroup.member_ids.includes(u.id)}
                          onCheckedChange={(v) => setNewGroup({
                            ...newGroup,
                            member_ids: v ? [...newGroup.member_ids, u.id] : newGroup.member_ids.filter((x) => x !== u.id),
                          })}
                          data-testid={`group-member-${u.id}`}
                        />
                        <div className="text-sm">
                          <div className="font-medium text-slate-800">{u.name}</div>
                          <div className="text-[11px] text-slate-400">{u.username} · {u.role}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={createGroup} disabled={!newGroup.name.trim()}
                  data-testid="create-group-submit" className="bg-brand hover:bg-brand-dark">Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="chat" className="space-y-4">
        <TabsList>
          <TabsTrigger value="chat" data-testid="tab-chat">Groups</TabsTrigger>
          <TabsTrigger value="alerts" data-testid="tab-alerts">
            Alerts {alerts.length > 0 && <Badge variant="outline" className="ml-2 border-brand/30 bg-brand-light text-brand">{alerts.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat">
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            {/* Group list */}
            <div className={`${active ? "hidden lg:block" : ""} rounded-xl border border-slate-200 bg-white shadow-sm`}>
              <div className="border-b border-slate-200 p-4 text-sm font-semibold text-slate-800">Your groups</div>
              <div className="divide-y divide-slate-100">
                {groups === null && <div className="p-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-brand" /></div>}
                {groups?.length === 0 && <div className="p-6 text-center text-sm text-slate-400">No groups yet.</div>}
                {groups?.map((g) => (
                  <button key={g._id} data-testid={`group-item-${g._id}`}
                    onClick={() => setActive(g)}
                    className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                      active?._id === g._id ? "bg-brand-light" : ""
                    }`}>
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-white">
                      <Users className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-800">{g.name}</div>
                      <div className="truncate text-xs text-slate-500">{g.last_message || "No messages yet"}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Chat pane */}
            <div className={`${active ? "" : "hidden lg:flex"} flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm`}>
              {active ? (
                <>
                  <div className="flex items-center gap-3 border-b border-slate-200 p-4">
                    <button className="text-slate-500 hover:text-brand lg:hidden" onClick={() => setActive(null)} data-testid="chat-back">
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div>
                      <div className="font-semibold text-slate-900">{active.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {(active.member_names || []).slice(0, 5).join(", ")}
                        {active.member_names?.length > 5 && ` +${active.member_names.length - 5} more`}
                      </div>
                    </div>
                  </div>
                  <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4" data-testid="chat-messages">
                    {messages.length === 0 && (
                      <div className="grid h-full place-items-center text-sm text-slate-400">Start the conversation.</div>
                    )}
                    {messages.map((m) => {
                      const mine = m.sender_id === user?.id;
                      return (
                        <div key={m._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                            mine ? "bg-brand text-white" : "bg-white text-slate-800 border border-slate-200"
                          }`}>
                            {!mine && <div className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{m.sender_name}</div>}
                            <div className="whitespace-pre-wrap">{m.text}</div>
                            <div className={`mt-0.5 text-[10px] ${mine ? "text-white/70" : "text-slate-400"}`}>{fmtDate(m.created_at)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <form onSubmit={send} className="flex items-center gap-2 border-t border-slate-200 p-3">
                    <Input
                      data-testid="chat-input"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Type a message… (Enter to send)"
                    />
                    <Button type="submit" disabled={!text.trim()} data-testid="chat-send-btn" className="gap-1.5 bg-brand hover:bg-brand-dark">
                      <Send className="h-4 w-4" /> Send
                    </Button>
                  </form>
                </>
              ) : (
                <div className="grid flex-1 place-items-center text-sm text-slate-400">Pick a group to start chatting.</div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="alerts">
          <div className="space-y-2">
            {alerts.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400">No alerts yet.</div>
            )}
            {alerts.map((a) => (
              <div key={a._id} data-testid={`alert-item-${a._id}`}
                className={`flex items-start gap-3 rounded-xl border p-4 shadow-sm ${
                  a.priority === "high" ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"
                }`}>
                <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
                  a.priority === "high" ? "bg-rose-500 text-white" : "bg-brand-light text-brand"
                }`}>
                  <Megaphone className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-800">{a.from_name} <span className="text-slate-400">({a.from_role})</span></div>
                  <div className="mt-0.5 text-sm text-slate-700 whitespace-pre-wrap">{a.message}</div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {fmtDate(a.created_at)} · Target: {a.target === "admin" ? "Administrators" : a.target}
                    {a.expires_at && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500">{formatRemaining(a.expires_at)}</span>}
                  </div>
                </div>
                {a.priority === "high" && (
                  <Badge variant="outline" className="border-rose-300 bg-white text-rose-700">HIGH</Badge>
                )}
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
