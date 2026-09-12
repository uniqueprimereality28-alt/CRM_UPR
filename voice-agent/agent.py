"""
Unique Prime Reality - Outbound Calling Agent
Built with LiveKit Agents SDK, Vobiz SIP Trunk, Deepgram Nova-3 STT,
Grok LLM (xAI), and Sarvam AI TTS (Indian voice).
"""

import asyncio
import json
import logging
import os
import re
import time
from typing import Annotated, Optional

import aiohttp
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    JobProcess,
    WorkerOptions,
    cli,
    llm,
)
from livekit.agents.voice_assistant import VoiceAssistant
from livekit.plugins import deepgram, openai, silero
from livekit import api

try:
    from livekit.plugins import sarvam
    HAS_SARVAM = True
except ImportError:
    HAS_SARVAM = False

import config

logger = logging.getLogger("upr-calling-agent")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


# ─── Phone Number Helper ───

def format_e164(phone: str) -> str:
    cleaned = re.sub(r"[^\d+]", "", phone)
    if not cleaned.startswith("+"):
        if len(cleaned) == 10:
            cleaned = "+91" + cleaned
        elif len(cleaned) == 12 and cleaned.startswith("91"):
            cleaned = "+" + cleaned
        else:
            cleaned = "+91" + cleaned
    return cleaned


# ─── CRM Sync & Signal Extraction ───

async def extract_call_signals_with_llm(transcript: str) -> dict:
    """Use Grok / OpenAI to extract structured requirements and scoring signals from transcript."""
    fallback_result = {
        "summary": "Call completed with customer.",
        "disposition": "connected",
        "requirements": {},
        "signals": [],
        "urgency_score": 5,
        "wants_site_visit": False,
        "wants_brochure": False,
        "whatsapp_opt_in": False,
        "human_transfer_required": False,
        "next_followup_days": 2,
        "remarks": "",
    }

    if not transcript or len(transcript.strip()) < 10:
        return fallback_result

    prompt = f"""You are an expert real estate CRM data analyst. Analyze this phone conversation transcript between Simran (Unique Prime Reality AI consultant) and a customer.

TRANSCRIPT:
{transcript}

Extract the following information in pure JSON format with no markdown wrappers:
{{
  "summary": "One sentence summary of the call outcome and discussion",
  "disposition": "connected | callback | not_interested | wrong_number | busy",
  "requirements": {{
    "budget": "extracted budget string or null",
    "bhk": "e.g. 2 BHK, 3 BHK, 4 BHK or null",
    "location": "preferred location or null",
    "timeline": "immediate, 30 days, 6 months, or null"
  }},
  "signals": [
    Choose from: "whatsapp_details", "budget_shared", "bhk_shared", "timeline_shared", "wants_site_visit", "wants_callback", "urgent_30_days", "investor_intent", "casual_interest", "not_interested", "wrong_number", "call_later", "requested_human"
  ],
  "urgency_score": 1-10 integer,
  "wants_site_visit": true/false,
  "wants_brochure": true/false,
  "whatsapp_opt_in": true/false,
  "human_transfer_required": true/false,
  "next_followup_days": integer (e.g. 1, 2, 7) or null,
  "remarks": "Notable customer preferences or remarks"
}}"""

    try:
        api_key = config.GROK_API_KEY or config.GROQ_API_KEY or config.OPENAI_API_KEY
        base_url = "https://api.x.ai/v1" if config.GROK_API_KEY else ("https://api.groq.com/openai/v1" if config.GROQ_API_KEY else "https://api.openai.com/v1")
        model = config.GROK_MODEL if config.GROK_API_KEY else (config.GROQ_MODEL if config.GROQ_API_KEY else config.OPENAI_MODEL)

        if not api_key:
            return fallback_result

        async with aiohttp.ClientSession() as session:
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
            }
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            async with session.post(f"{base_url}/chat/completions", json=payload, headers=headers, timeout=20) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    content = data["choices"][0]["message"]["content"].strip()
                    clean_json = re.sub(r"^```json\s*|\s*```$", "", content, flags=re.MULTILINE).strip()
                    extracted = json.loads(clean_json)
                    return {**fallback_result, **extracted}
                else:
                    logger.warning("Signal extraction LLM call returned status %s", resp.status)
    except Exception as e:
        logger.error("Failed to extract call signals with LLM: %s", e)

    return fallback_result


