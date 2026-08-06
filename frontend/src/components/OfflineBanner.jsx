import { useEffect, useRef, useState } from "react";
import { WifiOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { OFFLINE_EVENT, queueLength } from "../lib/offline";

// Shows "You're offline — changes are being saved" while offline, "Back
// online — syncing N changes" while the queued edits/calls are replaying,
// and a brief "all changes synced" confirmation right after they finish.
export function OfflineBanner() {
  const [offline, setOffline] = useState(typeof navigator !== "undefined" ? !navigator.onLine : false);
  const [pending, setPending] = useState(0);
  const [justSynced, setJustSynced] = useState(false);
  const prevPending = useRef(0);
  const syncedTimer = useRef(null);

  useEffect(() => {
    queueLength().then((n) => { prevPending.current = n; setPending(n); });

    const onStatus = (e) => {
      const detail = e.detail || {};
      if (typeof detail.offline === "boolean") setOffline(detail.offline);
      if (typeof detail.pending === "number") {
        if (prevPending.current > 0 && detail.pending === 0) {
          setJustSynced(true);
          clearTimeout(syncedTimer.current);
          syncedTimer.current = setTimeout(() => setJustSynced(false), 3500);
        }
        prevPending.current = detail.pending;
        setPending(detail.pending);
      }
    };
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);

    window.addEventListener(OFFLINE_EVENT, onStatus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener(OFFLINE_EVENT, onStatus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearTimeout(syncedTimer.current);
    };
  }, []);

  if (!offline && pending === 0 && !justSynced) return null;

  if (offline) {
    return (
      <div data-testid="offline-banner" className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-xs font-semibold text-white">
        <WifiOff className="h-3.5 w-3.5 shrink-0" />
        <span>You're offline — changes are being saved{pending > 0 ? ` (${pending} queued)` : ""}</span>
      </div>
    );
  }

  if (pending > 0) {
    return (
      <div data-testid="offline-banner" className="flex items-center justify-center gap-2 bg-sky-500 px-4 py-2 text-center text-xs font-semibold text-white">
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
        <span>Back online — syncing {pending} change{pending === 1 ? "" : "s"}…</span>
      </div>
    );
  }

  return (
    <div data-testid="offline-banner" className="flex items-center justify-center gap-2 bg-emerald-500 px-4 py-2 text-center text-xs font-semibold text-white">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
      <span>Back online — all changes synced</span>
    </div>
  );
}
