"""
Unique Prime Reality - AI Voice Agent Worker (Production Engine)
Ultra-low latency conversational calling with Groq Qwen-27B + Sarvam AI / Deepgram TTS + Deepgram Nova-3 STT.
Engineered for Render Free Tier (Single process, ~180MB RAM).
"""
import asyncio
import json
import logging
import os
import re
import sys
import time
from typing import Optional

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")
os.environ.setdefault("LIVEKIT_NUM_IDLE_PROCESSES", "1")

import aiohttp
from dotenv import load_dotenv
load_dotenv()

from livekit import api
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    RoomOptions,
    WorkerOptions,
    cli,
    llm,
)
from livekit.agents.voice import Agent, AgentSession
from livekit.plugins import deepgram, openai, silero

try:
    from livekit.plugins import sarvam
    HAS_SARVAM = True
except ImportError:
    HAS_SARVAM = False

import config

logger = logging.getLogger("upr-calling-agent")
logger.setLevel(logging.INFO)
if not logger.handlers:
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    logger.addHandler(ch)

VOICE_TURN_HANDLING = {
    "interruption": {
        "mode": "adaptive",
        "min_words": 1,
        "interruption_latency": 0.15,
    }
}


def _rss_mb() -> float:
    try:
        import psutil
        return round(psutil.Process().memory_info().rss / (1024 * 1024), 1)
    except Exception:
        return 0.0


def normalize_e164(raw: str) -> str:
    cleaned = re.sub(r"[^\d+]", "", raw.strip())
    if cleaned.startswith("+"):
        return cleaned
    digits = re.sub(r"\D", "", cleaned)
    if len(digits) == 10:
        return f"+91{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"
    return f"+{digits}"


