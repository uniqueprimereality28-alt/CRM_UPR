"""
voice-agent — a standalone microservice that makes REAL outbound phone
calls (via Twilio), talks to the customer live (faster-whisper STT +
free/paid LLM + Sarvam/edge-tts TTS), and reports the finished call back
to your existing CRM's /api/ai/calls/ingest endpoint.

This is deliberately a SEPARATE service from the main CRM backend
(different repo folder, different deploy) because real-time audio needs
long-lived WebSocket connections and a tight processing loop that don't
belong in the same process as your request/response CRM API.

Run locally:
    uvicorn main:app --host 0.0.0.0 --port 8100

Deploy: this ships with a Dockerfile built for Render (Docker web service).
Any host that supports long-lived WebSockets + Docker will work the same way
(Fly.io, a plain VPS, etc.) — just set PUBLIC_BASE_URL to wherever it ends
up being reachable, since Twilio needs to call it.

TELEPHONY NOTE: Twilio's bidirectional <Connect><Stream> does not support
query-string parameters on the wss:// URL, so the call token is passed as a
nested <Parameter> instead and read back out of the "start" WebSocket event
(as start.customParameters.token) rather than from the query string.
"""
import asyncio
import json
import logging
import time
import uuid
from typing import Optional

import httpx
from fastapi import FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel, Field

import config
import llm
from call_session import CallSession

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("voice-agent.main")

app = FastAPI(title="voice-agent")

TWILIO_API_BASE = "https://api.twilio.com/2010-04-01"

# call_token -> context dict, populated by /trigger, consumed by /answer and /stream
PENDING_CALLS: dict[str, dict] = {}
SCORING_SIGNAL_KEYS = [
    "whatsapp_details", "budget_shared", "bhk_shared", "timeline_shared",
    "wants_site_visit", "wants_callback", "urgent_30_days", "investor_intent",
    "casual_interest", "not_interested", "wrong_number", "call_later", "requested_human",
]


def _require_secret(x_voice_agent_secret: Optional[str]):
    if not config.VOICE_AGENT_SHARED_SECRET or x_voice_agent_secret != config.VOICE_AGENT_SHARED_SECRET:
        raise HTTPException(401, "Invalid or missing shared secret")


# ================================================================
# 1. CRM backend calls this to place a real outbound call
# ================================================================
class AgentPersona(BaseModel):
    name: str = "Simran"
    voice_gender: str = "female"
    voice_accent: Optional[str] = None
    language_style: str = "formal_hinglish"
    personality: Optional[str] = None
    intro_line: Optional[str] = None
    guardrails: Optional[str] = None


class TriggerIn(BaseModel):
    lead_id: str
    lead_name: Optional[str] = None
    phone: str
    city: Optional[str] = None
    property_interest: Optional[str] = None
    budget: Optional[float] = None
    remark: Optional[str] = None
    campaign_id: Optional[str] = None
    prior_summary: Optional[str] = None  # set on follow-up recalls — gives the LLM context from the last call
    agent: AgentPersona = Field(default_factory=AgentPersona)
    inventory: list[dict] = Field(default_factory=list)


@app.post("/trigger")
async def trigger_call(payload: TriggerIn, x_voice_agent_secret: Optional[str] = Header(None)):
    _require_secret(x_voice_agent_secret)
    if not config.TWILIO_ACCOUNT_SID or not config.TWILIO_AUTH_TOKEN or not config.TWILIO_FROM_NUMBER:
        raise HTTPException(500, "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER not configured")
    if not config.PUBLIC_BASE_URL:
        raise HTTPException(500, "PUBLIC_BASE_URL not configured — Twilio needs a reachable URL")

    token = uuid.uuid4().hex
    PENDING_CALLS[token] = {
        "lead": {
            "_id": payload.lead_id, "name": payload.lead_name, "phone": payload.phone,
            "city": payload.city, "property_interest": payload.property_interest,
            "budget": payload.budget, "remark": payload.remark,
        },
        "agent": payload.agent.model_dump(),
        "inventory": payload.inventory,
        "campaign_id": payload.campaign_id,
        "prior_summary": payload.prior_summary,
        "created_at": time.time(),
        "status": "dialing",
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{TWILIO_API_BASE}/Accounts/{config.TWILIO_ACCOUNT_SID}/Calls.json",
                data={
                    "To": payload.phone,
                    "From": config.TWILIO_FROM_NUMBER,
                    "Url": f"{config.PUBLIC_BASE_URL}/answer?token={token}",
                    "Method": "POST",
                    "StatusCallback": f"{config.PUBLIC_BASE_URL}/status?token={token}",
                    "StatusCallbackMethod": "POST",
                },
                auth=(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN),
            )
            resp.raise_for_status()
            resp_json = resp.json()
    except Exception as e:
        PENDING_CALLS.pop(token, None)
        body = getattr(getattr(e, "response", None), "text", str(e))
        logger.error(f"Twilio call creation failed: {e} — {body}")
        raise HTTPException(502, f"Twilio call creation failed: {body}")

    call_sid = resp_json.get("sid")
    PENDING_CALLS[token]["call_sid"] = call_sid
    logger.info(f"Dialing {payload.phone} for lead {payload.lead_id} (token={token}, call_sid={call_sid})")
    return {"ok": True, "call_uuid": call_sid or token, "status": "dialing", "token": token}


