import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, X, Users, Megaphone, AlarmClock, Inbox, MessageCircle,
} from "lucide-react";
import { api, fmtDate } from "../lib/api";

const SEEN_KEY = "upr_notif_seen";

// Fixed bell + slide-in panel on the right edge of the screen. It sits on
// top of the existing interface (fixed positioning, high z-index) and never
// touches the layout underneath it — same pattern as ReminderBell/OfflineBanner.
export const NotificationBar = () => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ leads_assigned_count: 0, leads_assigned: [], alerts: [], followups: [], messages: [] });
  const [loaded, setLoaded] = useState(false);
  const navigate = useNavigate();
  const lastSeenRef = useRef(Number(localStorage.getItem(SEEN_KEY) || 0));

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const { data: d } = await api.get("/notifications");
        if (!alive) return;
        setData(d);
        setLoaded(true);
      } catch {
        // ignore transient poll errors — keep showing last known state
      }
    };
    poll();
    const t = setInterval(poll, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const isDue = (iso) => iso && new Date(iso).getTime() <= Date.now();
  const isNew = (iso) => iso && new Date(iso).getTime() > lastSeenRef.current;

  const unseenLeads = data.leads_assigned.filter((l) => isNew(l.assigned_at)).length;
  const unseenAlerts = data.alerts.filter((a) => isNew(a.created_at)).length;
  const dueFollowups = data.followups.filter((f) => isDue(f.follow_up_at)).length;
  const unseenMessages = (data.messages || []).filter((m) => isNew(m.created_at)).length;
  const badgeCount = unseenLeads + unseenAlerts + dueFollowups + unseenMessages;

  const hasAny = data.leads_assigned.length > 0 || data.alerts.length > 0 || data.followups.length > 0 || (data.messages || []).length > 0;

  const togglePanel = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      const now = Date.now();
      lastSeenRef.current = now;
      localStorage.setItem(SEEN_KEY, String(now));
    }
  };

  const openLead = (id) => {
    setOpen(false);
    navigate(`/leads/${id}`);
  };

  const openChat = (groupId) => {
    setOpen(false);
    navigate(`/chat?open=${groupId}`);
  };

  return (
    <>
      <button
        onClick={togglePanel}
        data-testid="notification-bell-btn"
        aria-label="Notifications"
        className="fixed right-4 top-3 z-[70] grid h-11 w-11 place-items-center rounded-full border border-slate-200 bg-white shadow-lg transition-transform hover:scale-105 lg:right-6"
      >
        <Bell className="h-5 w-5 text-slate-600" />
        {badgeCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[75] bg-slate-900/30" onClick={() => setOpen(false)} />
      )}

      <aside
        data-testid="notification-panel"
        className={`fixed inset-y-0 right-0 z-[80] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Bell className="h-4 w-4 text-brand" /> Notifications
          </div>
          <button onClick={() => setOpen(false)} data-testid="notification-panel-close">
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {!loaded && (
            <div className="py-10 text-center text-sm text-slate-400">Loading…</div>
          )}

          {loaded && !hasAny && (
            <div className="flex flex-col items-center gap-2 py-16 text-center" data-testid="no-notifications">
              <Inbox className="h-8 w-8 text-slate-300" />
              <div className="text-sm font-medium text-slate-400">No notifications.</div>
            </div>
          )}

          {loaded && hasAny && (
            <>
              {/* Chat messages */}
              <section>
                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <MessageCircle className="h-3.5 w-3.5" /> Messages
                </div>
                {(data.messages || []).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-400">
                    No new messages.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {data.messages.map((m) => (
                      <button
                        key={m.group_id}
                        onClick={() => openChat(m.group_id)}
                        data-testid={`notif-message-${m.group_id}`}
                        className="flex w-full flex-col gap-0.5 rounded-lg border border-slate-100 px-3 py-2 text-left text-xs hover:bg-slate-50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-medium text-slate-700">
                            {m.is_dm ? `${m.from_name} has a new message for you` : `New message in ${m.thread_label} from ${m.from_name}`}
                          </span>
                          <span className="shrink-0 text-slate-400">{fmtDate(m.created_at)}</span>
                        </div>
                        {m.text && <span className="truncate text-slate-400">{m.text}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* Leads assigned */}
              <section>
                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Users className="h-3.5 w-3.5" /> Leads assigned
                </div>
                <div className="mb-2 rounded-lg bg-brand-light px-3 py-2 text-sm font-semibold text-brand">
                  {data.leads_assigned_count} lead{data.leads_assigned_count === 1 ? "" : "s"} assigned to you
                </div>
                {data.leads_assigned.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-400">
                    No leads assigned yet.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {data.leads_assigned.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => openLead(l.id)}
                        data-testid={`notif-lead-${l.id}`}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-left text-xs hover:bg-slate-50"
                      >
                        <span className="min-w-0 truncate font-medium text-slate-700">{l.name || l.phone || "Lead"}</span>
                        <span className="shrink-0 text-slate-400">{fmtDate(l.assigned_at)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* Alerts */}
              <section>
                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Megaphone className="h-3.5 w-3.5" /> Alerts
                </div>
                {data.alerts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-400">
                    No alerts right now.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {data.alerts.map((a) => (
                      <div
                        key={a._id}
                        data-testid={`notif-alert-${a._id}`}
                        className={`rounded-lg border px-3 py-2 text-xs ${
                          a.priority === "high"
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-slate-100 text-slate-600"
                        }`}
                      >
                        <div className="font-medium">{a.message}</div>
                        <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                          <span>{a.from_name || "Admin"}</span>
                          <span>{fmtDate(a.created_at)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Follow-ups */}
              <section>
                <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <AlarmClock className="h-3.5 w-3.5" /> Follow-ups
                </div>
                {data.followups.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-400">
                    No follow-ups scheduled.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {data.followups.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => openLead(f.id)}
                        data-testid={`notif-followup-${f.id}`}
                        className={`flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left text-xs hover:bg-slate-50 ${
                          isDue(f.follow_up_at) ? "border-amber-300 bg-amber-50" : "border-slate-100"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate font-medium text-slate-700">{f.name || f.phone || "Lead"}</span>
                          <span className="shrink-0 text-slate-400">{fmtDate(f.follow_up_at)}</span>
                        </div>
                        {f.follow_up_note && (
                          <span className="truncate text-slate-400">{f.follow_up_note}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
};