async def sync_call_to_crm(
    lead_id: str,
    call_uuid: str,
    duration_seconds: int,
    transcript_items: list[dict],
    campaign_id: Optional[str] = None,
    agent_name: str = "Simran",
) -> None:
    """Send call recording metadata, full transcript, and extracted signals back to CRM /api/ai/calls/ingest."""
    if not config.CRM_BACKEND_URL:
        logger.info("CRM_BACKEND_URL not set; skipping CRM sync.")
        return

    formatted_transcript = "\n".join(
        f"{t.get('role', 'speaker').capitalize()}: {t.get('content', '')}"
        for t in transcript_items
    )

    signals = await extract_call_signals_with_llm(formatted_transcript)

    payload = {
        "call_uuid": call_uuid,
        "lead_id": lead_id,
        "campaign_id": campaign_id,
        "agent_name": agent_name,
        "duration_seconds": duration_seconds,
        "transcript": transcript_items,
        "summary": signals.get("summary", "Outbound AI call completed."),
        "disposition": signals.get("disposition", "connected"),
        "requirements": signals.get("requirements", {}),
        "signals": signals.get("signals", []),
        "urgency_score": signals.get("urgency_score", 5),
        "wants_site_visit": signals.get("wants_site_visit", False),
        "wants_brochure": signals.get("wants_brochure", False),
        "whatsapp_opt_in": signals.get("whatsapp_opt_in", False),
        "human_transfer_required": signals.get("human_transfer_required", False),
        "next_followup_days": signals.get("next_followup_days", 2),
        "remarks": signals.get("remarks", ""),
    }

    url = f"{config.CRM_BACKEND_URL.rstrip('/')}/api/ai/calls/ingest"
    headers = {"Content-Type": "application/json"}
    if config.VOICE_AGENT_SHARED_SECRET:
        headers["X-Voice-Agent-Secret"] = config.VOICE_AGENT_SHARED_SECRET

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers, timeout=25) as resp:
                if resp.status == 200:
                    logger.info("Successfully synced call %s for lead %s to CRM", call_uuid, lead_id)
                else:
                    text = await resp.text()
                    logger.error("Failed to sync call to CRM (%s): %s", resp.status, text)
    except Exception as e:
        logger.error("Error posting call to CRM ingest: %s", e)


# ─── LiveKit Agent Setup & Lifecycle ───

def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=0.2,
        min_silence_duration=0.5,
        prefix_padding_duration=0.3,
        activation_threshold=0.65,
    )
    logger.info("Silero VAD pre-warmed for telephony.")


