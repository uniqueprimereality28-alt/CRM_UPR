import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlarmClock, CalendarDays, MessageCircle, PhoneCall, X } from "lucide-react";
import { api, fmtDate } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { reportWaHref } from "./DailyReportCard";

export const playChime = () => {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    [880, 1174.66, 880, 1174.66, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.33;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t);
      o.stop(t + 0.32);
    });
    setTimeout(() => ctx.close(), 2200);
  } catch {
    // audio not available — visual reminder still shows
  }
};

export const ReminderBell = () => {
  const [due, setDue] = useState([]);
  const navigate = useNavigate();
  const notifiedRef = useRef(new Set());

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const { data } = await api.get("/followups/due");
        if (!active) return;
        setDue(data);
        if (data.length > 0) {
          playChime();
          data.forEach((l) => {
            if (!notifiedRef.current.has(l.id) && "Notification" in window &&
                Notification.permission === "granted") {
              new Notification("Follow-up call due — Unique Prime Reality", {
                body: `${l.name} · ${l.phone}\nScheduled: ${fmtDate(l.follow_up_at)}`,
              });
              notifiedRef.current.add(l.id);
            }
          });
        }
      } catch {
        // ignore transient poll errors
      }
    };
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    poll();
    const t = setInterval(poll, 30000);
    return () => { active = false; clearInterval(t); };
  }, []);

  const ack = async (id) => {
    try { await api.post(`/followups/${id}/ack`); } catch { /* ignore */ }
    setDue((d) => d.filter((l) => l.id !== id));
  };

  const openLead = async (l) => {
    await ack(l.id);
    navigate(`/leads/${l.id}`);
  };

  if (due.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[60] w-[350px] max-w-[calc(100vw-2rem)] space-y-3" data-testid="reminder-popup">
      {due.map((l) => (
        <div key={l.id} data-testid={`reminder-item-${l.id}`}
          className="animate-in slide-in-from-bottom-4 rounded-2xl border border-amber-400/40 bg-slate-900 p-4 text-white shadow-2xl">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-amber-400">
              <AlarmClock className="h-5 w-5 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-widest">Follow-up call due</span>
            </div>
            <button onClick={() => ack(l.id)} data-testid={`reminder-dismiss-${l.id}`}
              className="text-slate-400 transition-colors hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 text-lg font-bold">{l.name}</div>
          <div className="text-sm text-slate-300">{l.phone} · {fmtDate(l.follow_up_at)}</div>
          {l.follow_up_note && (
            <div className="mt-1 rounded-lg bg-white/10 px-2 py-1 text-xs text-slate-200">“{l.follow_up_note}”</div>
          )}
          <button onClick={() => openLead(l)} data-testid={`reminder-open-${l.id}`}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-600">
            <PhoneCall className="h-4 w-4" /> Call now
          </button>
        </div>
      ))}
    </div>
  );
};
