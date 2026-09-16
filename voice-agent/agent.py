"""
Unique Prime Reality - AI Outbound Calling Agent (Vrinda)
Powered by LiveKit + Vobiz SIP + Deepgram STT + Groq LLM + Sarvam AI TTS
"""

import asyncio
import json
import logging
import os
import re
import sys
import time
from typing import Optional

os.environ.setdefault("MALLOC_ARENA_MAX", "2")
os.environ.setdefault("PYTHONMALLOC", "malloc")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")
os.environ.setdefault("LIVEKIT_NUM_IDLE_PROCESSES", "0")

import aiohttp
from dotenv import load_dotenv
from livekit import api
from livekit.agents import AutoSubscribe, JobContext, JobProcess, WorkerOptions, cli, llm
from livekit.agents.voice import Agent, AgentSession
from livekit.agents.voice.room_io import RoomOptions
from livekit.plugins import deepgram, openai, silero

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


# ─── CRM Sync & Structured Key-Points Extraction ───

async def extract_call_signals_with_llm(transcript: str) -> dict:
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

    prompt = f"""
Analyze the following sales call transcript between Vrinda (Unique Prime Reality) and a prospective property buyer in Gurgaon.
Extract the structured lead data in JSON format:
{{
  "summary": "2-3 sentence executive summary of customer's interest and requirement",
  "disposition": "interested" | "warm" | "site_visit_requested" | "call_back_requested" | "not_interested" | "wrong_number",
  "requirements": {{
    "purpose": "Personal Use" | "Investment" | null,
    "budget": "e.g. 1.5 Cr to 2.5 Cr" | null,
    "property_type": "Apartment" | "Penthouse" | "Plot" | "Commercial" | null,
    "bhk": "1 BHK" | "2 BHK" | "3 BHK" | "4 BHK" | null,
    "preferred_location": "Dwarka Expressway" | "Golf Course Ext" | "Sohna Road" | "New Gurgaon" | null,
    "possession_timeline": "Ready to Move" | "Under Construction" | null
  }},
  "signals": ["list of 3-5 concise bullet points highlighting key buying signals, objections, or timeline"],
  "urgency_score": 1-10,
  "wants_site_visit": true | false,
  "wants_brochure": true | false,
  "whatsapp_opt_in": true | false,
  "human_transfer_required": true | false,
  "next_followup_days": 1 | 2 | 5,
  "remarks": "Any special instructions or preferences mentioned"
}}

Transcript:
{transcript}
"""
    try:
        if config.GROQ_API_KEY:
            import httpx
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {config.GROQ_API_KEY}"},
                    json={
                        "model": config.GROQ_MODEL,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,
                        "response_format": {"type": "json_object"},
                    },
                )
                if resp.status_code == 200:
                    return json.loads(resp.json()["choices"][0]["message"]["content"])
    except Exception as e:
        logger.warning("Could not extract signals with LLM: %s", e)
    return fallback_result


async def post_call_to_crm(
    lead_id: str,
    campaign_id: Optional[str],
    call_uuid: str,
    duration_seconds: float,
    transcript_list: list[dict],
    agent_name: str,
) -> None:
    if not config.CRM_BACKEND_URL:
        return

    full_transcript_text = "\n".join(
        f"{t.get('speaker', 'Speaker')}: {t.get('text', '')}" for t in transcript_list
    )
    analysis = await extract_call_signals_with_llm(full_transcript_text)

    payload = {
        "lead_id": lead_id,
        "campaign_id": campaign_id,
        "call_uuid": call_uuid,
        "agent_name": agent_name,
        "duration_seconds": round(duration_seconds, 1),
        "transcript": transcript_list,
        "full_text": full_transcript_text,
        "summary": analysis.get("summary", ""),
        "disposition": analysis.get("disposition", "completed"),
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
                    logger.info("Call successfully synced to CRM! Lead: %s", lead_id)
                else:
                    logger.error("Failed to sync call to CRM (%s): %s", resp.status, await resp.text())
    except Exception as e:
        logger.error("Error posting call to CRM ingest endpoint: %s", e)


# ─── LiveKit Worker ───

def prewarm(proc: JobProcess) -> None:
    try:
        import torch
        torch.set_num_threads(1)
    except Exception:
        pass
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=0.2,
        min_silence_duration=0.5,
        prefix_padding_duration=0.3,
        activation_threshold=0.65,
    )
    logger.info("Silero VAD pre-warmed for telephony (single-thread mode).")