async def entrypoint(ctx: JobContext) -> None:
    phone_number: Optional[str] = None
    lead_id: Optional[str] = None
    campaign_id: Optional[str] = None
    call_type = "outbound"
    user_prompt = ""
    agent_config: dict = {}

    if ctx.job.metadata:
        try:
            meta = json.loads(ctx.job.metadata)
            phone_number = meta.get("phone_number") or meta.get("phone")
            lead_id = meta.get("lead_id") or meta.get("id")
            campaign_id = meta.get("campaign_id")
            call_type = meta.get("call_type", "outbound")
            user_prompt = meta.get("user_prompt") or meta.get("prompt") or ""
            raw_cfg = meta.get("agent_config", {})
            if isinstance(raw_cfg, dict):
                agent_config = raw_cfg
        except Exception as e:
            logger.warning("Could not parse job metadata: %s", e)

    lead_id = lead_id or f"lead_{int(time.time())}"
    runtime_agent_name = agent_config.get("agentName") or config.AGENT_NAME

    logger.info("Job started | lead_id=%s | phone=%s | type=%s", lead_id, phone_number, call_type)

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("Connected to LiveKit room: %s", ctx.room.name)

    call_start = time.time()
    transcript_items: list[dict] = []

    vad_instance = ctx.proc.userdata.get("vad") or silero.VAD.load(
        min_speech_duration=0.2,
        min_silence_duration=0.5,
        prefix_padding_duration=0.3,
        activation_threshold=0.65,
    )

    # 1. Initialize LLM (Grok xAI -> Groq -> OpenAI)
    if config.GROK_API_KEY:
        llm_instance = openai.LLM(
            model=config.GROK_MODEL,
            base_url="https://api.x.ai/v1",
            api_key=config.GROK_API_KEY,
            temperature=0.4,
        )
        logger.info("LLM initialized with Grok (xAI): %s", config.GROK_MODEL)
    elif config.GROQ_API_KEY:
        llm_instance = openai.LLM(
            model=config.GROQ_MODEL,
            base_url="https://api.groq.com/openai/v1",
            api_key=config.GROQ_API_KEY,
            temperature=0.4,
        )
        logger.info("LLM initialized with Groq: %s", config.GROQ_MODEL)
    else:
        llm_instance = openai.LLM(
            model=config.OPENAI_MODEL,
            api_key=config.OPENAI_API_KEY or None,
            temperature=0.4,
        )
        logger.info("LLM initialized with OpenAI fallback: %s", config.OPENAI_MODEL)

    # 2. Initialize STT (Deepgram Nova-3)
    stt_instance = deepgram.STT(
        model=config.DEEPGRAM_STT_MODEL,
        language=config.DEEPGRAM_STT_LANGUAGE,
        api_key=config.DEEPGRAM_API_KEY or None,
    )

    # 3. Initialize TTS (Sarvam AI Indian voices -> Deepgram Aura fallback)
    tts_instance = None
    if config.SARVAM_API_KEY and HAS_SARVAM:
        try:
            tts_instance = sarvam.TTS(
                target_language_code=config.SARVAM_LANGUAGE_CODE,
                speaker=config.SARVAM_SPEAKER,
                api_key=config.SARVAM_API_KEY,
            )
            logger.info("TTS initialized with Sarvam AI: speaker=%s, lang=%s", config.SARVAM_SPEAKER, config.SARVAM_LANGUAGE_CODE)
        except Exception as e:
            logger.warning("Failed to initialize Sarvam TTS (%s). Falling back to Deepgram.", e)

    if tts_instance is None:
        tts_instance = deepgram.TTS(
            model=config.DEEPGRAM_TTS_MODEL,
            api_key=config.DEEPGRAM_API_KEY or None,
        )
        logger.info("TTS initialized with Deepgram Aura: %s", config.DEEPGRAM_TTS_MODEL)

    # 4. System prompt
    system_prompt = config.build_runtime_system_prompt(call_type, agent_config, user_prompt)

    assistant = VoiceAssistant(
        vad=vad_instance,
        stt=stt_instance,
        llm=llm_instance,
        tts=tts_instance,
        fnc_ctx=llm.FunctionContext(),
        chat_ctx=llm.ChatContext().append(
            role="system",
            text=system_prompt,
        ),
    )

    # 5. Track transcripts
    @assistant.on("user_speech_committed")
    def on_user_speech(msg: llm.ChatMessage):
        transcript_items.append({"role": "customer", "content": msg.text, "time": round(time.time() - call_start, 1)})
        logger.info("Customer: %s", msg.text)

    @assistant.on("agent_speech_committed")
    def on_agent_speech(msg: llm.ChatMessage):
        transcript_items.append({"role": "agent", "content": msg.text, "time": round(time.time() - call_start, 1)})
        logger.info("%s: %s", runtime_agent_name, msg.text)

    assistant.start(ctx.room)

    # 6. Outbound Telephony: Dial lead via Vobiz SIP Trunk
    if phone_number and config.VOBIZ_SIP_TRUNK_ID:
        e164_target = format_e164(phone_number)
        logger.info("Dialing %s via Vobiz SIP Trunk %s...", e164_target, config.VOBIZ_SIP_TRUNK_ID)
        try:
            lk_api = api.LiveKitAPI(
                url=config.LIVEKIT_URL,
                api_key=config.LIVEKIT_API_KEY,
                api_secret=config.LIVEKIT_API_SECRET,
            )
            await lk_api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    sip_trunk_id=config.VOBIZ_SIP_TRUNK_ID,
                    sip_call_to=e164_target,
                    room_name=ctx.room.name,
                    participant_identity=f"phone_{e164_target}",
                    participant_name=agent_config.get("leadName") or "Customer",
                )
            )
            await lk_api.aclose()
            logger.info("SIP dial participant requested successfully.")
        except Exception as e:
            logger.error("Failed to create SIP participant via Vobiz: %s", e)

    # 7. Greeting
    await asyncio.sleep(1.5)
    greeting = config.build_outbound_greeting(user_prompt or "property enquiry", agent_config)
    await assistant.say(greeting, allow_interruptions=True)

    # 8. Wait until call ends
    room_disconnected = asyncio.Event()

    @ctx.room.on("disconnected")
    def on_disconnect():
        room_disconnected.set()

    await room_disconnected.wait()

    # 9. Post-call Sync
    duration = int(time.time() - call_start)
    logger.info("Call concluded (%ds). Syncing signals and transcript to CRM...", duration)
    await sync_call_to_crm(
        lead_id=lead_id,
        call_uuid=ctx.room.name,
        duration_seconds=duration,
        transcript_items=transcript_items,
        campaign_id=campaign_id,
        agent_name=runtime_agent_name,
    )


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=config.LIVEKIT_AGENT_NAME,
        )
    )
