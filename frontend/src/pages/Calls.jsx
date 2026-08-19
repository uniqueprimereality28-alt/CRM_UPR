import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Phone, Timer, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDuration, fmtDate } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { StatCard } from "../components/StatCard";
import { RecordingPlayer } from "../components/RecordingPlayer";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";

// Splits a total-seconds duration into minutes/seconds for the edit form,
// and the reverse — kept local to this page since nowhere else needs it.
function secToMinSec(totalSec) {
  const s = Math.max(0, Math.round(totalSec || 0));
  return { min: Math.floor(s / 60), sec: s % 60 };
}
function minSecToSec(min, sec) {
  return Math.max(0, (Number(min) || 0) * 60 + (Number(sec) || 0));
}

export default function Calls() {
  const { isAdmin } = useAuth();
  const [calls, setCalls] = useState(null);
  const [agents, setAgents] = useState([]);
  const [agent, setAgent] = useState("all");
  const [deletingId, setDeletingId] = useState(null);

  // Talk-time edit dialog state
  const [editCall, setEditCall] = useState(null); // the call object being corrected
  const [editMin, setEditMin] = useState(0);
  const [editSec, setEditSec] = useState(0);
  const [editReason, setEditReason] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

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

  const deleteCall = async (callId) => {
    setDeletingId(callId);
    try {
      await api.delete(`/calls/${callId}`);
      setCalls((prev) => (prev || []).filter((c) => c._id !== callId));
      toast.success("Call log deleted");
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally { setDeletingId(null); }
  };

  const openEdit = (call) => {
    const { min, sec } = secToMinSec(call.duration);
    setEditCall(call);
    setEditMin(min);
    setEditSec(sec);
    setEditReason("");
  };

  const closeEdit = () => {
    if (savingEdit) return;
    setEditCall(null);
  };

  const saveEdit = async () => {
    if (!editCall) return;
    const newDuration = minSecToSec(editMin, editSec);
    if (editReason.trim().length < 5) {
      toast.error("Please give a reason of at least 5 characters");
      return;
    }
    if (newDuration === editCall.duration) {
      toast.error("New duration is the same as the current duration");
      return;
    }
    setSavingEdit(true);
    try {
      await api.put(`/calls/${editCall._id}/duration`, {
        new_duration: newDuration,
        reason: editReason.trim(),
      });
      setCalls((prev) => (prev || []).map((c) => (
        c._id === editCall._id ? { ...c, duration: newDuration } : c
      )));
      toast.success("Talk time corrected");
      setEditCall(null);
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally {
      setSavingEdit(false);
    }
  };

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
                {isAdmin && <th className="px-5 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {calls === null && (
                <tr><td colSpan={isAdmin ? 7 : 6} className="p-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand" /></td></tr>
              )}
              {calls?.length === 0 && (
                <tr><td colSpan={isAdmin ? 7 : 6} className="p-10 text-center text-slate-400">No calls logged yet.</td></tr>
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
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="font-semibold text-slate-800">{fmtDuration(c.duration)}</span>
                      {c.duration_corrected && (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-amber-500" title={`Corrected by ${c.duration_corrected_by || "admin"}`}>
                          corrected
                        </span>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => openEdit(c)}
                          data-testid={`edit-duration-${c._id}`}
                          title="Correct talk time"
                          aria-label={`Correct talk time for ${c.lead_name}`}
                          className="rounded p-1 text-slate-300 transition-colors hover:text-brand"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-2.5 text-right text-xs text-slate-400">{fmtDate(c.started_at)}</td>
                  {isAdmin && (
                    <td className="px-5 py-2.5 text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            data-testid={`delete-call-${c._id}`}
                            disabled={deletingId === c._id}
                            className="text-slate-300 transition-colors hover:text-rose-500 disabled:opacity-50"
                          >
                            {deletingId === c._id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this call log?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes the call with <b>{c.lead_name}</b> ({c.lead_phone}) logged by <b>{c.agent_name}</b> on {fmtDate(c.started_at)}. This can't be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              data-testid={`confirm-delete-call-${c._id}`}
                              onClick={() => deleteCall(c._id)}
                              className="bg-rose-600 hover:bg-rose-700"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Talk-time correction dialog — admin only. Requires a reason so every
          correction is transparent, never a silent rewrite. */}
      <Dialog open={!!editCall} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent data-testid="edit-duration-dialog">
          <DialogHeader>
            <DialogTitle>Correct talk time</DialogTitle>
            <DialogDescription>
              {editCall && (
                <>Call with <b>{editCall.lead_name}</b> logged by <b>{editCall.agent_name}</b> ·
                  currently {fmtDuration(editCall.duration)}.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Corrected duration</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  value={editMin}
                  onChange={(e) => setEditMin(e.target.value)}
                  data-testid="edit-duration-minutes"
                  className="w-24"
                />
                <span className="text-sm text-slate-500">min</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={editSec}
                  onChange={(e) => setEditSec(e.target.value)}
                  data-testid="edit-duration-seconds"
                  className="w-24"
                />
                <span className="text-sm text-slate-500">sec</span>
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Reason (required, min 5 characters)</Label>
              <Textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                data-testid="edit-duration-reason"
                rows={3}
                placeholder="e.g. Agent forgot to end the call after hanging up, actual talk time was much shorter."
                className="mt-1.5"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEdit} disabled={savingEdit}>Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit} data-testid="save-duration-edit" className="gap-2 bg-brand hover:bg-brand-dark">
              {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
              {savingEdit ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