async def post_call_to_crm(
    lead_id: str,
    campaign_id: Optional[str],
    call_uuid: str,
    duration_seconds: float,
    transcript_list: list,
    agent_name: str,
    crm_backend_url: str,
    shared_secret: str,
    forced_disposition: Optional[str] = None,
    forced_remarks: Optional[str] = None,
) -> None:
    if not crm_backend_url:
        return

    url = f"{crm_backend_url.rstrip('/')}/api/ai/calls/real/complete"
    payload = {
        "lead_id": lead_id,
        "campaign_id": campaign_id,
        "call_uuid": call_uuid,
        "duration_seconds": round(duration_seconds, 1),
        "transcript": transcript_list,
        "agent_name": agent_name,
        "completed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if forced_disposition:
        payload["disposition"] = forced_disposition
    if forced_remarks:
        payload["remarks"] = forced_remarks

    headers = {
        "Content-Type": "application/json",
        "X-Voice-Agent-Secret": shared_secret,
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status in (200, 201):
                    logger.info("Call data saved to CRM successfully: lead_id=%s, call_uuid=%s", lead_id, call_uuid)
                else:
                    body = await resp.text()
                    logger.warning("CRM /complete returned %s: %s", resp.status, body)
    except Exception as exc:
        logger.error("Failed to post call to CRM (%s): %s", url, exc)


def prewarm(proc: JobContext) -> None:
    try:
        proc.userdata["vad"] = silero.VAD.load(
            min_speech_duration=0.2,
            min_silence_duration=0.5,
            prefix_padding_duration=0.3,
            activation_threshold=0.65,
        )
        logger.info("VAD model prewarmed successfully | rss=%.1fMB", _rss_mb())
    except Exception as exc:
        logger.warning("VAD prewarm failed: %s", exc)


async def entrypoint(ctx: JobContext) -> None:
    logger.info("Job assigned: room=%s | agent=%s | rss=%.1fMB", ctx.room.name, config.LIVEKIT_AGENT_NAME, _rss_mb())
    try:
        await _entrypoint_impl(ctx)
    except Exception as exc:
        logger.error("Error in entrypoint: %s", exc, exc_info=True)
    finally:
        logger.info("Session finished: %s", ctx.room.name)


async def _entrypoint_impl(ctx: JobContext) -> None:
    meta: dict = {}
    phone_number = None
    lead_id = None
    campaign_id = None
    call_type = "outbound"
    user_prompt = ""
    sip_trunk_id = None
    agent_config: dict = {}
    inventory = config.DEFAULT_INVENTORY

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

    logger.info(
        "Job started | lead_id=%s | phone=%s | type=%s | rss_mb=%.1f",
        lead_id, phone_number, call_type, _rss_mb(),
    )

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
    groq_key = meta.get("groq_api_key") or config.GROQ_API_KEY
    openai_key = meta.get("openai_api_key") or config.OPENAI_API_KEY
    grok_key = meta.get("grok_api_key") or config.GROK_API_KEY

    if groq_key:
        chosen_groq_model = config.GROQ_MODEL
        if chosen_groq_model in ["llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "llama3-70b-8192", "llama3-8b-8192", ""]:
            chosen_groq_model = "qwen/qwen3.8-27b"
        llm_instance = openai.LLM(
            model=chosen_groq_model,
            base_url="https://api.groq.com/openai/v1",
            api_key=groq_key,
            temperature=0.3,
        )
        logger.info("LLM initialized with Groq: %s", chosen_groq_model)
    elif openai_key:
        llm_instance = openai.LLM(
            model=config.OPENAI_MODEL,
            api_key=openai_key,
            temperature=0.3,
        )
        logger.info("LLM initialized with OpenAI fallback: %s", config.OPENAI_MODEL)
    elif grok_key:
        llm_instance = openai.LLM(
            model=config.GROK_MODEL,
            base_url="https://api.x.ai/v1",
            api_key=grok_key,
            temperature=0.3,
        )
        logger.info("LLM initialized with Grok: %s", config.GROK_MODEL)
    else:
        llm_instance = openai.LLM(
            model="qwen/qwen3.8-27b",
            base_url="https://api.groq.com/openai/v1",
            temperature=0.3,
        )

    # 2. Initialize STT (Deepgram Nova-3)
    deepgram_key = meta.get("deepgram_api_key") or config.DEEPGRAM_API_KEY
    stt_instance = deepgram.STT(
        model=config.DEEPGRAM_STT_MODEL,
        language=config.DEEPGRAM_STT_LANGUAGE,
        api_key=deepgram_key or None,
    )
    logger.info("STT initialized with Deepgram Nova-3")

    # 3. Initialize TTS (Sarvam AI -> Deepgram Aura fallback)
    tts_instance = None
    sarvam_key = meta.get("sarvam_api_key") or config.SARVAM_API_KEY
    valid_sarvam_speakers = {"simran", "priya", "kavya", "neha", "pooja", "aditya", "amit", "rahul"}
    sarvam_speaker = meta.get("sarvam_speaker") or config.SARVAM_SPEAKER
    if sarvam_speaker not in valid_sarvam_speakers:
        sarvam_speaker = "simran"
    sarvam_lang = meta.get("sarvam_language") or config.SARVAM_LANGUAGE_CODE

    if sarvam_key and HAS_SARVAM:
        try:
            tts_instance = sarvam.TTS(
                model=config.SARVAM_MODEL,
                target_language_code=sarvam_lang,
                speaker=sarvam_speaker,
                api_key=sarvam_key,
            )
            logger.info("TTS initialized with Sarvam AI: model=%s, speaker=%s, lang=%s", config.SARVAM_MODEL, sarvam_speaker, sarvam_lang)
        except Exception as e:
            logger.warning("Failed to initialize Sarvam TTS (%s). Falling back to Deepgram.", e)

    if tts_instance is None:
        tts_instance = deepgram.TTS(
            model=config.DEEPGRAM_TTS_MODEL,
            api_key=config.DEEPGRAM_API_KEY or None,
        )
        logger.info("TTS initialized with Deepgram Aura: %s", config.DEEPGRAM_TTS_MODEL)

    # 4. System prompt
    system_prompt = config.build_runtime_system_prompt(call_type, agent_config, user_prompt, inventory=inventory)

    # 5. Agent & Session
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

    disconnecting = False

    async def hangup_call():
        nonlocal disconnecting
        if disconnecting:
            return
        disconnecting = True
        logger.info("Ending call: deleting LiveKit room %s...", ctx.room.name)
        try:
            await ctx.api.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))
        except Exception as e:
            logger.warning("Error deleting room for SIP hangup: %s", e)
        ctx.shutdown()

    async def schedule_delayed_hangup(delay_sec: float = 3.5):
        if disconnecting:
            return
        await asyncio.sleep(delay_sec)
        await hangup_call()

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
            if any(phrase in lower for phrase in [
                "nahi chahiye",
                "not interested",
                "wrong number",
                "don't call",
                "dont call",
                "call cut",
                "busy right now",
                "busy hu",
                "baad mein",
                "baad me call karna",
                "disconnect",
                "ruk jao",
                "baad mein baat karenge",
                "hum baad mein contact karenge",
            ]) and "kya aap gurgaon" not in lower:
                asyncio.create_task(schedule_delayed_hangup(3.5))

    session_closed = asyncio.Event()

    @session.on("close")
    def on_close(ev) -> None:
        logger.info("Session closed.")
        session_closed.set()

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant):
        if participant.identity.startswith("sip_") or participant.identity != ctx.room.local_participant.identity:
            logger.info("Customer participant disconnected (%s). Terminating call immediately.", participant.identity)
            asyncio.create_task(hangup_call())

    # Start audio session
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
        sip_already_in_room = any(p.identity.startswith("sip_") for p in ctx.room.remote_participants.values())
        if not sip_already_in_room:
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
            except Exception as exc:
                if "already exists" not in str(exc).lower():
                    logger.error("Outbound Vobiz call failed to connect: %s", exc)
                    failure_reason = str(exc)
                    try:
                        await post_call_to_crm(
                            lead_id=lead_id,
                            campaign_id=campaign_id,
                            call_uuid=ctx.room.name,
                            duration_seconds=time.time() - call_start,
                            transcript_list=transcript_items,
                            agent_name=runtime_agent_name,
                            crm_backend_url=meta.get("crm_backend_url") or config.CRM_BACKEND_URL,
                            shared_secret=meta.get("voice_agent_shared_secret") or config.VOICE_AGENT_SHARED_SECRET,
                            forced_disposition="failed",
                            forced_remarks=f"Outbound SIP dial via Vobiz trunk '{outbound_trunk_id}' failed: {failure_reason}",
                        )
                    except Exception:
                        pass
                    await hangup_call()
                    return
        else:
            logger.info("SIP participant %s already dialed by CRM. Waiting for customer answer...", e164_phone)

        # Wait for customer participant to answer
        try:
            await ctx.wait_for_participant()
        except Exception:
            pass

        logger.info("Call answered by customer! Playing initial greeting...")
        await asyncio.sleep(0.6)
        greeting = config.build_outbound_greeting(reason=user_prompt or "enquiry", agent_config=agent_config)
        await session.say(greeting, allow_interruptions=True)
        logger.info("Greeting finished. Conversation active.")
    elif call_type == "outbound" and not outbound_trunk_id:
        logger.warning("No VOBIZ_SIP_TRUNK_ID configured. Operating in test/browser room mode.")
        await ctx.wait_for_participant()
        greeting = config.build_outbound_greeting(reason=user_prompt or "enquiry", agent_config=agent_config)
        await session.say(greeting, allow_interruptions=True)
    else:
        logger.info("Waiting for web participant...")
        await ctx.wait_for_participant()
        await session.say(f"Hello, main {runtime_agent_name} bol rahi hoon Unique Prime Reality, Gurgaon se. How may I help you?", allow_interruptions=True)

    # Silence & Voicemail Watchdog:
    async def silence_watchdog():
        await asyncio.sleep(14)
        if not customer_spoke and not disconnecting:
            logger.info("No customer speech detected within 14s after greeting. Hanging up to save tokens.")
            await hangup_call()
            return

        while not disconnecting:
            await asyncio.sleep(5)
            if customer_spoke and (time.time() - last_customer_speech_time > 28):
                logger.info("Customer silent for >28s. Playing final prompt & ending call.")
                try:
                    await session.say("Lagta hai aap busy hain ya call hold par hai. Aap baad mein call kar sakte hain. Have a nice day!", allow_interruptions=False)
                    await asyncio.sleep(4)
                except Exception:
                    pass
                await hangup_call()
                break

    asyncio.create_task(silence_watchdog())

    # Max duration guard (10 minutes)
    async def enforce_max_duration():
        await asyncio.sleep(config.MAX_CALL_DURATION_SECONDS)
        if not disconnecting:
            logger.warning("Max call duration (%ds) reached. Graceful shutdown.", config.MAX_CALL_DURATION_SECONDS)
            try:
                await session.say("Thank you for your time, have a nice day!", allow_interruptions=False)
                await asyncio.sleep(3)
            except Exception:
                pass
            await hangup_call()

    asyncio.create_task(enforce_max_duration())

    await session_closed.wait()

    duration = time.time() - call_start
    logger.info("Call ended: lead_id=%s, duration=%.1fs, items=%d", lead_id, duration, len(transcript_items))

    await post_call_to_crm(
        lead_id=lead_id,
        campaign_id=campaign_id,
        call_uuid=ctx.room.name,
        duration_seconds=duration,
        transcript_list=transcript_items,
        agent_name=runtime_agent_name,
        crm_backend_url=meta.get("crm_backend_url") or config.CRM_BACKEND_URL,
        shared_secret=meta.get("voice_agent_shared_secret") or config.VOICE_AGENT_SHARED_SECRET,
    )


