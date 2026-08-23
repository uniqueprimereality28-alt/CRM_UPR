import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { api, apiError, fmtDate } from "../lib/api";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

/**
 * Read-only(ish) audit trail for an agent's manual talk-time adjustments.
 * Reversing an entry never deletes it — it just stops counting toward the
 * agent's totals, so the "who added what, and why" history is permanent.
 */
export function AdjustmentHistoryDialog({ open, onOpenChange, agentName, history, onReversed }) {
  const reverse = async (id) => {
    if (!window.confirm("Reverse this adjustment? It will stop counting toward talk time, but stays visible in the history.")) return;
    try {
      await api.post(`/talk-time-adjustments/${id}/reverse`);
      toast.success("Adjustment reversed");
      onReversed?.();
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manual talk-time adjustments</DialogTitle>
          <DialogDescription>Full history for {agentName}.</DialogDescription>
        </DialogHeader>

        <div className="max-h-96 space-y-2 overflow-y-auto">
          {history === null && <div className="py-6 text-center text-sm text-slate-400">Loading…</div>}
          {history?.length === 0 && <div className="py-6 text-center text-sm text-slate-400">No manual adjustments yet.</div>}
          {history?.map((h) => (
            <div key={h._id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800">
                  +{h.minutes} min <span className="text-slate-400">on {h.adjustment_date}</span>
                </span>
                {h.reversed ? (
                  <Badge variant="outline" className="border-slate-200 text-slate-500">Reversed</Badge>
                ) : (
                  <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-slate-500" onClick={() => reverse(h._id)}>
                    <Undo2 className="h-3 w-3" /> Reverse
                  </Button>
                )}
              </div>
              <div className="mt-1 text-slate-600">{h.reason}</div>
              <div className="mt-1 text-[11px] text-slate-400">
                Added by {h.added_by} · {fmtDate(h.created_at)}
                {h.reversed && ` · Reversed by ${h.reversed_by} · ${fmtDate(h.reversed_at)}`}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
