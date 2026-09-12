"""
Unique Prime Reality - AI Outbound Calling Agent
Powered by LiveKit + Vobiz SIP + Deepgram STT + Grok LLM + Sarvam AI TTS
"""

import asyncio
import json
import logging
import os
import re
import time
from typing import Optional

import aiohttp
from dotenv import load_dotenv
from livekit import api
from livekit.agents import AutoSubscribe, JobContext, JobProcess, WorkerOptions, cli, llm
from livekit.agents.voice import Agent, AgentSession
from livekit.agents.voice.room_io import AudioInputOptions, AudioOutputOptions, RoomOptions
from livekit.plugins import deepgram, noise_cancellation, openai, silero

try:
    from livekit.plugins import sarvam
    HAS_SARVAM = True
except ImportError:
    HAS_SARVAM = False

import config

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("upr-calling-agent")

VOICE_TURN_HANDLING = {
    "turn_detection": "vad",
    "endpointing": {"mode": "fixed", "min_delay": 0.8, "max_delay": 2.5},
    "interruption": {
        "enabled": True,
        "mode": "vad",
        "min_duration": 0.8,
        "min_words": 2,
        "resume_false_interruption": True,
    },
    "preemptive_generation": {"enabled": False},
}


def normalize_e164(phone: str) -> str:
    cleaned = re.sub(r"[\s().-]", "", str(phone or "")).strip()
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    elif cleaned.startswith("0") and len(cleaned) == 11:
        cleaned = "+91" + cleaned[1:]
    elif not cleaned.startswith("+"):
        if len(cleaned) == 10:
            cleaned = "+91" + cleaned
        else:
            cleaned = "+" + cleaned
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
                    # Clean json
                    clean_json = re.sub(r"^```json\s*|\s*```$", "", content, flags=re.MULTILINE).strip()
                    extracted = json.loads(clean_json)
                    return {**fallback_result, **extracted}
                else:
                    logger.warning("Signal extraction LLM call returned status %s", resp.status)
    except Exception as e:
        logger.error("Failed to extract call signals with LLM: %s", e)

    return fallback_result


