import { useEffect, useState } from "react";
import { Loader2, Bot, User2, MessageCircle, PhoneForwarded, Wallet, MapPin, Home, Car, CalendarClock, Clock } from "lucide-react";
import { api, apiError, fmtMoney, fmtDate } from "../../lib/api";
import { tempMeta, DISPO_META } from "../../lib/ai";
import { Badge } from "../ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "../ui/dialog";
import { toast } from "sonner";

const REQ_ROWS = [
  ["ai_property_type", Home, "Property type", "property_type"],
  ["ai_bhk", Home, "BHK", "bhk"],
  ["ai_budget", Wallet, "Budget", "budget"],
  ["ai_location_preference", MapPin, "Location", "location_preference"],
  ["ai_parking", Car, "Parking", "parking"],
  ["ai_possession_timeline", CalendarClock, "Possession", "possession_timeline"],
];

export const TranscriptDialog = ({ callId, open, onOpenChange }) => {
  const [call, setCall] = useState(null);

  useEffect(() => {
    if (!open || !callId) return;
    setCall(null);
    api.get(`/ai/calls/${callId}`)
      .then((r) => setCall(r.data))
      .catch((e) => { toast.error(apiError(e.response?.data?.detail)); onOpenChange(false); });
  }, [open, callId, onOpenChange]);

  const meta = call ? tempMeta(call.temperature) : null;
  const req = call?.requirements || {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-hidden flex flex-col" data-testid="transcript-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-brand" /> AI Call · {call?.lead_name || "…"}
          </DialogTitle>
        </DialogHeader>

        {!call ? (
          <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`${meta.cls} px-2.5 py-0.5`} data-testid="transcript-temp">
                <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label} · {call.intent_score} pts
              </Badge>
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                {DISPO_META[call.disposition] || call.disposition}
              </Badge>
              {typeof call.urgency_score === "number" && (
                <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                  Urgency {call.urgency_score}/10
                </Badge>
              )}
              <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-400">
                <Clock className="h-3 w-3" />{fmtDate(call.created_at)}
              </span>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm text-slate-700">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Call summary</div>
              {call.summary || "—"}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {REQ_ROWS.map(([_, Icon, label, key]) => {
                const val = key === "budget" ? (req.budget ? fmtMoney(req.budget) : null) : req[key];
                return (
                  <div key={label} className="rounded-lg border border-slate-200 bg-white p-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      <Icon className="h-3 w-3" /> {label}
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-800">{val || "—"}</div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-2">
              {call.wants_site_visit && <Chip>Wants site visit</Chip>}
              {call.wants_brochure && <Chip icon={MessageCircle}>Brochure / WhatsApp</Chip>}
              {call.human_transfer_required && <Chip icon={PhoneForwarded} tone="rose">Transfer to Vranda</Chip>}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Conversation transcript</div>
              <div className="space-y-2.5">
                {(call.transcript || []).map((t, i) => {
                  const isAgent = t.speaker === "agent";
                  return (
                    <div key={i} className={`flex gap-2 ${isAgent ? "" : "flex-row-reverse"}`} data-testid={`turn-${i}`}>
                      <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${isAgent ? "bg-brand-light text-brand" : "bg-emerald-50 text-emerald-600"}`}>
                        {isAgent ? <Bot className="h-3.5 w-3.5" /> : <User2 className="h-3.5 w-3.5" />}
                      </div>
                      <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${isAgent ? "rounded-tl-sm bg-brand-light text-slate-800" : "rounded-tr-sm bg-emerald-50 text-slate-800"}`}>
                        {t.text}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {call.remarks && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <b>Internal remark:</b> {call.remarks}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Chip = ({ children, icon: Icon, tone = "brand" }) => {
  const tones = {
    brand: "border-brand/20 bg-brand-light text-brand",
    rose: "border-rose-200 bg-rose-50 text-rose-700",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>
      {Icon && <Icon className="h-3 w-3" />} {children}
    </span>
  );
};
