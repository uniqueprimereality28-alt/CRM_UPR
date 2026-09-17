"""
Unique Prime Reality - Voice Agent Single-Process Runner
Runs the lightweight HTTP health server on $PORT for Render and the LiveKit Agent Worker in a single Python process.
Uses ~220MB RAM, safely within Render's 512MB free tier (no subprocess duplication, no OOM crashes).
"""
import json
import os
import sys
import threading
import time
from http.server import HTTPServer, BaseHTTPRequestHandler

# Optimize Python memory allocation before imports
os.environ.setdefault("MALLOC_ARENA_MAX", "2")
os.environ.setdefault("PYTHONMALLOC", "malloc")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")
os.environ.setdefault("LIVEKIT_NUM_IDLE_PROCESSES", "0")

try:
    import psutil
    _PROCESS = psutil.Process()
except Exception:
    psutil = None
    _PROCESS = None


class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/memory":
            rss = round(_PROCESS.memory_info().rss / (1024 * 1024), 1) if _PROCESS else 0.0
            body = json.dumps({
                "status": "ok",
                "rss_mb": rss,
                "process_pid": os.getpid(),
                "mode": "single_process",
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        body = json.dumps({
            "status": "healthy",
            "service": "upr-voice-agent",
            "mode": "single_process",
            "message": "Voice agent worker running in single process",
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        # Suppress noisy Render health-check access logs
        pass


def start_health_server():
    port = int(os.getenv("PORT", 10000))
    try:
        server = HTTPServer(("0.0.0.0", port), HealthHandler)
        print(f"[runner] Embedded HTTP Health Server listening on port {port}...", flush=True)
        server.serve_forever()
    except Exception as e:
        print(f"[runner] Embedded health server notice on port {port}: {e}", flush=True)


if __name__ == "__main__":
    # 1. Start HTTP server for Render health checks on daemon thread
    t = threading.Thread(target=start_health_server, daemon=True)
    t.start()

    # 2. Ensure start command argument is present for LiveKit CLI
    if len(sys.argv) <= 1:
        sys.argv = [sys.argv[0], "start"]

    # 3. Import and run agent worker in the main thread (Single Process)
    import agent
    agent.run_app_main()