async def post_call_to_crm(
    lead_id: str,
    campaign_id: Optional[str],
    call_uuid: str,
    duration_seconds: float,
    transcript_list: list[dict],
    agent_name: str = config.AGENT_NAME,
) -> None:
    """Post final transcript & extracted scoring signals to CRM /api/ai/calls/ingest endpoint."""
    if not config.CRM_BACKEND_URL:
        logger.warning("CRM_BACKEND_URL is not set. Skipping CRM ingest.")
        return

    full_transcript_text = "\n".join(f"{item.get('speaker')}: {item.get('text')}" for item in transcript_list)
    analysis = await extract_call_signals_with_llm(full_transcript_text)

    payload = {
        "lead_id": lead_id,
        "campaign_id": campaign_id,
        "agent_name": agent_name,
        "call_uuid": call_uuid,
        "duration_seconds": round(duration_seconds),
        "transcript": transcript_list,
        "summary": analysis.get("summary", "Outbound AI call completed."),
        "disposition": analysis.get("disposition", "connected"),
        "requirements": analysis.get("requirements", {}),
        "signals": analysis.get("signals", []),
        "urgency_score": analysis.get("urgency_score", 5),
        "wants_site_visit": analysis.get("wants_site_visit", False),
        "wants_brochure": analysis.get("wants_brochure", False),
        "whatsapp_opt_in": analysis.get("whatsapp_opt_in", False),
        "human_transfer_required": analysis.get("human_transfer_required", False),
        "next_followup_days": analysis.get("next_followup_days", 2),
        "remarks": analysis.get("remarks", ""),
    }

    ingest_url = f"{config.CRM_BACKEND_URL}/api/ai/calls/ingest"
    headers = {
        "Content-Type": "application/json",
        "X-Voice-Agent-Secret": config.VOICE_AGENT_SHARED_SECRET,
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(ingest_url, json=payload, headers=headers, timeout=25) as resp:
                if resp.status in (200, 201):
                    logger.info("Call successfully synced to CRM! Lead: %s, Signals: %s", lead_id, analysis.get("signals"))
                else:
                    logger.error("Failed to sync call to CRM (%s): %s", resp.status, await resp.text())
    except Exception as e:
        logger.error("Error posting call to CRM ingest endpoint: %s", e)


# ─── LiveKit Worker ───

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

    # 5. Agent
    agent = Agent(
        instructions=system_prompt,
        stt=stt_instance,
        llm=llm_instance,
        tts=tts_instance,
        turn_handling=VOICE_TURN_HANDLING,
    )

    session = AgentSession(
        vad=vad_instance,
        turn_handling=VOICE_TURN_HANDLING,
    )

    @session.on("conversation_item_added")
    def on_item(ev) -> None:
        msg = ev.item
        if not isinstance(msg, llm.ChatMessage):
            return
        text = (msg.text_content or "").strip()
        if not text:
            return
        speaker = "Customer" if msg.role == "user" else runtime_agent_name
        transcript_items.append({"speaker": speaker, "text": text, "timestamp": round(time.time() - call_start, 1)})
        logger.info("%s: %s", speaker, text)

    session_closed = asyncio.Event()

    @session.on("close")
    def on_close(ev) -> None:
        logger.info("Session closed.")
        session_closed.set()

    # Start audio session first
    await session.start(
        agent,
        room=ctx.room,
        room_options=RoomOptions(
            audio_input=AudioInputOptions(
                sample_rate=8000,
                num_channels=1,
                noise_cancellation=noise_cancellation.BVCTelephony(),
            ),
            audio_output=AudioOutputOptions(sample_rate=8000, num_channels=1),
            close_on_disconnect=True,
        ),
    )
    logger.info("Voice pipeline ready.")

    # 6. Outbound Telephony: Dial lead via Vobiz SIP Trunk
    outbound_trunk_id = config.VOBIZ_SIP_TRUNK_ID
    if call_type == "outbound" and phone_number and outbound_trunk_id:
        e164_phone = normalize_e164(phone_number)
        logger.info("Dialling %s via Vobiz SIP trunk %s ...", e164_phone, outbound_trunk_id)
        try:
            await ctx.api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    room_name=ctx.room.name,
                    sip_trunk_id=outbound_trunk_id,
                    sip_call_to=e164_phone,
                    participant_identity=f"sip_{e164_phone}",
                    wait_until_answered=True,
                )
            )
            logger.info("Call answered by customer! Playing initial greeting...")
            greeting = config.build_outbound_greeting(reason=user_prompt or "enquiry", agent_config=agent_config)
            await session.say(greeting, allow_interruptions=False)
            logger.info("Greeting finished. Conversation active.")
        except Exception as exc:
            logger.error("Outbound Vobiz call failed to connect: %s", exc)
            ctx.shutdown()
            return
    elif call_type == "outbound" and not outbound_trunk_id:
        logger.warning("No VOBIZ_SIP_TRUNK_ID configured. Operating in test/browser room mode.")
        await ctx.wait_for_participant()
        greeting = config.build_outbound_greeting(reason=user_prompt or "enquiry", agent_config=agent_config)
        await session.say(greeting, allow_interruptions=True)
    else:
        # Browser test or incoming participant
        logger.info("Waiting for web participant...")
        await ctx.wait_for_participant()
        await session.say(f"Namaste, main {runtime_agent_name} bol rahi hoon Unique Prime Reality se. How may I help you?", allow_interruptions=True)

    # Max call duration safeguard
    async def enforce_max_duration() -> None:
        await asyncio.sleep(config.MAX_CALL_DURATION_SECONDS)
        logger.warning("Max duration reached — closing call.")
        session.say("Thank you for your time. Have a wonderful day!", allow_interruptions=False)
        await asyncio.sleep(4)
        ctx.shutdown()

    duration_task = asyncio.create_task(enforce_max_duration())

    try:
        await session_closed.wait()
    finally:
        duration_task.cancel()
        call_duration = time.time() - call_start
        logger.info("Call session complete. Duration: %.1fs, Turns: %d", call_duration, len(transcript_items))

        # Post results back to CRM
        await post_call_to_crm(
            lead_id=lead_id,
            campaign_id=campaign_id,
            call_uuid=ctx.room.name,
            duration_seconds=call_duration,
            transcript_list=transcript_items,
            agent_name=runtime_agent_name,
        )


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name=config.LIVEKIT_AGENT_NAME,
        ),
    )
