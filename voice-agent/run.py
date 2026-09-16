"""
Production Runner for Render Web Service / Local
Runs a lightweight FastAPI HTTP health/trigger service on $PORT while managing the LiveKit agent worker process.
"""

import os
import sys
import json
import logging
import subprocess
import time
import uuid
import re
from typing import Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
os.environ.setdefault("MALLOC_ARENA_MAX", "2")
os.environ.setdefault("PYTHONMALLOC", "malloc")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")
os.environ.setdefault("LIVEKIT_NUM_IDLE_PROCESSES", "0")
import uvicorn
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("upr-voice-agent.runner")

app = FastAPI(title="Unique Prime Reality - Voice Agent Service")

PORT = int(os.getenv("PORT", 10000))
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "").strip().strip('"').strip("'")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "").strip().strip('"').strip("'")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "").strip().strip('"').strip("'")

# Auto-detect swapped LiveKit API Key and Secret
if LIVEKIT_API_SECRET.startswith("API") and not LIVEKIT_API_KEY.startswith("API"):
    LIVEKIT_API_KEY, LIVEKIT_API_SECRET = LIVEKIT_API_SECRET, LIVEKIT_API_KEY

LIVEKIT_AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "upr-calling-agent").strip().strip('"').strip("'")
VOBIZ_SIP_TRUNK_ID = (os.getenv("VOBIZ_SIP_TRUNK_ID") or os.getenv("OUTBOUND_SIP_TRUNK_ID", "")).strip().strip('"').strip("'")
VOICE_AGENT_SHARED_SECRET = os.getenv("VOICE_AGENT_SHARED_SECRET", "").strip()

worker_process: Optional[subprocess.Popen] = None


def is_livekit_configured() -> bool:
    url = os.getenv("LIVEKIT_URL", "").strip()
    key = os.getenv("LIVEKIT_API_KEY", "").strip()
    secret = os.getenv("LIVEKIT_API_SECRET", "").strip()
    return bool(url and key and secret)


def is_worker_alive() -> bool:
    global worker_process
    return worker_process is not None and worker_process.poll() is None


def launch_worker_process():
    global worker_process
    if not is_livekit_configured():
        logger.warning(
            "⚠️ LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not set in the environment.\n"
            "Please go to your Render Dashboard -> Environment tab and set:\n"
            "  LIVEKIT_URL=wss://your-project.livekit.cloud\n"
            "  LIVEKIT_API_KEY=your-api-key\n"
            "  LIVEKIT_API_SECRET=your-api-secret\n"
            "  VOBIZ_SIP_TRUNK_ID=ST_your_vobiz_trunk_id\n"
            "  DEEPGRAM_API_KEY=your-deepgram-key\n"
            "  GROK_API_KEY=your-grok-key\n"
            "  SARVAM_API_KEY=your-sarvam-key"
        )
        return False

    if is_worker_alive():
        logger.info("LiveKit worker is already running.")
        return True

    logger.info("Launching LiveKit Agent Worker (python agent.py start)...")
    agent_script = os.path.join(os.path.dirname(__file__), "agent.py")
    try:
        worker_env = os.environ.copy()
        worker_env["OMP_NUM_THREADS"] = "1"
        worker_env["MKL_NUM_THREADS"] = "1"
        worker_env["NUMEXPR_NUM_THREADS"] = "1"
        worker_env["MALLOC_ARENA_MAX"] = "2"
        worker_env["PYTHONMALLOC"] = "malloc"
        worker_env["LIVEKIT_NUM_IDLE_PROCESSES"] = "0"
        if LIVEKIT_URL:
            worker_env["LIVEKIT_URL"] = LIVEKIT_URL
        if LIVEKIT_API_KEY:
            worker_env["LIVEKIT_API_KEY"] = LIVEKIT_API_KEY
        if LIVEKIT_API_SECRET:
            worker_env["LIVEKIT_API_SECRET"] = LIVEKIT_API_SECRET
        worker_process = subprocess.Popen(
            [sys.executable, agent_script, "start"],
            stdout=sys.stdout,
            stderr=sys.stderr,
            env=worker_env,
        )
        logger.info("LiveKit Agent Worker started successfully (PID: %d)", worker_process.pid)
        return True
    except Exception as e:
        logger.error("Failed to start worker subprocess: %s", e)
        return False


@app.on_event("startup")
async def on_startup():
    logger.info("Starting up Voice Agent Service on port %d...", PORT)
    launch_worker_process()


@app.on_event("shutdown")
async def on_shutdown():
    global worker_process
    if is_worker_alive():
        logger.info("Stopping worker process...")
        worker_process.terminate()
        try:
            worker_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            worker_process.kill()


@app.get("/")
@app.get("/health")
def health():
    configured = is_livekit_configured()
    running = is_worker_alive()

    # If configured but worker died, try to restart
    if configured and not running:
        running = launch_worker_process()

    return {
        "status": "healthy" if running else ("waiting_for_configuration" if not configured else "worker_restarting"),
        "service": "upr-voice-agent",
        "livekit_configured": configured,
        "worker_running": running,
        "livekit_agent_name": LIVEKIT_AGENT_NAME,
        "livekit_url": LIVEKIT_URL,
        "livekit_key_prefix": (LIVEKIT_API_KEY[:6] + "...") if LIVEKIT_API_KEY else "not_set",
        "livekit_key_length": len(LIVEKIT_API_KEY),
        "livekit_secret_length": len(LIVEKIT_API_SECRET),
        "livekit_key_starts_with_api": LIVEKIT_API_KEY.startswith("API") if LIVEKIT_API_KEY else False,
        "vobiz_sip_trunk_id": bool(VOBIZ_SIP_TRUNK_ID),
        "message": (
            "Voice agent is live and ready for calls."
            if running
            else (
                "Missing LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET in Render Environment tab."
                if not configured
                else "Worker is starting up..."
            )
        ),
    }