async def entrypoint(ctx: JobContext) -> None:
    phone_number: Optional[str] = None
    lead_id: Optional[str] = None
    campaign_id: Optional[str] = None
    call_type = "outbound"
    user_prompt = ""
    agent_config: dict = {}
    inventory: list = config.DEFAULT_INVENTORY
    sip_trunk_id: Optional[str] = None
    meta: dict = {}

    if ctx.job.metadata:
        try:
            meta = json.loads(ctx.job.metadata)
            phone_number = meta.get("phone_number") or meta.get("phone")
            lead_id = meta.get("lead_id") or meta.get("id")
            campaign_id = meta.get("campaign_id")
            call_type = meta.get("call_type", "outbound")
            user_prompt = meta.get("user_prompt") or meta.get("prompt") or ""
            sip_trunk_id = meta.get("sip_trunk_id") or meta.get("vobiz_sip_trunk_id")
            raw_cfg = meta.get("agent_config", {})
            if isinstance(raw_cfg, dict):
                agent_config = raw_cfg
            lead_name = meta.get("lead_name") or meta.get("leadName") or agent_config.get("lead_name") or agent_config.get("leadName") or ""
            if lead_name:
                agent_config["lead_name"] = lead_name
                agent_config["leadName"] = lead_name
            inventory = meta.get("inventory") or agent_config.get("inventory") or config.DEFAULT_INVENTORY
        except Exception as e:
            logger.warning("Could not parse job metadata: %s", e)

    lead_id = lead_id or f"lead_{int(time.time())}"
    runtime_agent_name = agent_config.get("agent_name") or agent_config.get("agentName") or config.AGENT_NAME

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

    # 1. Initialize LLM (Groq -> OpenAI -> Grok fallback)
    if config.GROQ_API_KEY:
        llm_instance = openai.LLM(
            model=config.GROQ_MODEL,
            base_url="https://api.groq.com/openai/v1",
            api_key=config.GROQ_API_KEY,
            temperature=0.3,
        )
    elif config.OPENAI_API_KEY:
        llm_instance = openai.LLM(
            model=config.OPENAI_MODEL,
            api_key=config.OPENAI_API_KEY,
            temperature=0.3,
        )
    else:
        llm_instance = openai.LLM(
            model="llama-3.3-70b-versatile",
            base_url="https://api.groq.com/openai/v1",
            temperature=0.3,
        )

    # 2. Initialize STT (Deepgram Nova-3)
    stt_instance = deepgram.STT(
        model=config.DEEPGRAM_STT_MODEL,
        language=config.DEEPGRAM_STT_LANGUAGE,
        api_key=config.DEEPGRAM_API_KEY or None,
    )

    # 3. Initialize TTS (Sarvam AI Indian voices -> Deepgram Aura fallback)
    tts_instance = None
    sarvam_key = meta.get("sarvam_api_key") or config.SARVAM_API_KEY
    sarvam_speaker = meta.get("sarvam_speaker") or config.SARVAM_SPEAKER
    sarvam_lang = meta.get("sarvam_language") or config.SARVAM_LANGUAGE_CODE

    if sarvam_key and HAS_SARVAM:
        try:
            tts_instance = sarvam.TTS(
                model=config.SARVAM_MODEL,
                target_language_code=sarvam_lang,
                speaker=sarvam_speaker,
                api_key=sarvam_key,
            )
        except Exception as e:
            logger.warning("Could not initialize Sarvam TTS: %s. Using Deepgram fallback.", e)

    if tts_instance is None:
        tts_instance = deepgram.TTS(
            model=config.DEEPGRAM_TTS_MODEL,
            api_key=config.DEEPGRAM_API_KEY or None,
        )

    system_instructions = config.build_sales_system_prompt(
        agent_config=agent_config,
        inventory=inventory,
        custom_instructions=user_prompt,
    )

    agent = Agent(
        instructions=system_instructions,
        stt=stt_instance,
        llm=llm_instance,
        tts=tts_instance,
        turn_handling=VOICE_TURN_HANDLING,
    )

    session = AgentSession(
        vad=vad_instance,
        turn_handling=VOICE_TURN_HANDLING,
    )

    disconnecting = False

    async def schedule_delayed_hangup(delay_sec: float = 3.5):
        nonlocal disconnecting
        if disconnecting:
            return
        disconnecting = True
        logger.info("Closing call after %.1fs...", delay_sec)
        await asyncio.sleep(delay_sec)
        ctx.shutdown()

    customer_spoke = False
    last_customer_speech_time = time.time()

    @session.on("conversation_item_added")
    def on_item(ev) -> None:
        nonlocal customer_spoke, last_customer_speech_time
        msg = ev.item
        if not isinstance(msg, llm.ChatMessage):
            return
        text = (msg.text_content or "").strip()
        if not text:
            return
        speaker = "Customer" if msg.role == "user" else runtime_agent_name
        transcript_items.append({"speaker": speaker, "text": text, "timestamp": round(time.time() - call_start, 1)})
        logger.info("%s: %s", speaker, text)

        if speaker == "Customer":
            customer_spoke = True
            last_customer_speech_time = time.time()

        lower = text.lower()
        if speaker == runtime_agent_name:
            if any(phrase in lower for phrase in ["thank you for your time, have a nice day", "have a nice day", "have a wonderful day"]) and "kya aap gurgaon" not in lower:
                asyncio.create_task(schedule_delayed_hangup(3.5))

    session_closed = asyncio.Event()

    @session.on("close")
    def on_close(ev) -> None:
        logger.info("Session closed.")
        session_closed.set()

    # Immediate hangup when the customer cuts the call on mobile
    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant):
        logger.info("Customer disconnected (%s). Hanging up immediately.", participant.identity)
        ctx.shutdown()

    # Start audio session with standard RoomOptions (fixes voice breaking & CPU spikes)
    await session.start(
        agent,
        room=ctx.room,
        room_options=RoomOptions(
            close_on_disconnect=True,
        ),
    )
    logger.info("Voice pipeline ready.")

    # 6. Outbound Telephony: Dial lead via Vobiz SIP Trunk
    outbound_trunk_id = sip_trunk_id or config.VOBIZ_SIP_TRUNK_ID
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
        logger.info("Waiting for web participant...")
        await ctx.wait_for_participant()
        await session.say(f"Hello, main {runtime_agent_name} bol rahi hoon Unique Prime Reality, Gurgaon se. How may I help you?", allow_interruptions=True)

    # Silence & Voicemail Watchdog (Prevents token waste):
    # If no customer response within 14s of greeting, hang up immediately.
    # If customer silent for >30s during call, hang up.
    async def silence_watchdog():
        await asyncio.sleep(14)
        if not customer_spoke and not disconnecting:
            logger.info("No customer speech detected after greeting (voicemail / unanswered). Hanging up to save tokens.")
            ctx.shutdown()
            return

        while not disconnecting:
            await asyncio.sleep(5)
            if (time.time() - last_customer_speech_time) > 30 and not disconnecting:
                logger.info("Customer silent for >30s. Hanging up.")
                try:
                    await session.say("Aapki aawaz nahi aa rahi hai, hum baad mein contact karenge. Thank you!", allow_interruptions=False)
                    await asyncio.sleep(3)
                except Exception:
                    pass
                ctx.shutdown()
                return

    watchdog_task = asyncio.create_task(silence_watchdog())

    async def enforce_max_duration() -> None:
        await asyncio.sleep(config.MAX_CALL_DURATION_SECONDS)
        logger.warning("Max duration reached — closing call.")
        try:
            await session.say("Thank you for your time. Have a wonderful day!", allow_interruptions=False)
            await asyncio.sleep(4)
        except Exception:
            pass
        ctx.shutdown()

    duration_task = asyncio.create_task(enforce_max_duration())

    try:
        await session_closed.wait()
    finally:
        duration_task.cancel()
        watchdog_task.cancel()
        call_duration = time.time() - call_start
        logger.info("Call session complete. Duration: %.1fs, Turns: %d", call_duration, len(transcript_items))

        await post_call_to_crm(
            lead_id=lead_id,
            campaign_id=campaign_id,
            call_uuid=ctx.room.name,
            duration_seconds=call_duration,
            transcript_list=transcript_items,
            agent_name=runtime_agent_name,
        )