# ================================================================
# 2. Twilio hits this when the call is answered -> returns Connect/Stream TwiML
#    (query params are NOT supported on the Stream url, so the token travels
#    as a nested <Parameter> instead, delivered back to us in the "start" event)
# ================================================================
@app.get("/answer")
@app.post("/answer")
async def answer(token: str):
    if token not in PENDING_CALLS:
        return Response(
            content='<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
            media_type="application/xml",
        )
    ws_host = config.PUBLIC_BASE_URL.replace("https://", "").replace("http://", "")
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        "<Connect>"
        f'<Stream url="wss://{ws_host}/stream">'
        f'<Parameter name="token" value="{token}"/>'
        "</Stream>"
        "</Connect>"
        "</Response>"
    )
    return Response(content=xml, media_type="application/xml")


# ================================================================
# 3. Twilio opens a WebSocket here for the live audio, both directions
# ================================================================
@app.websocket("/stream")
async def stream(websocket: WebSocket):
    await websocket.accept()
    session: Optional[CallSession] = None
    context: Optional[dict] = None
    token: Optional[str] = None

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            event = data.get("event")

            if event == "connected":
                continue

            elif event == "start":
                start = data.get("start", {})
                stream_sid = start.get("streamSid") or data.get("streamSid")
                token = (start.get("customParameters") or {}).get("token")
                context = PENDING_CALLS.get(token)
                if not context:
                    logger.error(f"Unknown/expired token on stream start: {token}")
                    await websocket.close()
                    return
                session = CallSession(stream_id=token, call_context={
                    **context,
                    "on_finished": lambda s: _finish_and_ingest(token, context, s),
                })
                session.stream_sid = stream_sid
                context["status"] = "in_progress"
                asyncio.create_task(session.speak_opening_line(websocket))

            elif event == "media":
                if session:
                    payload_b64 = data.get("media", {}).get("payload")
                    if payload_b64:
                        await session.handle_inbound_frame(websocket, payload_b64)

            elif event == "stop":
                if session and not session.ended:
                    await session.end_call(websocket, reason="twilio_stop")
                break

    except WebSocketDisconnect:
        if session and not session.ended:
            await session.end_call(websocket, reason="ws_disconnect")
    except Exception as e:
        logger.error(f"[{token}] stream handler error: {e}")
        if session and not session.ended:
            await session.end_call(websocket, reason=f"error:{e}")
    finally:
        if token:
            PENDING_CALLS.pop(token, None)


# ================================================================
# 4. Twilio call-status callback (ringing/in-progress/completed/busy/no-answer)
# ================================================================
@app.post("/status")
async def status_callback(request: Request, token: str):
    form = await request.form()
    call_status = form.get("CallStatus", "")
    logger.info(f"[{token}] Twilio status: {call_status}")

    context = PENDING_CALLS.get(token)
    if context and call_status in ("busy", "failed", "no-answer", "canceled"):
        # Call never got a live conversation — log it as a proper disposition
        # instead of silently losing the attempt.
        disposition_map = {
            "busy": "no_answer", "failed": "no_answer", "no-answer": "no_answer",
            "canceled": "no_answer",
        }
        fake_session_result = {
            "summary": f"Call not connected ({call_status}).",
            "disposition": disposition_map.get(call_status, "no_answer"),
            "requirements": {}, "signals": [], "urgency_score": 1,
            "wants_site_visit": False, "wants_brochure": False, "whatsapp_opt_in": False,
            "human_transfer_required": False, "next_followup_days": 1,
            "remarks": f"Twilio status: {call_status}",
        }
        await _post_ingest(context, fake_session_result, [], 0, None)
        PENDING_CALLS.pop(token, None)
    return {"ok": True}


# ================================================================
# Helpers: turn a finished CallSession into a CRM ingest call
# ================================================================
async def _finish_and_ingest(token: str, context: dict, session: CallSession):
    duration = int(time.time() - session.started_at)
    if session.history:
        extracted = await llm.extract_call_result(session.history, SCORING_SIGNAL_KEYS)
    else:
        extracted = {
            "summary": "Call connected but no speech was captured.",
            "disposition": "no_answer", "requirements": {}, "signals": [],
            "urgency_score": 1, "wants_site_visit": False, "wants_brochure": False,
            "whatsapp_opt_in": False, "human_transfer_required": False,
            "next_followup_days": 1, "remarks": "Empty transcript.",
        }
    await _post_ingest(context, extracted, session.history, duration, token)


async def _post_ingest(context: dict, extracted: dict, transcript: list[dict],
                       duration: int, call_uuid: Optional[str]):
    if not config.CRM_BACKEND_URL or not config.VOICE_AGENT_SHARED_SECRET:
        logger.error("CRM_BACKEND_URL / VOICE_AGENT_SHARED_SECRET not set — cannot report call result!")
        return
    body = {
        "lead_id": context["lead"]["_id"],
        "campaign_id": context.get("campaign_id"),
        "agent_name": context.get("agent", {}).get("name"),
        "call_uuid": call_uuid,
        "recording_url": None,  # wire up Twilio call recording URL here if you enable recording
        "duration_seconds": duration,
        "transcript": transcript,
        **{k: v for k, v in extracted.items() if k not in ("transcript",)},
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{config.CRM_BACKEND_URL}/api/ai/calls/ingest",
                json=body,
                headers={"X-Voice-Agent-Secret": config.VOICE_AGENT_SHARED_SECRET},
            )
            resp.raise_for_status()
        logger.info(f"Reported call for lead {context['lead']['_id']} to CRM successfully")
    except Exception as e:
        logger.error(f"Failed to POST call result to CRM: {e}")


@app.get("/health")
async def health():
    return {"ok": True, "pending_calls": len(PENDING_CALLS)}