@app.get("/test-agent-ws")
async def test_agent_ws():
    import jwt
    import aiohttp
    
    livekit_url = LIVEKIT_URL
    api_key = LIVEKIT_API_KEY
    api_secret = LIVEKIT_API_SECRET
    
    if not livekit_url or not api_key or not api_secret:
        return {"ok": False, "error": "Missing LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET"}
    
    now_ts = int(time.time())
    token_payload = {
        "iss": api_key,
        "sub": "test_agent_worker",
        "iat": now_ts - 10,
        "exp": now_ts + 3600,
        "video": {
            "agent": True,
        },
    }
    token = jwt.encode(token_payload, api_secret, algorithm="HS256")
    
    ws_scheme = "wss" if "https" in livekit_url or "wss" in livekit_url else "ws"
    netloc = livekit_url.replace("wss://", "").replace("ws://", "").replace("https://", "").replace("http://", "").rstrip("/")
    target_url = f"{ws_scheme}://{netloc}/agent"
    
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(target_url, headers=headers, timeout=aiohttp.ClientTimeout(total=5)) as ws:
                return {
                    "ok": True,
                    "message": "Successfully connected to LiveKit Cloud /agent WebSocket!",
                    "target_url": target_url,
                    "key_prefix": api_key[:6] + "...",
                }
    except aiohttp.WSServerHandshakeError as e:
        return {
            "ok": False,
            "error": f"WSServerHandshakeError: {e.status} {e.message}",
            "response_headers": dict(e.headers) if hasattr(e, "headers") else {},
            "target_url": target_url,
            "key_prefix": api_key[:6] + "...",
            "key_len": len(api_key),
            "secret_len": len(api_secret),
        }
    except Exception as e:
        return {
            "ok": False,
            "error": f"Connection error: {str(e)}",
            "target_url": target_url,
            "key_prefix": api_key[:6] + "...",
        }


# ─── HTTP /trigger Endpoint (for CRM Backend) ───
class TriggerPayload(BaseModel):
    lead_id: str
    lead_name: Optional[str] = None
    phone: str
    city: Optional[str] = None
    property_interest: Optional[str] = None
    budget: Optional[float] = None
    remark: Optional[str] = None
    campaign_id: Optional[str] = None
    user_prompt: Optional[str] = None
    agent: Optional[dict] = None
    inventory: Optional[list] = None


@app.post("/trigger")
async def trigger_call(payload: TriggerPayload, x_voice_agent_secret: Optional[str] = Header(None)):
    configured_secret = os.getenv("VOICE_AGENT_SHARED_SECRET", "").strip()
    if configured_secret and x_voice_agent_secret != configured_secret:
        raise HTTPException(401, "Invalid shared secret")

    if not is_livekit_configured():
        raise HTTPException(500, "LiveKit is not configured yet on this service. Please set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in Render Environment tab.")

    clean_digits = re.sub(r"[^0-9]", "", payload.phone)
    call_uuid = f"call-{clean_digits}-{uuid.uuid4().hex[:6]}"

    # Dispatch via LiveKit Cloud
    import jwt
    import httpx

    livekit_url = os.getenv("LIVEKIT_URL", "").strip()
    api_key = os.getenv("LIVEKIT_API_KEY", "").strip()
    api_secret = os.getenv("LIVEKIT_API_SECRET", "").strip()
    agent_name = os.getenv("LIVEKIT_AGENT_NAME", "upr-calling-agent").strip()

    http_url = livekit_url.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")

    now_ts = int(time.time())
    token_payload = {
        "iss": api_key,
        "sub": "voice_agent_runner",
        "nbf": now_ts - 5,
        "exp": now_ts + 600,
        "video": {
            "roomCreate": True,
            "roomAdmin": True,
            "room": call_uuid,
        },
    }
    token = jwt.encode(token_payload, api_secret, algorithm="HS256")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    metadata = json.dumps({
        "lead_id": payload.lead_id,
        "lead_name": payload.lead_name or "",
        "phone_number": payload.phone,
        "campaign_id": payload.campaign_id,
        "user_prompt": payload.user_prompt or payload.remark or "",
        "agent_config": payload.agent or {},
    })

    async with httpx.AsyncClient(timeout=20) as client:
        # 1. Create Room
        await client.post(
            f"{http_url}/twirp/livekit.RoomService/CreateRoom",
            headers=headers,
            json={"name": call_uuid, "metadata": metadata, "empty_timeout": 300},
        )
        # 2. Dispatch Agent
        dispatch_resp = await client.post(
            f"{http_url}/twirp/livekit.AgentDispatchService/CreateDispatch",
            headers=headers,
            json={"agent_name": agent_name, "room": call_uuid, "metadata": metadata},
        )
        dispatch_resp.raise_for_status()

    return {"ok": True, "call_uuid": call_uuid, "status": "dispatched"}


if __name__ == "__main__":
    logger.info("Running UPR Voice Agent HTTP & Worker Runner on port %d...", PORT)
    uvicorn.run("run:app", host="0.0.0.0", port=PORT, reload=False)
