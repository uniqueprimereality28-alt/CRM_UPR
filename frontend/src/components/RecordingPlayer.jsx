import { useEffect, useState } from "react";
import { Loader2, Headphones } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";

export const RecordingPlayer = ({ callId, compact = false }) => {
  const [state, setState] = useState("idle"); // idle | loading | ready
  const [url, setUrl] = useState(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const load = async () => {
    setState("loading");
    try {
      const r = await api.get(`/calls/${callId}/recording`, { responseType: "blob" });
      setUrl(URL.createObjectURL(r.data));
      setState("ready");
    } catch {
      toast.error("Could not load recording");
      setState("idle");
    }
  };

  if (state === "ready")
    return (
      <audio
        src={url}
        controls
        autoPlay
        className={compact ? "h-8 w-[210px]" : "h-9 w-full max-w-[260px]"}
        data-testid={`recording-audio-${callId}`}
      />
    );

  return (
    <button
      onClick={load}
      disabled={state === "loading"}
      data-testid={`play-recording-${callId}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-light px-3 py-1 text-xs font-semibold text-brand transition-colors hover:bg-brand hover:text-white disabled:opacity-60"
    >
      {state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Headphones className="h-3.5 w-3.5" />}
      Listen
    </button>
  );
};
