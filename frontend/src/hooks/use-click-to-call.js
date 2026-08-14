import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { api, apiError, fmtDuration, telHref, isCallablePhone } from "../lib/api";

// One-tap calling: tapping the call icon jumps straight to the phone's
// dialer — no "start call" screen, no confirmation dialog. The call is
// still logged automatically in the background (start on tap, end when the
// tab regains focus after the call) so talk-time and call-count keep
// showing up correctly on the agent/admin dashboards.
//
// Offline handling: the normal /calls/start -> /calls/{id}/end flow needs a
// server-generated call ID before the call ends, which doesn't exist if the
// device has no connection when the call starts. When that happens (or the
// start request otherwise fails to reach the server) we skip straight to
// /calls/log_offline instead, which logs the whole finished call in one
// request — sent immediately if back online by the time the call ends, or
// queued by the offline layer in lib/api.js and replayed automatically the
// moment connectivity returns.
export function useClickToCall() {
  const activeRef = useRef(null); // { call_id, lead_id, startedAt, offline }

  const finishActiveCall = useCallback(async () => {
    const active = activeRef.current;
    if (!active) return;
    activeRef.current = null;
    const duration = Math.max(1, Math.round((Date.now() - active.startedAt) / 1000));

    if (active.call_id) {
      try {
        await api.post(`/calls/${active.call_id}/end`, { duration, outcome: "connected" });
        toast.success(`Call logged · ${fmtDuration(duration)}`);
      } catch (err) {
        toast.error(apiError(err.response?.data?.detail) || "Couldn't save that call log");
      }
      return;
    }

    // No server call_id — the call was started (or is ending) with no
    // connection. Log it in one shot via the offline-safe endpoint; if the
    // device is still offline this request itself gets queued and replayed
    // automatically once connectivity returns.
    try {
      const { data } = await api.post("/calls/log_offline", {
        lead_id: active.lead_id,
        duration,
        outcome: "connected",
        started_at: new Date(active.startedAt).toISOString(),
        client_call_id: `${active.lead_id}-${active.startedAt}`,
      });
      if (data?.queued) {
        toast.success(`Call saved offline · ${fmtDuration(duration)} — will sync when back online`);
      } else {
        toast.success(`Call logged · ${fmtDuration(duration)}`);
      }
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
    // Guard against leads with a missing/malformed phone number. Without
    // this check, the dialer still opens but with nothing after the "+" —
    // that's the "just a + sign" symptom, and it's a bad-data issue, not a
    // device issue, which is why only some leads/agents ever hit it.
    if (!isCallablePhone(lead?.phone)) {
      toast.error("This lead has no valid phone number saved — please add one before calling.");
      return;
    }

    if (activeRef.current) await finishActiveCall(); // close out a stale in-progress call, just in case

    const startedAt = Date.now();
    let call_id = null;

    if (navigator.onLine) {
      try {
        const { data } = await api.post("/calls/start", { lead_id: lead.id });
        call_id = data.call_id;
      } catch (err) {
        // Logging failed (offline, permissions, etc.) — still let the agent
        // dial out. finishActiveCall() falls back to /calls/log_offline
        // since call_id stays null.
      }
    }

    activeRef.current = { call_id, lead_id: lead.id, startedAt };
    window.location.href = telHref(lead.phone);
  }, [finishActiveCall]);

  return callLead;
}
