import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { api, apiError } from "../lib/api";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/**
 * Admin-only dialog for logging a manual talk-time adjustment — e.g. to
 * account for time lost to a system problem. This never creates a call or
 * changes a lead's status; it writes one auditable record (minutes, date,
 * reason, added by) that shows up as a clearly separate figure on the
 * agent's dashboard, never blended silently into real call history.
 */
export function ManualTalkTimeDialog({ open, onOpenChange, agentId, agentName, onSaved }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [minutes, setMinutes] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayIso);
  const [saving, setSaving] = useState(false);

  const reset = () => { setMinutes(""); setReason(""); setDate(todayIso); };

  const submit = async () => {
    const mins = parseFloat(minutes);
    if (!mins || mins <= 0) return toast.error("Enter a number of minutes greater than 0");
    if (mins > 240) return toast.error("Single adjustment can't exceed 240 minutes");
    if (reason.trim().length < 5) return toast.error("Please give a reason of at least 5 characters");

    setSaving(true);
    try {
      await api.post(`/agents/${agentId}/talk-time-adjustments`, {
        minutes: mins, reason: reason.trim(), adjustment_date: date,
      });
      toast.success(`Added ${mins} min manual adjustment for ${agentName}`);
      reset();
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add manual talk-time adjustment</DialogTitle>
          <DialogDescription>
            For {agentName}. This adds a labeled correction on top of their real logged
            calls — it does not create any call record or change any lead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Use this only for genuine system/logging errors (e.g. an outage). It will be
              permanently visible in the audit trail with your name and the reason below.
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mtt-minutes">Minutes to add</Label>
            <Input
              id="mtt-minutes" type="number" min="0" max="240" step="0.5"
              placeholder="e.g. 35" value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mtt-date">Date this adjustment is for</Label>
            <Input id="mtt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mtt-reason">Reason (required)</Label>
            <Textarea
              id="mtt-reason" rows={3}
              placeholder="e.g. System outage during duplicate-lead restore, 2026-08-23"
              value={reason} onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Add adjustment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
