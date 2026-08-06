import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { api, apiError, fmtDuration, telHref } from "../lib/api";

// One-tap calling: tapping the call icon jumps straight to the phone's
// dialer — no "start call" screen, no confirmation dialog. The call is
// still logged automatically in the background (start on tap, end when the
// tab regains focus after the call) so talk-time and call-count keep
// showing up correctly on the agent/admin dashboards.
export function useClickToCall() {
  const activeRef = useRef(null); // { call_id, lead_id, startedAt }

  const finishActiveCall = useCallback(async () => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    if (!active.call_id) return; // start never made it to the server — nothing to close out
    const duration = Math.max(1, Math.round((Date.now() - active.startedAt) / 1000));
    try {
      await api.post(`/calls/${active.call_id}/end`, { duration, outcome: "connected" });
      toast.success(`Call logged · ${fmtDuration(duration)}`);
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail) || "Couldn't save that call log");
    }
  }, []);

  // Coming back to the tab/app after dialing out is our signal the call ended.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") finishActiveCall();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [finishActiveCall]);

  const callLead = useCallback(async (lead) => {
    if (activeRef.current) await finishActiveCall(); // close out a stale in-progress call, just in case

    const startedAt = Date.now();
    let call_id = null;
    try {
      const { data } = await api.post("/calls/start", { lead_id: lead.id });
      call_id = data.call_id;
    } catch (err) {
      // Logging failed (offline, permissions, etc.) — still let the agent dial out.
    }
    activeRef.current = { call_id, lead_id: lead.id, startedAt };
    window.location.href = telHref(lead.phone);
  }, [finishActiveCall]);

  return callLead;
}