def run_app_main():
    ws_url = (config.LIVEKIT_URL or "").strip().strip('"').strip("'")
    api_key = (config.LIVEKIT_API_KEY or "").strip().strip('"').strip("'")
    api_secret = (config.LIVEKIT_API_SECRET or "").strip().strip('"').strip("'")

    logger.info("=== LIVEKIT CREDENTIAL DIAGNOSTIC ===")
    logger.info("LIVEKIT_URL: %s", ws_url)
    logger.info("LIVEKIT_API_KEY: '%s...' (length: %d, starts_with_API: %s)", api_key[:6] if api_key else "EMPTY", len(api_key), api_key.startswith("API"))
    logger.info("LIVEKIT_API_SECRET: '%s...' (length: %d, starts_with_ST: %s, starts_with_API: %s)", api_secret[:6] if api_secret else "EMPTY", len(api_secret), api_secret.startswith("ST_") or api_secret.startswith("ST"), api_secret.startswith("API"))

    if not ws_url:
        logger.error("ERROR: LIVEKIT_URL is not set.")
        sys.exit(1)

    if api_secret.startswith("API") and not api_key.startswith("API"):
        logger.warning("SWAP DETECTED: LIVEKIT_API_KEY and LIVEKIT_API_SECRET were swapped! Auto-correcting...")
        api_key, api_secret = api_secret, api_key

    if api_secret.startswith("ST_") or api_secret.startswith("ST"):
        logger.error("FATAL ERROR: LIVEKIT_API_SECRET is set to a SIP Trunk ID!")

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
        "num_idle_processes": 1,
        "job_memory_warn_mb": 260,
        "job_memory_limit_mb": 380,
    }
    if job_exec is not None:
        worker_kwargs["job_executor_type"] = job_exec
    worker_kwargs["ws_url"] = ws_url
    worker_kwargs["api_key"] = api_key
    worker_kwargs["api_secret"] = api_secret

    logger.info(
        "Connecting worker '%s' to %s with Key '%s...'",
        config.LIVEKIT_AGENT_NAME,
        ws_url,
        api_key[:6] if api_key else "NONE",
    )
    cli.run_app(WorkerOptions(**worker_kwargs))


if __name__ == "__main__":
    run_app_main()