if __name__ == "__main__":
    if not config.LIVEKIT_URL:
        logger.error("ERROR: LIVEKIT_URL is not set.")
        sys.exit(1)

    try:
        from livekit.agents.job import JobExecutorType
        job_exec = JobExecutorType.THREAD
    except Exception:
        try:
            from livekit.agents import JobExecutorType
            job_exec = JobExecutorType.THREAD
        except Exception:
            job_exec = None

    worker_kwargs = {
        "entrypoint_fnc": entrypoint,
        "prewarm_fnc": prewarm,
        "agent_name": config.LIVEKIT_AGENT_NAME,
        "num_idle_processes": 0,
        "job_memory_warn_mb": 260,
        "job_memory_limit_mb": 380,
    }
    if job_exec is not None:
        worker_kwargs["job_executor_type"] = job_exec
    if config.LIVEKIT_URL:
        worker_kwargs["ws_url"] = config.LIVEKIT_URL
    if config.LIVEKIT_API_KEY:
        worker_kwargs["api_key"] = config.LIVEKIT_API_KEY
    if config.LIVEKIT_API_SECRET:
        worker_kwargs["api_secret"] = config.LIVEKIT_API_SECRET
    logger.info(
        "Connecting worker '%s' to %s with Key '%s...'",
        config.LIVEKIT_AGENT_NAME,
        config.LIVEKIT_URL,
        config.LIVEKIT_API_KEY[:6] if config.LIVEKIT_API_KEY else "NONE",
    )
    cli.run_app(WorkerOptions(**worker_kwargs))
