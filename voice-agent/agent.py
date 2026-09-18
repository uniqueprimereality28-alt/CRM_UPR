"""
Unique Prime Reality - AI Outbound Calling Agent (Vrinda)
Powered by LiveKit + Vobiz SIP + Deepgram STT + Groq LLM + Sarvam AI TTS
"""

import asyncio
import ctypes
import gc
import json
import logging
import os
import re
import sys
import time
from typing import Optional

try:
    import psutil
    _PROCESS = psutil.Process()
except Exception:
    psutil = None
    _PROCESS = None


def _rss_mb() -> float:
    """Current resident memory of this process, in MB (0 if psutil unavailable)."""
    if _PROCESS is None:
        return 0.0
    try:
        return round(_PROCESS.memory_info().rss / (1024 * 1024), 1)
    except Exception:
        return 0.0


def _release_memory_to_os() -> None:
    """Force Python GC and hand freed heap pages back to the OS (glibc malloc_trim)."""
    gc.collect()
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except Exception:
        pass


os.environ.setdefault("MALLOC_ARENA_MAX", "2")
os.environ.setdefault("PYTHONMALLOC", "malloc")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")
os.environ.setdefault("LIVEKIT_NUM_IDLE_PROCESSES", "0")

import aiohttp
from dotenv import load_dotenv
from livekit import api, rtc
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
    "endpointing": {"mode": "fixed", "min_delay": 0.5, "max_delay": 2.0},
    "interruption": {
        "enabled": True,
        "mode": "vad",
        "min_duration": 0.5,
        "min_words": 1,
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


# ─── CRM Sync & Structured Key-Points Extraction ───

async def extract_call_signals_with_llm(transcript: str, api_key_override: Optional[str] = None) -> dict:
    """Use Groq / OpenAI to extract structured requirements and scoring signals in key points from transcript."""
    fallback_result = {
        "summary": "Call ended with no meaningful conversation captured.",
        "disposition": "no_answer",
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

    prompt = f"""You are an expert real estate CRM data analyst. Analyze this phone conversation transcript between Vrinda (Unique Prime Reality AI consultant) and a customer.

TRANSCRIPT:
{transcript}

Extract the following information in pure JSON format with no markdown wrappers:
{{
  "summary": "Key points summary in bullet format: • Requirement (BHK, Budget, Location, Purpose) • Discussion highlights • Next step/Outcome",
  "disposition": "connected | callback | not_interested | wrong_number | busy",
  "requirements": {{
    "property_type": "residential | commercial | studio | penthouse",
    "purpose": "personal_use | investment",
    "budget": "extracted budget string e.g. Under 3 Cr, 1.5 Cr, 90L",
    "bhk": "e.g. 2 BHK, 3 BHK, 4 BHK, studio, penthouse",
    "location_preference": "e.g. Dwarka Expressway, Manesar Corridor, Golf Course Ext, Sohna Road",
    "possession_timeline": "immediate, 30 days, 6 months, or null"
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
  "remarks": "Notable customer preferences, objections or remarks"
}}"""

    try:
        api_key = api_key_override or config.GROQ_API_KEY or config.OPENAI_API_KEY or config.GROK_API_KEY
        base_url = "https://api.groq.com/openai/v1" if (api_key_override or config.GROQ_API_KEY) else ("https://api.openai.com/v1" if config.OPENAI_API_KEY else "https://api.x.ai/v1")
        model = config.GROQ_MODEL if (api_key_override or config.GROQ_API_KEY) else (config.OPENAI_MODEL if config.OPENAI_API_KEY else config.GROK_MODEL)
        if model in ["llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "llama3-70b-8192", "llama3-8b-8192", ""]:
            model = "qwen/qwen3.8-27b"

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


async def post_call_to_crm(
    lead_id: str,
    campaign_id: Optional[str],
    call_uuid: str,
    duration_seconds: float,
    transcript_list: list[dict],
    agent_name: str = config.AGENT_NAME,
    crm_backend_url: Optional[str] = None,
    shared_secret: Optional[str] = None,
    groq_api_key: Optional[str] = None,
    forced_disposition: Optional[str] = None,
    forced_remarks: Optional[str] = None,
) -> None:
    """Post final transcript & extracted scoring signals to CRM /api/ai/calls/ingest endpoint.

    IMPORTANT: this is the ONLY place the CRM learns what happened to a call.
    Every code path that can end a call (successful hangup, SIP dial failure,
    or an unexpected crash) MUST reach this function — otherwise the lead's
    ai_call_status is left stuck on "dialing" forever and the CRM shows a
    false "success" with no way to tell the call never actually happened.

    forced_disposition / forced_remarks let a failure path report the real
    outcome directly (e.g. "failed" + the SIP error) instead of running the
    transcript through the LLM extractor, which has nothing to analyze when
    the call never connected and would otherwise default to a misleading
    "connected"/"no_answer" guess.
    """
    target_backend_url = (crm_backend_url or config.CRM_BACKEND_URL or "https://crm-upr-1.onrender.com").rstrip("/")
    secret = shared_secret or config.VOICE_AGENT_SHARED_SECRET or "rxci_voice_9247xv"

    if not target_backend_url:
        logger.warning("CRM_BACKEND_URL is not set. Skipping CRM ingest.")
        return

    full_transcript_text = "\n".join(f"{item.get('speaker')}: {item.get('text')}" for item in transcript_list)

    if forced_disposition:
        analysis = {
            "summary": forced_remarks or f"Call ended without connecting. Disposition: {forced_disposition}.",
            "disposition": forced_disposition,
            "requirements": {},
            "signals": [],
            "urgency_score": 0,
            "wants_site_visit": False,
            "wants_brochure": False,
            "whatsapp_opt_in": False,
            "human_transfer_required": False,
            "next_followup_days": 1,
            "remarks": forced_remarks or "",
        }
    else:
        analysis = await extract_call_signals_with_llm(full_transcript_text, api_key_override=groq_api_key)

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

    ingest_url = f"{target_backend_url}/api/ai/calls/ingest"
    headers = {
        "Content-Type": "application/json",
        "X-Voice-Agent-Secret": secret,
    }

    try:
        logger.info("Posting call results to CRM at %s (lead_id=%s, turns=%d)...", ingest_url, lead_id, len(transcript_list))
        async with aiohttp.ClientSession() as session:
            async with session.post(ingest_url, json=payload, headers=headers, timeout=25) as resp:
                if resp.status in (200, 201):
                    logger.info("Call successfully synced to CRM! Lead: %s, Signals: %s", lead_id, analysis.get("signals"))
                else:
                    logger.error("Failed to sync call to CRM (%s): %s", resp.status, await resp.text())
    except Exception as e:
        logger.error("Error posting call to CRM ingest endpoint (%s): %s", ingest_url, e)


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
    """Thin wrapper around _entrypoint_impl.

    Every code path inside _entrypoint_impl that can end a call is expected
    to report the outcome to the CRM via post_call_to_crm(). This wrapper is
    the last line of defence: if something crashes BEFORE that point (a bad
    plugin API key, a metadata parsing bug, an unexpected exception from the
    LiveKit SDK, etc.), the job would otherwise just die silently — LiveKit
    shows the dispatch as accepted, the CRM shows "dialing" forever, and the
    phone never rings, with no record anywhere of why. Catching it here and
    forcing a "failed" ingest call closes that gap.
    """
    try:
        await _entrypoint_impl(ctx)
    except Exception as exc:
        logger.exception("Unhandled crash in call entrypoint: %s", exc)
        lead_id = None
        campaign_id = None
        crm_url = None
        crm_secret = None
        try:
            meta = json.loads(ctx.job.metadata) if ctx.job.metadata else {}
            lead_id = meta.get("lead_id") or meta.get("id")
            campaign_id = meta.get("campaign_id")
            crm_url = meta.get("crm_backend_url")
            crm_secret = meta.get("voice_agent_shared_secret")
        except Exception:
            pass
        if lead_id:
            try:
                await post_call_to_crm(
                    lead_id=str(lead_id),
                    campaign_id=campaign_id,
                    call_uuid=(ctx.room.name if ctx.room else "unknown"),
                    duration_seconds=0,
                    transcript_list=[],
                    crm_backend_url=crm_url or config.CRM_BACKEND_URL,
                    shared_secret=crm_secret or config.VOICE_AGENT_SHARED_SECRET,
                    forced_disposition="failed",
                    forced_remarks=(
                        f"The calling agent crashed before the call could be placed or completed: {exc}. "
                        f"This usually means a missing/invalid API key (Groq, Deepgram, Sarvam) or LiveKit "
                        f"SIP trunk config — check the voice-agent service logs on Render for the full traceback."
                    ),
                )
            except Exception as report_exc:
                logger.error("Also failed to report crash back to CRM: %s", report_exc)
        else:
            logger.error("Could not report crash to CRM: no lead_id in job metadata.")
        # Re-raise so LiveKit's own job-failure bookkeeping still sees it.
        raise


async def _entrypoint_impl(ctx: JobContext) -> None:
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

    logger.info(
        "Job started | lead_id=%s | phone=%s | type=%s | rss_mb=%.1f",
        lead_id, phone_number, call_type, _rss_mb(),
    )

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info("Connected to LiveKit room: %s", ctx.room.name)

    call_start = time.time()
    transcript_items: list[dict] = []

    vad_instance = ctx.proc.userdata.get("vad") or silero.VAD.load(
        min_speech_duration=0.15,
        min_silence_duration=0.5,
        prefix_padding_duration=0.3,
        activation_threshold=0.50,
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
        logger.info("LLM initialized with Groq (Ultra-Low Latency): %s", chosen_groq_model)
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
        logger.info("LLM initialized with Grok (xAI): %s", config.GROK_MODEL)
    else:
        logger.error("WARNING: No LLM API key found in metadata or environment! Groq responses will fail.")
        llm_instance = openai.LLM(
            model="qwen/qwen3.8-27b",
            base_url="https://api.groq.com/openai/v1",
            temperature=0.3,
        )

    # 2. Initialize STT (Deepgram Nova-3)
    deepgram_key = meta.get("deepgram_api_key") or config.DEEPGRAM_API_KEY
    if not deepgram_key:
        logger.error("WARNING: No DEEPGRAM_API_KEY found in metadata or environment! STT will fail.")
    else:
        logger.info("STT initialized with Deepgram Nova-3")

    stt_instance = deepgram.STT(
        model=config.DEEPGRAM_STT_MODEL,
        language=config.DEEPGRAM_STT_LANGUAGE,
        api_key=deepgram_key or None,
    )

    # 3. Initialize TTS (Sarvam AI Indian voices -> Deepgram Aura fallback)
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
                output_audio_codec="mp3",
            )
            logger.info("TTS initialized with Sarvam AI: model=%s, speaker=%s, lang=%s, codec=mp3", config.SARVAM_MODEL, sarvam_speaker, sarvam_lang)
        except TypeError:
            try:
                tts_instance = sarvam.TTS(
                    model=config.SARVAM_MODEL,
                    target_language_code=sarvam_lang,
                    speaker=sarvam_speaker,
                    api_key=sarvam_key,
                )
                logger.info("TTS initialized with Sarvam AI (default codec): model=%s, speaker=%s, lang=%s", config.SARVAM_MODEL, sarvam_speaker, sarvam_lang)
            except Exception as e:
                logger.warning("Failed to initialize Sarvam TTS (%s). Falling back to Deepgram.", e)
        except Exception as e:
            logger.warning("Failed to initialize Sarvam TTS with mp3 (%s). Falling back to Deepgram.", e)

    if tts_instance is None:
        tts_instance = deepgram.TTS(
            model=config.DEEPGRAM_TTS_MODEL,
            api_key=deepgram_key or config.DEEPGRAM_API_KEY or None,
        )
        logger.info("TTS initialized with Deepgram Aura: %s", config.DEEPGRAM_TTS_MODEL)

    # 4. System prompt
    system_prompt = config.build_runtime_system_prompt(call_type, agent_config, user_prompt, inventory=inventory)

    # 5. Agent & Session (Pass stt, llm, tts, vad to BOTH to guarantee media pipeline initialization)
    agent = Agent(
        instructions=system_prompt,
        stt=stt_instance,
        llm=llm_instance,
        tts=tts_instance,
        vad=vad_instance,
        turn_handling=VOICE_TURN_HANDLING,
    )

    session = AgentSession(
        vad=vad_instance,
        stt=stt_instance,
        llm=llm_instance,
        tts=tts_instance,
        turn_handling=VOICE_TURN_HANDLING,
    )

    disconnecting = False

    async def hangup_call():
        """Proactively end the SIP telephony call immediately by deleting the LiveKit room.
        This forces LiveKit to send a SIP BYE to Vobiz, terminating the phone line without lingering."""
        nonlocal disconnecting
        if disconnecting:
            return
        disconnecting = True
        logger.info("Ending call: deleting LiveKit room %s to terminate Vobiz SIP trunk...", ctx.room.name)
        try:
            await ctx.api.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))
            logger.info("Room %s deleted successfully; phone line hung up.", ctx.room.name)
        except Exception as e:
            logger.warning("Error deleting room for SIP hangup: %s", e)
        ctx.shutdown()

    async def schedule_delayed_hangup(delay_sec: float = 3.5):
        if disconnecting:
            return
        logger.info("Exit trigger detected. Closing call after %.1fs for speech completion...", delay_sec)
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

        # Drop-off rule check: if Vrinda says goodbye or wrap-up
        lower = text.lower()
        if speaker == runtime_agent_name:
            if any(phrase in lower for phrase in [
                "thank you for your time, have a nice day",
                "have a nice day",
                "have a wonderful day",
                "shukriya, have a nice day",
                "hum baad mein contact karenge",
            ]) and "kya aap gurgaon" not in lower:
                asyncio.create_task(schedule_delayed_hangup(3.5))

    session_closed = asyncio.Event()

    @session.on("close")
    def on_close(ev) -> None:
        logger.info("Session closed.")
        session_closed.set()

    # Immediate hangup when the customer disconnects their mobile phone
    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant):
        if participant.identity.startswith("sip_") or participant.identity != ctx.room.local_participant.identity:
            logger.info("Customer participant disconnected (%s). Terminating call immediately.", participant.identity)
            asyncio.create_task(hangup_call())

    # Observability: log participant attribute changes and track subscriptions
    @ctx.room.on("participant_attributes_changed")
    def on_attributes_changed(changed_attrs: dict, participant: rtc.Participant):
        if "sip.callStatus" in changed_attrs:
            logger.info("SIP attribute changed for %s: callStatus='%s'", participant.identity, changed_attrs["sip.callStatus"])

    @ctx.room.on("track_subscribed")
    def on_track_subscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
        logger.info("Subscribed to %s track %s from participant %s", publication.kind, track.sid, participant.identity)

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
        target_sip_id = f"sip_{e164_phone}"

        # Check if SIP participant was already dialed by CRM backend
        sip_already_in_room = any(p.identity.startswith("sip_") for p in ctx.room.remote_participants.values())
        if not sip_already_in_room:
            logger.info("Dialling %s via Vobiz SIP trunk %s ...", e164_phone, outbound_trunk_id)
            try:
                await ctx.api.sip.create_sip_participant(
                    api.CreateSIPParticipantRequest(
                        room_name=ctx.room.name,
                        sip_trunk_id=outbound_trunk_id,
                        sip_call_to=e164_phone,
                        participant_identity=target_sip_id,
                        wait_until_answered=False,
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
            logger.info("SIP participant %s already registered in room. Waiting for customer to answer...", e164_phone)

        # Explicitly wait for the customer to answer the phone (sip.callStatus == 'active')
        logger.info("Dial active. Waiting for customer %s to pick up...", e164_phone)
        answered = False
        sip_participant = None

        for wait_tick in range(120):  # 120 * 0.5s = 60s timeout
            for p in ctx.room.remote_participants.values():
                if p.identity.startswith("sip_") or p.identity == target_sip_id:
                    sip_participant = p
                    break

            if sip_participant:
                call_status = (sip_participant.attributes.get("sip.callStatus") or "").lower()
                has_audio_track = any(
                    pub.kind == rtc.TrackKind.KIND_AUDIO 
                    for pub in sip_participant.track_publications.values()
                )

                if wait_tick % 6 == 0:
                    logger.info("SIP status for %s: '%s' (audio_tracks=%s)", 
                                sip_participant.identity, call_status or "dialing", has_audio_track)

                # Active status or published audio track indicates call has been answered by human
                if call_status == "active" or has_audio_track:
                    logger.info("Customer answered phone call! (callStatus='%s', has_audio=%s)", call_status, has_audio_track)
                    answered = True
                    break
                elif call_status in ("hangup", "rejected", "busy", "failed"):
                    logger.warning("Call ended before answer (status: %s)", call_status)
                    break

            await asyncio.sleep(0.5)

        if not answered:
            logger.warning("Customer did not answer within timeout or rejected call. Terminating.")
            await hangup_call()
            return

        # Explicitly link the session to the answered SIP participant using participant identity string
        try:
            if sip_participant and hasattr(session, "room_io") and session.room_io:
                session.room_io.set_participant(sip_participant.identity)
                logger.info("Linked AgentSession to customer participant: %s", sip_participant.identity)
        except Exception as e:
            logger.warning("Could not explicitly link participant: %s", e)

        # Settle pause for carrier RTP media bridging (1.0s prevents clipping initial greeting)
        logger.info("Carrier RTP bridge stabilizing (1.0s)...")
        await asyncio.sleep(1.0)

        greeting = config.build_outbound_greeting(reason=user_prompt or "enquiry", agent_config=agent_config)
        logger.info("Speaking initial greeting to customer: '%s'", greeting)
        try:
            # allow_interruptions=False is CRITICAL for outbound greeting:
            # carrier line pickup clicks/noise must not kill the opening greeting!
            await session.say(greeting, allow_interruptions=False)
            logger.info("Greeting finished. Conversation active.")
        except Exception as e:
            logger.error("Failed to speak greeting with Sarvam TTS: %s", e)
    elif call_type == "outbound" and not outbound_trunk_id:
        logger.warning("No VOBIZ_SIP_TRUNK_ID configured. Operating in test/browser room mode.")
        await ctx.wait_for_participant()
        greeting = config.build_outbound_greeting(reason=user_prompt or "enquiry", agent_config=agent_config)
        await session.say(greeting, allow_interruptions=True)
    else:
        logger.info("Waiting for web participant...")
        await ctx.wait_for_participant()
        await session.say(f"Hello, main {runtime_agent_name} bol rahi hoon Unique Prime Reality, Gurgaon se. How may I help you?", allow_interruptions=True)

    # Silence & Voicemail Watchdog to prevent token wastage:
    # 1. If customer doesn't speak within 20s after greeting (answering machine / dead air), hang up.
    # 2. If customer goes silent for >28s during the conversation, prompt and hang up.
    async def silence_watchdog():
        await asyncio.sleep(20)
        if not customer_spoke and not disconnecting:
            logger.info("No customer speech detected within 20s after greeting (voicemail or dead line). Hanging up to save tokens.")
            await hangup_call()
            return

        while not disconnecting:
            await asyncio.sleep(4)
            if (time.time() - last_customer_speech_time) > 28 and not disconnecting:
                logger.info("Customer silent for >28s during call. Prompting and hanging up.")
                try:
                    await session.say("Aapki aawaz nahi aa rahi hai, hum baad mein contact karenge. Thank you!", allow_interruptions=False)
                    await asyncio.sleep(2.5)
                except Exception:
                    pass
                await hangup_call()
                return

    watchdog_task = asyncio.create_task(silence_watchdog())

    # Max call duration safeguard
    async def enforce_max_duration() -> None:
        await asyncio.sleep(config.MAX_CALL_DURATION_SECONDS)
        logger.warning("Max duration reached — closing call.")
        try:
            await session.say("Thank you for your time. Have a wonderful day!", allow_interruptions=False)
            await asyncio.sleep(3.5)
        except Exception:
            pass
        await hangup_call()

    duration_task = asyncio.create_task(enforce_max_duration())

    try:
        await session_closed.wait()
    finally:
        duration_task.cancel()
        watchdog_task.cancel()
        call_duration = time.time() - call_start
        logger.info(
            "Call session complete. Duration: %.1fs, Turns: %d, rss_mb=%.1f",
            call_duration, len(transcript_items), _rss_mb(),
        )

        # Post results back to CRM
        crm_url = meta.get("crm_backend_url") or config.CRM_BACKEND_URL
        crm_secret = meta.get("voice_agent_shared_secret") or config.VOICE_AGENT_SHARED_SECRET
        await post_call_to_crm(
            lead_id=lead_id,
            campaign_id=campaign_id,
            call_uuid=ctx.room.name,
            duration_seconds=call_duration,
            transcript_list=transcript_items,
            agent_name=runtime_agent_name,
            crm_backend_url=crm_url,
            shared_secret=crm_secret,
            groq_api_key=groq_key,
        )

        # Drop per-call objects explicitly and return freed heap memory to the OS
        del vad_instance, llm_instance, stt_instance, tts_instance, agent, session
        _release_memory_to_os()
        logger.info("Post-cleanup rss_mb=%.1f", _rss_mb())


def run_app_main():
    ws_url = (config.LIVEKIT_URL or "").strip().strip('"').strip("'")
    api_key = (config.LIVEKIT_API_KEY or "").strip().strip('"').strip("'")
    api_secret = (config.LIVEKIT_API_SECRET or "").strip().strip('"').strip("'")

    logger.info("=== LIVEKIT CREDENTIAL DIAGNOSTIC ===")
    logger.info("LIVEKIT_URL: %s", ws_url)
    logger.info("LIVEKIT_API_KEY: '%s...' (length: %d, starts_with_API: %s)", api_key[:6] if api_key else "EMPTY", len(api_key), api_key.startswith("API"))
    logger.info("LIVEKIT_API_SECRET: '%s...' (length: %d, starts_with_ST: %s, starts_with_API: %s)", api_secret[:6] if api_secret else "EMPTY", len(api_secret), api_secret.startswith("ST_") or api_secret.startswith("ST"), api_secret.startswith("API"))

    if not ws_url:
        logger.error("ERROR: LIVEKIT_URL is not set. Please configure LIVEKIT_URL in Render Environment variables.")
        sys.exit(1)

    if api_secret.startswith("API") and not api_key.startswith("API"):
        logger.warning("SWAP DETECTED: LIVEKIT_API_KEY and LIVEKIT_API_SECRET were swapped! Auto-correcting...")
        api_key, api_secret = api_secret, api_key

    if api_secret.startswith("ST_") or api_secret.startswith("ST"):
        logger.error("FATAL ERROR: LIVEKIT_API_SECRET is set to a SIP Trunk ID ('%s...')! A SIP Trunk ID cannot be used as an API Secret. Please go to cloud.livekit.io -> Project Settings -> Keys, copy the real API Secret, and paste it into LIVEKIT_API_SECRET in Render Environment tab.", api_secret[:8])

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
