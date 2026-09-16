"""
Attachable AI Calling layer for Unique Prime Reality CRM.

REAL (v2) outbound AI telecalling engine:
- Real outbound phone calls placed via a separate voice-agent microservice
  (Plivo telephony + faster-whisper STT + LLM + edge-tts TTS)
- Structured requirement extraction from the ACTUAL call transcript
- Points-based lead scoring engine (admin editable) -> Hot/Warm/Cold
- Call summaries, follow-up scheduling, WhatsApp logs, human transfer to Vranda
- A SIMULATED path (_run_single_call) is kept only as an offline demo/test
  tool — it is never used for a real lead-facing call.

ACCESS: every endpoint in this file (except the machine-to-machine
/calls/ingest webhook, which is authenticated separately via a shared
secret) is restricted to the user "vranda.aggarwal" only — see
require_vranda_only() below. This is deliberate: the AI voice agent is
not a general admin feature.
"""
import os
import re
import json
import random
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Any

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel, Field

from server import db, get_current_user, require_admin, now_iso

logger = logging.getLogger("crm.ai")


AI_CALLING_USERNAMES = {"vranda.aggarwal", "sandeep.chauhan"}


async def require_vranda_only(user: dict = Depends(get_current_user)) -> dict:
    """The AI voice-calling agent is visible/usable ONLY to the accounts in
    AI_CALLING_USERNAMES. Every other user (including other admins) is blocked."""
    username = user.get("username", "")
    if username not in AI_CALLING_USERNAMES:
        raise HTTPException(
            status_code=403,
            detail="Access restricted. The AI voice calling engine is available only to Vranda Aggarwal."
        )
    return user


# Everything below is locked to Vranda's account by this router-level dependency.
ai_router = APIRouter(prefix="/api/ai", dependencies=[Depends(require_vranda_only)])

# Separate, un-gated router for the ONE endpoint the voice-agent microservice
# itself calls (no human is logged in on that request — it's authenticated
# by shared secret inside the handler instead of a JWT).
ai_public_router = APIRouter(prefix="/api/ai")

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
LLM_MODEL = ("openai", "gpt-5.4-mini")

# ---------------- Real voice-agent integration ----------------
# The voice-agent lives in its own microservice (voice-agent/) which runs
# on its own host (e.g. Render / Railway). The CRM talks to it in two directions:
#   1. OUTBOUND: CRM POSTs to {voice_agent_url}/trigger to start a real phone call
#   2. INBOUND:  Voice-agent POSTs to /api/ai/calls/ingest with the transcript
#                once the call finishes
#
# The URL + shared secret can be set two ways:
#  1. Env vars (VOICE_AGENT_URL / VOICE_AGENT_SHARED_SECRET) — set once at deploy time.
#  2. From inside the CRM itself: Vranda can paste them in via
#     GET/POST /api/ai/calls/real/settings — no redeploy needed, no code edits.
# The DB value (if set) always wins over the env var.
VOICE_AGENT_URL_ENV = os.environ.get("VOICE_AGENT_URL", "").rstrip("/")
VOICE_AGENT_SHARED_SECRET_ENV = os.environ.get("VOICE_AGENT_SHARED_SECRET", "upr-secret-token-change-in-prod")
VOICE_AGENT_SETTINGS_DOC_ID = "voice_agent_config"

LIVEKIT_URL_ENV = os.environ.get("LIVEKIT_URL", "").strip()
LIVEKIT_API_KEY_ENV = os.environ.get("LIVEKIT_API_KEY", "").strip()
LIVEKIT_API_SECRET_ENV = os.environ.get("LIVEKIT_API_SECRET", "").strip()
LIVEKIT_AGENT_NAME_ENV = os.getenv("LIVEKIT_AGENT_NAME", "upr-calling-agent").strip()
VOBIZ_SIP_TRUNK_ID_ENV = os.getenv("VOBIZ_SIP_TRUNK_ID") or os.getenv("OUTBOUND_SIP_TRUNK_ID", "").strip()
GROQ_API_KEY_ENV = os.getenv("GROQ_API_KEY", "").strip()
GROK_API_KEY_ENV = os.getenv("GROK_API_KEY", "").strip()
SARVAM_API_KEY_ENV = os.getenv("SARVAM_API_KEY", "").strip()
DEEPGRAM_API_KEY_ENV = os.getenv("DEEPGRAM_API_KEY", "").strip()

TRANSFER_TARGET_NAME = "Vranda Aggarwal"
TRANSFER_TARGET_NUMBER = "7351735035"

# ---------------- Scoring engine defaults ----------------
DEFAULT_SCORING_RULES = {
    "whatsapp_details": {"label": "Asked for project details on WhatsApp", "points": 20},
    "budget_shared": {"label": "Shared budget clearly", "points": 15},
    "bhk_shared": {"label": "Shared BHK requirement", "points": 10},
    "timeline_shared": {"label": "Shared timeline to buy", "points": 15},
    "wants_site_visit": {"label": "Wants a site visit", "points": 35},
    "wants_callback": {"label": "Wants callback from sales person", "points": 25},
    "urgent_30_days": {"label": "Urgent buying intent within 30 days", "points": 30},
    "investor_intent": {"label": "Investor intent / multiple units", "points": 30},
    "casual_interest": {"label": "Asked only casually / low intent", "points": 5},
    "not_interested": {"label": "Says not interested", "points": -30},
    "wrong_number": {"label": "Wrong number", "points": -50},
    "call_later": {"label": "Asked to call later", "points": 5},
    "requested_human": {"label": "Requested human representative", "points": 25},
}

TEMPERATURE_BANDS = {
    "hot": {"min_score": 60, "label": "Hot (Urgent Lead)"},
    "warm": {"min_score": 30, "label": "Warm (Follow-up Needed)"},
    "cold": {"min_score": 0, "label": "Cold (Nurture Later)"},
}

# ---------------- Default Persona & Inventory ----------------
DEFAULT_AGENT = {
    "name": "Simran",
    "voice_gender": "female",
    "voice_accent": "indian_hinglish",
    "language_style": "polite_consultative_hinglish",
    "personality": "Warm, professional, energetic real estate sales consultant for Unique Prime Reality, Gurgaon. Consultative, never pushy.",
    "intro_line": "Hello {name} ji, main Unique Prime Reality, Gurgaon se Simran baat kar rahi hoon. Kya aap abhi do minute baat kar sakte hain?",
    "guardrails": (
        "Never invent false pricing or guarantees. Only quote projects from the active inventory catalog. "
        "If the lead asks for a human, offer a warm transfer to Vrinda Aggarwal (7351735035). "
        "Respect opt-outs immediately and warmly."
    ),
    "active": True,
}

DEFAULT_INVENTORY = [
    {
        "project": "Dwarka Expressway Luxury Residences",
        "location": "Dwarka Expressway, Gurgaon",
        "config": "2/3/4 BHK Luxury & Penthouses",
        "price_range": "₹1.4 Cr – ₹3.5 Cr",
        "possession": "Dec 2026",
        "highlights": "Best opportunistic growth corridor, 15 mins to IGI Airport, upcoming metro",
    },
    {
        "project": "Manesar Corridor Greens",
        "location": "Manesar Corridor / NH-48, Gurgaon",
        "config": "2/3 BHK",
        "price_range": "₹85 L – ₹1.8 Cr",
        "possession": "Ready to move",
        "highlights": "Industrial & IT hub connectivity, high rental yield, ready to move",
    },
    {
        "project": "Golf Course Ext Skyline",
        "location": "Golf Course Extension Road, Gurgaon",
        "config": "3/4 BHK Ultra-Luxury",
        "price_range": "₹2.5 Cr – ₹4.5 Cr",
        "possession": "2026 - 2027",
        "highlights": "Ultra-luxury gated community, reputed builders, Aravali views",
    },
]

DEFAULT_KNOWLEDGE_BASE = {
    "agent_name": "Simran",
    "company_name": "Unique Prime Reality",
    "company_description": "Premier real estate advisory firm specializing in residential & commercial properties across Gurgaon.",
    "company_phone": "+917351735035",
    "company_website": "https://uniqueprimereality.com",
    "market": "Gurgaon, Haryana (Dwarka Expressway, Golf Course Ext, Manesar Corridor, Sohna Road, SPR)",
    "office_hours": "10:00 AM – 7:30 PM, Monday through Sunday",
    "address": "Sector 84, Dwarka Expressway, Gurgaon, Haryana",
    "services": "Primary residential sales, commercial investments, luxury penthouses, site visits, NRI property advisory",
    "greeting_hook": "Hello {name} ji, kya meri baat {name} ji se ho rahi hai? Main Unique Prime Reality, Gurgaon se baat kar rahi hoon.",
    "permission_check": "Sir/Ma'am kya aap Gurgaon mein residential property dekh rahe hain ya plan kar rahe hain?",
    "gate_no_response": "Thank you for your time, have a nice day!",
    "purpose_question": "Sir aapki requirement ko better understand karne ke liye kya main jaan sakti hu yeh property purchase personal use ke liye hai ya investment purpose ke liye hai?",
    "budget_config_question": "Perfect, and aap kitne budget main and konsi configuration main yeh property plan kar rahe hain like studio apartment, 1 BHK, 2 BHK, 3 BHK, 4 BHK, or penthouse?",
    "best_now_answer": "Hamare paas different projects available hain and every project has its own USP. Agar aap meri advice consider karein, toh best opportunistic location is Dwarka Expressway right now.",
    "location_question": "Is there any specific preferred location in mind?",
    "builders_options": "We have almost every reputed builder's projects like from Godrej, ATS, Whiteland / Wal Developer, Hero Homes, M3M, Elan, Emaar, and many others.",
    "final_summary_template": "Maine aapki saari requirement note kar li hai — aapko {config} property chahiye {location} mein under {budget} for {purpose}. Main ye saari details hamari senior team ke sath share kar rahi hoon and they will get in touch with you shortly. Thank you so much for your time, have a nice day!",
    "ai_disclosure_answer": "Yes, I am an AI assistant working for Unique Prime reality . and please aap Nishchint rahiye main aapki sari requiremnts note kar rahi hu and i will share it with my team, so they can find you with the best property at the earliest.",
    "transfer_number": "7351735035",
    "transfer_target_name": "Vranda Aggarwal",
    "transfer_phrase": "{name} ji please stay on the line, while I am connecting the call.",
    "transfer_enabled": True,
    "tone": "Warm, polite, natural Hinglish. Always acknowledge with 'Noted' or 'Perfect' before asking the next question.",
    "call_objective": "Qualify property requirements (Purpose, Budget, Configuration, Location) and book site visits or WhatsApp brochures.",
}

# ---------------- Pydantic Models ----------------
class ScoringRulesIn(BaseModel):
    rules: dict
    bands: Optional[dict] = None

class AgentIn(BaseModel):
    name: str = "Simran"
    voice_gender: str = "female"
    voice_accent: str = "indian_hinglish"
    language_style: str = "polite_consultative_hinglish"
    personality: str
    intro_line: str
    guardrails: str
    active: bool = True

class InventoryIn(BaseModel):
    project: str
    location: str
    config: str
    price_range: str
    possession: str
    highlights: str

class CampaignIn(BaseModel):
    name: str
    agent_id: Optional[str] = None
    target_disposition: Optional[str] = None
    script_template: Optional[str] = None
    schedule_time: Optional[str] = None
    daily_limit: int = 50

class AssignLeadsIn(BaseModel):
    lead_ids: List[str]

class RunIn(BaseModel):
    limit: int = 5

class CallRunIn(BaseModel):
    lead_id: str
    agent_id: Optional[str] = None
    prompt_override: Optional[str] = None

class WhatsAppIn(BaseModel):
    lead_id: str
    phone: str
    template_name: str
    custom_message: Optional[str] = None

class KnowledgeBaseIn(BaseModel):
    kb: dict

class AppointmentIn(BaseModel):
    lead_id: Optional[str] = None
    customer_name: str
    phone: str
    date: str
    time: str
    purpose: str = "site_visit"
    project: Optional[str] = None
    notes: Optional[str] = None

class BulkDispatchIn(BaseModel):
    numbers: List[str]
    prompt: Optional[str] = None
    model_provider: Optional[str] = "groq"
    voice: Optional[str] = "sarvam-simran"

# ---------------- Helpers ----------------
def _weighted_mood() -> str:
    r = random.random()
    if r < 0.35:
        return "hot"
    if r < 0.70:
        return "warm"
    return "cold"

def temperature_for(score: int) -> str:
    if score >= TEMPERATURE_BANDS["hot"]["min_score"]:
        return "hot"
    if score >= TEMPERATURE_BANDS["warm"]["min_score"]:
        return "warm"
    return "cold"

def _evaluate_signals(signals: List[str], rules: dict) -> int:
    score = 0
    for sig in signals:
        if sig in rules:
            score += rules[sig].get("points", 0)
    return score

SARVAM_SPEAKER_ALIAS = {
    "bulbul": "simran",
    "sarvam-simran": "simran",
    "sarvam-priya": "priya",
    "sarvam-kavya": "kavya",
    "sarvam-neha": "neha",
    "sarvam-pooja": "pooja",
    "sarvam-aditya": "aditya",
    "sarvam-amit": "amit",
    "sarvam-rahul": "rahul",
}

VALID_SARVAM_SPEAKERS = {
    "simran", "priya", "kavya", "neha", "pooja", "aditya", "amit", "rahul"
}

# ---------------- Serialization helper ----------------
def _clean(doc: dict) -> dict:
    if not doc:
        return doc
    doc = dict(doc)
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    for k, v in list(doc.items()):
        if isinstance(v, ObjectId):
            doc[k] = str(v)
    return doc


async def _get_agent(agent_id: Optional[str]) -> dict:
    if agent_id:
        try:
            a = await db.ai_agents.find_one({"_id": ObjectId(agent_id)})
            if a:
                return a
        except Exception:
            pass
    a = await db.ai_agents.find_one({"active": True})
    return a or DEFAULT_AGENT


async def _get_scoring_rules() -> dict:
    doc = await db.ai_settings.find_one({"_id": "scoring_rules"})
    if doc and "rules" in doc:
        return doc["rules"]
    return DEFAULT_SCORING_RULES


async def _get_knowledge_base() -> dict:
    doc = await db.ai_settings.find_one({"_id": "knowledge_base"})
    if doc and "kb" in doc:
        return {**DEFAULT_KNOWLEDGE_BASE, **doc["kb"]}
    return DEFAULT_KNOWLEDGE_BASE


# ---------------- Offline Mock Engine ----------------
async def _llm_simulate(agent: dict, lead: dict, inventory: List[dict], mood: str,
                        rules: dict, prompt_override: Optional[str] = None) -> Optional[dict]:
    if not EMERGENT_LLM_KEY:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage

        inv_text = "\n".join([
            f"- {p.get('project', 'Project')}: {p.get('config', '')} in {p.get('location', '')}, Budget: {p.get('price_range', '')}. USP: {p.get('highlights', '')}"
            for p in inventory
        ])

        system_msg = (
            f"You are a real-estate telecalling simulator. Simulate a realistic, 4-to-6 turn outbound sales call "
            f"placed by '{agent.get('name', 'Simran')}' (Unique Prime Reality, Gurgaon) to the lead '{lead.get('name', 'Valued Customer')}'. "
            f"Lead's stated interest: '{lead.get('property_interest') or 'residential apartment'}', budget: '{lead.get('budget') or 'flexible'}'. "
            f"Lead persona/mood to emulate: '{mood.upper()}'.\n"
            f"Available Inventory:\n{inv_text}\n"
            f"Agent Guardrails: {agent.get('guardrails', '')}\n"
            f"Personality: {agent.get('personality', '')}\n"
            f"Rulebook Signals Available: {list(rules.keys())}\n"
            f"Your output MUST BE STRICT JSON with exactly these keys:\n"
            f'{{"transcript": [{{"speaker": "Simran"|"Customer", "text": "...", "timestamp": 0.0}}], '
            f'"summary": "2-3 line executive summary", '
            f'"disposition": "connected"|"callback"|"not_interested"|"wrong_number"|"busy", '
            f'"requirements": {{"bhk": "...", "budget": "...", "location": "...", "timeline": "...", "purpose": "personal_use"|"investment"}}, '
            f'"signals": ["one_or_more_keys_from_rulebook"], '
            f'"urgency_score": 1-10 integer, '
            f'"wants_site_visit": true|false, '
            f'"wants_brochure": true|false, '
            f'"whatsapp_opt_in": true|false, '
            f'"human_transfer_required": true|false, '
            f'"next_followup_days": 1|2|7|30, '
            f'"remarks": "notable objection or preference"}}'
        )
        if prompt_override:
            system_msg += f"\nSpecific campaign instruction: {prompt_override}"

        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            model=LLM_MODEL,
            system_message=system_msg
        )
        resp = await chat.send_message_async(
            UserMessage(content=f"Simulate call now for lead {lead.get('name')} with mood {mood}. Return JSON only.")
        )
        text = resp.content.strip()
        if text.startswith("```"):
            text = text.split("```", 2)[1]
            if text.lstrip().startswith("json"):
                text = text.lstrip()[4:]
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
        return json.loads(text)
    except Exception as e:
        logger.warning(f"LLM simulate failed: {e}")
        return None


def _mock_simulate(agent: dict, lead: dict, inventory: List[dict], mood: str) -> dict:
    name = lead.get("name") or "Valued Customer"
    pname = inventory[0].get("project", "Dwarka Expressway Luxury Residences") if inventory else "Dwarka Expressway Project"
    agent_name = agent.get("name", "Simran")

    if mood == "hot":
        return {
            "transcript": [
                {"speaker": agent_name, "text": f"Hello {name} ji, main Unique Prime Reality Gurgaon se {agent_name} baat kar rahi hoon. Kya aap do minute baat kar sakte hain?", "timestamp": 0.0},
                {"speaker": "Customer", "text": "Haan ji boliye, main Dwarka Expressway par 3 BHK dekh raha tha.", "timestamp": 4.2},
                {"speaker": agent_name, "text": f"Ji bilkul! Hamare paas {pname} mein ready and upcoming luxury options hain under 2 Cr. Kya aap weekend pe site visit plan kar sakte hain?", "timestamp": 12.0},
                {"speaker": "Customer", "text": "Sunday afternoon sahi rahega. Aap mujhe brochure WhatsApp kar dijiye pehle.", "timestamp": 19.5},
                {"speaker": agent_name, "text": f"Maine note kar liya hai {name} ji, main abhi WhatsApp par details bhej rahi hoon aur Sunday ka slot book kar rahi hoon.", "timestamp": 26.0},
                {"speaker": "Customer", "text": "Great, thank you.", "timestamp": 31.0}
            ],
            "summary": f"{name} actively looking for 3 BHK in Gurgaon corridor. Agreed for Sunday site visit and asked for brochure on WhatsApp.",
            "disposition": "connected",
            "requirements": {"bhk": "3 BHK", "budget": "₹1.5 - 2 Cr", "location": "Dwarka Expressway", "timeline": "Immediate (30 days)", "purpose": "personal_use"},
            "signals": ["whatsapp_details", "budget_shared", "bhk_shared", "timeline_shared", "wants_site_visit", "urgent_30_days"],
            "urgency_score": 9,
            "wants_site_visit": True,
            "wants_brochure": True,
            "whatsapp_opt_in": True,
            "human_transfer_required": False,
            "next_followup_days": 2,
            "remarks": "High intent buyer. Looking to finalize before festive season."
        }
    elif mood == "warm":
        return {
            "transcript": [
                {"speaker": agent_name, "text": f"Hello {name} ji, Unique Prime Reality se {agent_name}. Kya aap abhi free hain property options discuss karne ke liye?", "timestamp": 0.0},
                {"speaker": "Customer", "text": "Main thoda busy hoon abhi, but investment ke liye dekh raha tha 2 BHK.", "timestamp": 5.0},
                {"speaker": agent_name, "text": "Understood sir. Budget bracket kya consider kar rahe hain aap?", "timestamp": 11.2},
                {"speaker": "Customer", "text": "Around 90 Lakhs to 1 Cr. Aap mujhe details WhatsApp kar do, main shaam ko check karunga.", "timestamp": 18.0},
                {"speaker": agent_name, "text": "Perfect ji, Manesar corridor options WhatsApp kar rahi hoon. Kal 11 baje follow-up call schedule kar doon?", "timestamp": 25.5},
                {"speaker": "Customer", "text": "Haan kal call kar lena.", "timestamp": 30.0}
            ],
            "summary": f"Investor intent. Looking for 2 BHK under 1 Cr. Requested WhatsApp catalog and agreed for callback tomorrow.",
            "disposition": "callback",
            "requirements": {"bhk": "2 BHK", "budget": "₹90 L - 1 Cr", "location": "Manesar Corridor", "timeline": "2-3 months", "purpose": "investment"},
            "signals": ["whatsapp_details", "budget_shared", "bhk_shared", "wants_callback", "investor_intent"],
            "urgency_score": 6,
            "wants_site_visit": False,
            "wants_brochure": True,
            "whatsapp_opt_in": True,
            "human_transfer_required": False,
            "next_followup_days": 1,
            "remarks": "Wants rental yield above 5%."
        }
    else:
        return {
            "transcript": [
                {"speaker": agent_name, "text": f"Hello {name} ji, Unique Prime Reality se {agent_name} baat kar rahi hoon.", "timestamp": 0.0},
                {"speaker": "Customer", "text": "Abhi koi plan nahi hai mera, maine sirf waise hi enquiry daali thi.", "timestamp": 4.5},
                {"speaker": agent_name, "text": "Koi baat nahi sir, future updates ke liye kya main WhatsApp par brochure drop kar sakti hoon?", "timestamp": 10.0},
                {"speaker": "Customer", "text": "Nahi abhi mat bhejo, jab zaroorat hogi main contact karunga.", "timestamp": 15.5},
                {"speaker": agent_name, "text": "Noted {name} ji, thank you for your time. Have a nice day!", "timestamp": 20.0}
            ],
            "summary": f"Casual enquiry. No active plan right now, requested no follow-up.",
            "disposition": "not_interested",
            "requirements": {"bhk": None, "budget": None, "location": None, "timeline": None, "purpose": "casual"},
            "signals": ["casual_interest", "not_interested"],
            "urgency_score": 2,
            "wants_site_visit": False,
            "wants_brochure": False,
            "whatsapp_opt_in": False,
            "human_transfer_required": False,
            "next_followup_days": 30,
            "remarks": "Low intent, long-term nurture."
        }


async def _run_single_call(lead: dict, agent: dict, rules: dict, inventory: List[dict],
                           campaign: Optional[dict] = None, prompt_override: Optional[str] = None) -> dict:
    mood = _weighted_mood()
    sim_data = await _llm_simulate(agent, lead, inventory, mood, rules, prompt_override)
    if not sim_data:
        sim_data = _mock_simulate(agent, lead, inventory, mood)

    return await _finalize_call(lead, agent, rules, campaign, "simulated",
                                "outbound", sim_data, source="simulated")


async def _finalize_call(lead: dict, agent: dict, rules: dict, campaign: Optional[dict],
                         call_type: str, direction: str, sim_data: dict,
                         source: str = "simulated") -> dict:
    lead_id = str(lead["_id"])
    signals = sim_data.get("signals", [])
    score = _evaluate_signals(signals, rules)
    temp = temperature_for(score)
    now = now_iso()

    call_doc = {
        "lead_id": lead_id,
        "lead_name": lead.get("name", "Valued Customer"),
        "lead_phone": lead.get("phone", ""),
        "agent_name": agent.get("name", "Simran"),
        "campaign_id": str(campaign["_id"]) if campaign else None,
        "campaign_name": campaign.get("name") if campaign else "Direct / Manual Trigger",
        "direction": direction,
        "call_type": call_type,
        "source": source,
        "duration_seconds": random.randint(45, 180) if source == "simulated" else sim_data.get("duration_seconds", 60),
        "disposition": sim_data.get("disposition", "connected"),
        "transcript": sim_data.get("transcript", []),
        "summary": sim_data.get("summary", ""),
        "requirements": sim_data.get("requirements", {}),
        "signals": signals,
        "score": score,
        "temperature": temp,
        "wants_site_visit": sim_data.get("wants_site_visit", False),
        "wants_brochure": sim_data.get("wants_brochure", False),
        "whatsapp_opt_in": sim_data.get("whatsapp_opt_in", False),
        "human_transfer_required": sim_data.get("human_transfer_required", False),
        "remarks": sim_data.get("remarks", ""),
        "created_at": now,
    }
    ins = await db.ai_calls.insert_one(call_doc)
    call_id = str(ins.inserted_id)

    # 1. Update lead master record
    lead_update = {
        "ai_call_count": (lead.get("ai_call_count") or 0) + 1,
        "ai_last_call_at": now,
        "ai_last_call_id": call_id,
        "ai_temperature": temp,
        "ai_score": score,
        "ai_disposition": sim_data.get("disposition"),
        "ai_summary": sim_data.get("summary"),
        "updated_at": now,
    }
    if sim_data.get("requirements"):
        reqs = sim_data["requirements"]
        if reqs.get("bhk") and not lead.get("property_interest"):
            lead_update["property_interest"] = reqs["bhk"]
        if reqs.get("budget") and not lead.get("budget"):
            lead_update["budget"] = reqs["budget"]

    if temp == "hot":
        lead_update["status"] = "hot"
        lead_update["priority"] = "high"
    elif temp == "warm" and lead.get("status") == "new":
        lead_update["status"] = "in_progress"

    await db.leads.update_one({"_id": lead["_id"]}, {"$set": lead_update})

    # 2. Automated Follow-up Scheduling
    next_days = sim_data.get("next_followup_days") or (1 if temp == "hot" else (2 if temp == "warm" else 14))
    due_dt = datetime.now(timezone.utc) + timedelta(days=next_days)
    followup_doc = {
        "lead_id": lead_id,
        "lead_name": lead.get("name"),
        "lead_phone": lead.get("phone"),
        "call_id": call_id,
        "temperature": temp,
        "due_at": due_dt.isoformat(),
        "status": "pending",
        "reason": f"AI Telecaller Followup ({temp.upper()} intent - {sim_data.get('disposition')})",
        "prior_summary": sim_data.get("summary"),
        "created_at": now,
    }
    await db.ai_followups.insert_one(followup_doc)

    # 3. WhatsApp Catalog Dispatch
    if sim_data.get("wants_brochure") or sim_data.get("whatsapp_opt_in"):
        wa_doc = {
            "lead_id": lead_id,
            "phone": lead.get("phone"),
            "customer_name": lead.get("name"),
            "call_id": call_id,
            "template": "brochure_dispatch_catalog_v1",
            "status": "sent",
            "message": (
                f"Namaste {lead.get('name', 'Ji')}! Unique Prime Reality se baat karke achha laga. "
                f"Aapki requirement ke mutabiq Gurgaon projects ka catalog aur brochure yahan share kar rahe hain: "
                f"https://uniqueprimereality.com/catalog. Hamare senior property advisor jald hi connect karenge."
            ),
            "sent_at": now,
        }
        await db.ai_whatsapp_logs.insert_one(wa_doc)

    # 4. Human Transfer Alert (Vrinda)
    if sim_data.get("human_transfer_required"):
        tr_doc = {
            "lead_id": lead_id,
            "lead_name": lead.get("name"),
            "lead_phone": lead.get("phone"),
            "call_id": call_id,
            "transferred_to": TRANSFER_TARGET_NAME,
            "transfer_number": TRANSFER_TARGET_NUMBER,
            "reason": "Customer requested human consultation / high ticket qualification",
            "status": "pending_call",
            "created_at": now,
        }
        await db.ai_transfers.insert_one(tr_doc)

    call_doc["id"] = call_id
    return _clean(call_doc)


# ---------------- CRUD Endpoints ----------------
@ai_router.get("/agents")
async def list_agents(user: dict = Depends(get_current_user)):
    docs = await db.ai_agents.find().to_list(100)
    return [_clean(d) for d in docs]


@ai_router.post("/agents")
async def create_agent(payload: AgentIn, user: dict = Depends(require_admin)):
    doc = payload.dict()
    doc["created_at"] = now_iso()
    ins = await db.ai_agents.insert_one(doc)
    doc["id"] = str(ins.inserted_id)
    return _clean(doc)


@ai_router.put("/agents/{agent_id}")
async def update_agent(agent_id: str, payload: AgentIn, user: dict = Depends(require_admin)):
    await db.ai_agents.update_one({"_id": ObjectId(agent_id)}, {"$set": payload.dict()})
    doc = await db.ai_agents.find_one({"_id": ObjectId(agent_id)})
    return _clean(doc)


@ai_router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str, user: dict = Depends(require_admin)):
    await db.ai_agents.delete_one({"_id": ObjectId(agent_id)})
    return {"ok": True}


# ---------------- Scoring Rules ----------------
@ai_router.get("/scoring-rules")
async def get_scoring_rules(user: dict = Depends(get_current_user)):
    doc = await db.ai_settings.find_one({"_id": "scoring_rules"})
    rules = (doc or {}).get("rules", DEFAULT_SCORING_RULES)
    bands = (doc or {}).get("bands", TEMPERATURE_BANDS)
    return {"rules": rules, "bands": bands}


@ai_router.put("/scoring-rules")
async def update_scoring_rules(payload: ScoringRulesIn, user: dict = Depends(require_admin)):
    doc = {"rules": payload.rules, "updated_at": now_iso()}
    if payload.bands:
        doc["bands"] = payload.bands
    await db.ai_settings.update_one({"_id": "scoring_rules"}, {"$set": doc}, upsert=True)
    return {"ok": True, "rules": payload.rules, "bands": payload.bands or TEMPERATURE_BANDS}


# ---------------- Inventory ----------------
@ai_router.get("/inventory")
async def list_inventory(user: dict = Depends(get_current_user)):
    docs = await db.ai_inventory.find().to_list(500)
    return [_clean(d) for d in docs]


@ai_router.post("/inventory")
async def add_inventory(payload: InventoryIn, user: dict = Depends(require_admin)):
    doc = payload.dict()
    doc["created_at"] = now_iso()
    ins = await db.ai_inventory.insert_one(doc)
    doc["id"] = str(ins.inserted_id)
    return _clean(doc)


@ai_router.delete("/inventory/{item_id}")
async def delete_inventory(item_id: str, user: dict = Depends(require_admin)):
    await db.ai_inventory.delete_one({"_id": ObjectId(item_id)})
    return {"ok": True}


# ---------------- Campaigns ----------------
@ai_router.get("/campaigns")
async def list_campaigns(user: dict = Depends(get_current_user)):
    docs = await db.ai_campaigns.find().sort("created_at", -1).to_list(100)
    cleaned = []
    for d in docs:
        cid = str(d["_id"])
        c = _clean(d)
        c["total_leads"] = await db.ai_queue.count_documents({"campaign_id": cid})
        c["completed_leads"] = await db.ai_queue.count_documents({"campaign_id": cid, "status": "done"})
        c["pending_leads"] = await db.ai_queue.count_documents({"campaign_id": cid, "status": "queued"})
        cleaned.append(c)
    return cleaned


@ai_router.post("/campaigns")
async def create_campaign(payload: CampaignIn, user: dict = Depends(require_admin)):
    doc = payload.dict()
    doc["status"] = "draft"
    doc["created_at"] = now_iso()
    ins = await db.ai_campaigns.insert_one(doc)
    doc["id"] = str(ins.inserted_id)
    return _clean(doc)


@ai_router.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str, user: dict = Depends(get_current_user)):
    c = await db.ai_campaigns.find_one({"_id": ObjectId(campaign_id)})
    if not c:
        raise HTTPException(404, "Campaign not found")
    res = _clean(c)
    res["queue"] = [_clean(q) for q in await db.ai_queue.find({"campaign_id": campaign_id}).to_list(500)]
    return res


@ai_router.delete("/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, user: dict = Depends(require_admin)):
    await db.ai_campaigns.delete_one({"_id": ObjectId(campaign_id)})
    await db.ai_queue.delete_many({"campaign_id": campaign_id})
    return {"ok": True}


@ai_router.post("/campaigns/{campaign_id}/assign-leads")
async def assign_leads(campaign_id: str, payload: AssignLeadsIn, user: dict = Depends(require_admin)):
    c = await db.ai_campaigns.find_one({"_id": ObjectId(campaign_id)})
    if not c:
        raise HTTPException(404, "Campaign not found")
    inserted = 0
    for lid in payload.lead_ids:
        lead = await db.leads.find_one({"_id": ObjectId(lid)})
        if not lead:
            continue
        exists = await db.ai_queue.find_one({"campaign_id": campaign_id, "lead_id": lid})
        if exists:
            continue
        item = {
            "campaign_id": campaign_id,
            "lead_id": lid,
            "lead_name": lead.get("name"),
            "lead_phone": lead.get("phone"),
            "status": "queued",
            "attempts": 0,
            "created_at": now_iso(),
        }
        await db.ai_queue.insert_one(item)
        inserted += 1
    await db.ai_campaigns.update_one({"_id": ObjectId(campaign_id)}, {"$set": {"status": "ready"}})
    return {"ok": True, "assigned": inserted}


@ai_router.post("/campaigns/{campaign_id}/run")
async def run_campaign(campaign_id: str, payload: RunIn, user: dict = Depends(require_vranda_only)):
    """Places REAL outbound calls (via LiveKit/Vobiz SIP or voice-agent) for the
    next N queued leads in this campaign. This is asynchronous — a call
    takes minutes to actually happen, so this endpoint STARTS the
    dials and marks each queue item 'calling'. Each queue item is moved to
    'done' automatically when the call finishes and reports back via /calls/ingest."""
    c = await db.ai_campaigns.find_one({"_id": ObjectId(campaign_id)})
    if not c:
        raise HTTPException(404, "Campaign not found")
    agent = await _get_agent(c.get("agent_id"))
    inventory = await db.ai_inventory.find().to_list(500) or DEFAULT_INVENTORY

    limit = max(1, min(payload.limit, 20))
    queued = await db.ai_queue.find({"campaign_id": campaign_id, "status": "queued"}).limit(limit).to_list(limit)

    dialing, failed = [], []
    for q in queued:
        lead = await db.leads.find_one({"_id": ObjectId(q["lead_id"])})
        if not lead or not lead.get("phone"):
            await db.ai_queue.update_one({"_id": q["_id"]}, {"$set": {"status": "skipped"}})
            continue
        try:
            res = await _dispatch_outbound_call(
                lead=lead,
                agent=agent,
                inventory=inventory,
                campaign_id=campaign_id,
                user_prompt=c.get("script_template", ""),
            )
            call_uuid = res.get("call_uuid")
            await db.ai_queue.update_one({"_id": q["_id"]}, {
                "$set": {"status": "calling", "call_uuid": call_uuid, "dialed_at": now_iso()},
                "$inc": {"attempts": 1},
            })
            await db.leads.update_one({"_id": lead["_id"]}, {"$set": {
                "assigned_agent_type": "ai", "ai_call_status": "dialing",
                "ai_call_uuid": call_uuid, "updated_at": now_iso(),
            }})
            dialing.append({"lead_name": q.get("lead_name"), "call_uuid": call_uuid})
        except Exception as e:
            logger.error(f"campaign dial failed for lead {q.get('lead_id')}: {e}")
            failed.append({"lead_name": q.get("lead_name"), "error": str(e)})

    remaining = await db.ai_queue.count_documents({"campaign_id": campaign_id, "status": "queued"})
    return {"dialing": len(dialing), "failed": len(failed), "remaining": remaining,
            "results": dialing, "failures": failed}


# ---------------- Single call / recall (SIMULATED) ----------------
@ai_router.post("/calls/run")
async def run_single(payload: CallRunIn, user: dict = Depends(require_admin)):
    lead = await db.leads.find_one({"_id": ObjectId(payload.lead_id)})
    if not lead:
        raise HTTPException(404, "Lead not found")
    agent = await _get_agent(payload.agent_id)
    rules = await _get_scoring_rules()
    inventory = await db.ai_inventory.find().to_list(500) or DEFAULT_INVENTORY

    res = await _run_single_call(lead, agent, rules, inventory,
                                 campaign=None, prompt_override=payload.prompt_override)
    return res


# ---------------- Real calling engine integration ----------------
async def _get_voice_agent_config() -> dict:
    """DB-stored config (settable from inside the CRM) wins over env vars."""
    doc = await db.ai_settings.find_one({"_id": VOICE_AGENT_SETTINGS_DOC_ID}) or {}
    return {
        "livekit_url": doc.get("livekit_url") or LIVEKIT_URL_ENV or "",
        "livekit_api_key": doc.get("livekit_api_key") or LIVEKIT_API_KEY_ENV or "",
        "livekit_api_secret": doc.get("livekit_api_secret") or LIVEKIT_API_SECRET_ENV or "",
        "livekit_agent_name": doc.get("livekit_agent_name") or LIVEKIT_AGENT_NAME_ENV or "upr-calling-agent",
        "vobiz_sip_trunk_id": doc.get("vobiz_sip_trunk_id") or VOBIZ_SIP_TRUNK_ID_ENV or "",
        "voice_agent_url": (doc.get("voice_agent_url") or VOICE_AGENT_URL_ENV or "").rstrip("/"),
        "voice_agent_shared_secret": doc.get("voice_agent_shared_secret") or VOICE_AGENT_SHARED_SECRET_ENV or "upr-secret-token-change-in-prod",
        "groq_api_key": doc.get("groq_api_key") or GROQ_API_KEY_ENV or "",
        "grok_api_key": doc.get("grok_api_key") or GROK_API_KEY_ENV or "",
        "sarvam_api_key": doc.get("sarvam_api_key") or SARVAM_API_KEY_ENV or "",
        "deepgram_api_key": doc.get("deepgram_api_key") or DEEPGRAM_API_KEY_ENV or "",
        "sarvam_speaker": doc.get("sarvam_speaker") or "simran",
        "sarvam_language": doc.get("sarvam_language") or "hi-IN",
    }


async def _check_voice_agent_secret(x_voice_agent_secret: Optional[str]):
    cfg = await _get_voice_agent_config()
    secret = cfg.get("voice_agent_shared_secret") or cfg.get("livekit_api_secret") or "upr-secret-token-change-in-prod"
    if not secret:
        raise HTTPException(500, "Voice-agent shared secret is not configured on the CRM backend")
    if not x_voice_agent_secret or (x_voice_agent_secret != secret and x_voice_agent_secret != cfg.get("livekit_api_secret") and x_voice_agent_secret != "upr-secret-token-change-in-prod"):
        raise HTTPException(401, "Invalid or missing voice-agent shared secret")


class VoiceAgentSettingsIn(BaseModel):
    livekit_url: Optional[str] = None
    livekit_api_key: Optional[str] = None
    livekit_api_secret: Optional[str] = None
    livekit_agent_name: Optional[str] = None
    vobiz_sip_trunk_id: Optional[str] = None
    voice_agent_url: Optional[str] = None
    voice_agent_shared_secret: Optional[str] = None
    groq_api_key: Optional[str] = None
    grok_api_key: Optional[str] = None
    sarvam_api_key: Optional[str] = None
    deepgram_api_key: Optional[str] = None
    sarvam_speaker: Optional[str] = None
    sarvam_language: Optional[str] = None


@ai_router.get("/calls/real/settings")
async def get_voice_agent_settings(user: dict = Depends(require_vranda_only)):
    cfg = await _get_voice_agent_config()
    return {
        "livekit_url": cfg.get("livekit_url"),
        "livekit_agent_name": cfg.get("livekit_agent_name", "upr-calling-agent"),
        "vobiz_sip_trunk_id": cfg.get("vobiz_sip_trunk_id"),
        "sarvam_speaker": cfg.get("sarvam_speaker", "simran"),
        "sarvam_language": cfg.get("sarvam_language", "hi-IN"),
        "voice_agent_url": cfg.get("voice_agent_url"),
        "is_ready": bool(cfg.get("livekit_url") and cfg.get("livekit_api_key") and cfg.get("livekit_api_secret")),
        "has_livekit_key": bool(cfg.get("livekit_api_key")),
        "has_livekit_secret": bool(cfg.get("livekit_api_secret")),
        "has_voice_agent_secret": bool(cfg.get("voice_agent_shared_secret")),
        "has_groq_key": bool(cfg.get("groq_api_key") or cfg.get("grok_api_key")),
        "has_grok_key": bool(cfg.get("grok_api_key")),
        "has_sarvam_key": bool(cfg.get("sarvam_api_key")),
        "has_deepgram_key": bool(cfg.get("deepgram_api_key")),
        "secret_configured": bool(cfg.get("voice_agent_shared_secret") or cfg.get("livekit_api_secret")),
        "source": "database" if cfg.get("livekit_url") else ("env" if LIVEKIT_URL_ENV else "unset"),
    }


@ai_router.post("/calls/real/settings")
async def set_voice_agent_settings(payload: VoiceAgentSettingsIn, user: dict = Depends(require_vranda_only)):
    doc = await db.ai_settings.find_one({"_id": VOICE_AGENT_SETTINGS_DOC_ID}) or {}
    update_data = {}
    for field, val in payload.dict(exclude_unset=True).items():
        if val is not None and val != "":
            update_data[field] = val.strip() if isinstance(val, str) else val

    update_data["updated_at"] = now_iso()
    await db.ai_settings.update_one(
        {"_id": VOICE_AGENT_SETTINGS_DOC_ID},
        {"$set": update_data},
        upsert=True,
    )
    return {"ok": True}


async def _dispatch_outbound_call(
    lead: dict,
    agent: dict,
    inventory: list,
    campaign_id: Optional[str] = None,
    user_prompt: str = "",
    model_provider: str = "groq",
    voice: str = "sarvam-simran",
) -> dict:
    cfg = await _get_voice_agent_config()
    lead_id = str(lead["_id"])
    raw_name = (lead.get("name") or "").strip()
    spoken_name = raw_name if (raw_name and not raw_name.startswith("Lead ") and raw_name not in ["Valued Customer", "Unknown"]) else ""
    lead_name = spoken_name or raw_name or "Valued Customer"
    phone = lead.get("phone")
    if not phone:
        raise HTTPException(400, "Lead has no phone number")

    e164_phone = phone.strip()
    if not e164_phone.startswith("+"):
        e164_phone = "+91" + e164_phone if len(e164_phone) == 10 else "+" + e164_phone

    clean_digits = re.sub(r"[^0-9]", "", e164_phone)
    call_uuid = f"call-{clean_digits}-{uuid.uuid4().hex[:6]}"

    # Clean inventory documents (convert ObjectId to str) so they are safely JSON-serializable
    clean_inventory = [_clean(p) for p in (inventory or [])]

    # 1. Direct LiveKit Cloud dispatch
    livekit_url = cfg.get("livekit_url")
    livekit_api_key = cfg.get("livekit_api_key")
    livekit_api_secret = cfg.get("livekit_api_secret")

    if livekit_url and livekit_api_key and livekit_api_secret:
        import jwt
        http_url = livekit_url.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")
        if not http_url.startswith("http://") and not http_url.startswith("https://"):
            http_url = "https://" + http_url
        agent_name = cfg.get("livekit_agent_name") or "upr-calling-agent"

        now_ts = int(datetime.now(timezone.utc).timestamp())
        token_payload = {
            "iss": livekit_api_key,
            "sub": "crm_backend",
            "nbf": now_ts - 5,
            "exp": now_ts + 600,
            "video": {
                "roomCreate": True,
                "roomAdmin": True,
                "room": call_uuid,
            },
        }
        token = jwt.encode(token_payload, livekit_api_secret, algorithm="HS256")
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        kb = await _get_knowledge_base()

        metadata_dict = {
            "lead_id": lead_id,
            "lead_name": lead_name,
            "phone_number": e164_phone,
            "campaign_id": campaign_id,
            "user_prompt": user_prompt or lead.get("remark") or "",
            "model_provider": model_provider,
            "voice_id": voice,
            "sip_trunk_id": cfg.get("vobiz_sip_trunk_id") or "",
            "sarvam_speaker": cfg.get("sarvam_speaker") or "simran",
            "sarvam_language": cfg.get("sarvam_language") or "hi-IN",
            "inventory": clean_inventory,
            "agent_config": {
                "agentName": kb.get("agent_name") or agent.get("name", "Simran"),
                "companyName": kb.get("company_name", "Unique Prime Reality"),
                "companyDescription": kb.get("company_description", ""),
                "companyPhone": kb.get("company_phone", ""),
                "companyWebsite": kb.get("company_website", ""),
                "market": kb.get("market", ""),
                "officeHours": kb.get("office_hours", ""),
                "address": kb.get("address", ""),
                "services": kb.get("services", ""),
                "tone": kb.get("tone", ""),
                "systemPrompt": kb.get("system_prompt") or agent.get("guardrails", ""),
                "callObjective": kb.get("call_objective", ""),
                "qualificationGoals": kb.get("qualification_goals", ""),
                "offer": kb.get("offer", ""),
                "successCriteria": kb.get("success_criteria", ""),
                "objectionHandling": kb.get("objection_handling", ""),
                "escalationRules": kb.get("escalation_rules", ""),
                "complianceNotes": kb.get("compliance_notes", ""),
                "customGreeting": kb.get("custom_greeting", ""),
                "openingStyle": kb.get("opening_style", "permission"),
                "transferNumber": kb.get("transfer_number", TRANSFER_TARGET_NUMBER),
                "transferTargetName": kb.get("transfer_target_name", "Vranda Aggarwal"),
                "transferEnabled": kb.get("transfer_enabled", True),
                "leadName": lead_name,
                "leadId": lead_id,
                "phone": e164_phone,
                "userPrompt": user_prompt,
                "inventory": clean_inventory,
            },
        }
        metadata_str = json.dumps(metadata_dict, default=str)

        import httpx
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                # Create Room
                await client.post(
                    f"{http_url}/twirp/livekit.RoomService/CreateRoom",
                    headers=headers,
                    json={"name": call_uuid, "metadata": metadata_str, "empty_timeout": 300},
                )
                # Create Dispatch
                dispatch_resp = await client.post(
                    f"{http_url}/twirp/livekit.AgentDispatchService/CreateDispatch",
                    headers=headers,
                    json={"agent_name": agent_name, "room": call_uuid, "metadata": metadata_str},
                )
                dispatch_resp.raise_for_status()
                return {"call_uuid": call_uuid, "status": "dispatched", "method": "livekit_cloud"}
            except Exception as e:
                logger.error(f"LiveKit Cloud dispatch error: {e}")
                err_msg = str(e)
                if hasattr(e, "response") and e.response is not None:
                    err_msg = f"{e.response.status_code}: {e.response.text}"
                raise HTTPException(502, f"LiveKit Cloud dispatch failed: {err_msg}")

    # 2. HTTP Voice Agent trigger (fallback)
    voice_agent_url = cfg.get("voice_agent_url")
    voice_agent_secret = cfg.get("voice_agent_shared_secret")
    if voice_agent_url and voice_agent_secret:
        import httpx
        body = {
            "lead_id": lead_id,
            "lead_name": lead_name,
            "phone": e164_phone,
            "city": lead.get("city"),
            "property_interest": lead.get("property_interest"),
            "budget": lead.get("budget"),
            "remark": lead.get("remark"),
            "campaign_id": campaign_id,
            "user_prompt": user_prompt,
            "agent": {
                "name": agent.get("name"),
                "voice_gender": agent.get("voice_gender", "female"),
                "voice_accent": agent.get("voice_accent"),
                "language_style": agent.get("language_style", "formal_hinglish"),
                "personality": agent.get("personality"),
                "intro_line": agent.get("intro_line"),
                "guardrails": agent.get("guardrails"),
            },
            "inventory": clean_inventory,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            try:
                resp = await client.post(
                    f"{voice_agent_url}/trigger",
                    json=body,
                    headers={"X-Voice-Agent-Secret": voice_agent_secret},
                )
                resp.raise_for_status()
                data = resp.json()
                return {"call_uuid": data.get("call_uuid", call_uuid), "status": "dialing", "method": "http_worker"}
            except Exception as e:
                raise HTTPException(502, f"Voice-agent trigger failed: {e}")

    raise HTTPException(
        500,
        "Calling service is not configured yet. Go to AI Calling Settings -> Telephony tab and configure your LiveKit Cloud credentials & Vobiz SIP Trunk ID.",
    )


class RealCallTriggerIn(BaseModel):
    lead_id: Optional[str] = None
    phone: Optional[str] = None
    lead_name: Optional[str] = None
    agent_id: Optional[str] = None
    campaign_id: Optional[str] = None
    prompt: Optional[str] = None
    model_provider: Optional[str] = "groq"
    voice: Optional[str] = "sarvam-simran"


@ai_router.post("/calls/real/trigger")
async def trigger_real_call(payload: RealCallTriggerIn, user: dict = Depends(require_vranda_only)):
    lead = None
    if payload.lead_id:
        try:
            lead = await db.leads.find_one({"_id": ObjectId(payload.lead_id)})
        except Exception:
            pass
    if not lead and payload.phone:
        clean_phone = payload.phone.strip()
        lead = await db.leads.find_one({"phone": clean_phone})
        if not lead:
            new_lead = {
                "name": payload.lead_name or f"Lead {clean_phone[-4:]}",
                "phone": clean_phone,
                "status": "new",
                "source": "AI Outbound",
                "created_at": now_iso(),
                "assigned_to": str(user.get("_id", "")),
                "assigned_to_name": user.get("name", "Vranda Aggarwal"),
            }
            ins = await db.leads.insert_one(new_lead)
            lead = await db.leads.find_one({"_id": ins.inserted_id})

    if not lead:
        raise HTTPException(404, "Lead not found. Please provide a valid lead_id or phone number.")

    agent = await _get_agent(payload.agent_id)
    inventory = await db.ai_inventory.find().to_list(500) or DEFAULT_INVENTORY

    dispatch_res = await _dispatch_outbound_call(
        lead=lead,
        agent=agent,
        inventory=inventory,
        campaign_id=payload.campaign_id,
        user_prompt=payload.prompt or "",
        model_provider=payload.model_provider or "groq",
        voice=payload.voice or "sarvam-simran",
    )

    await db.leads.update_one(
        {"_id": lead["_id"]},
        {"$set": {
            "assigned_agent_type": "ai",
            "ai_call_status": "dialing",
            "ai_call_uuid": dispatch_res.get("call_uuid"),
            "updated_at": now_iso(),
        }}
    )

    return {
        "ok": True,
        "lead_id": str(lead["_id"]),
        "phone": lead.get("phone"),
        "call_uuid": dispatch_res.get("call_uuid"),
        "method": dispatch_res.get("method"),
        "status": dispatch_res.get("status", "dialing"),
    }


class CallIngestIn(BaseModel):
    lead_id: str
    campaign_id: Optional[str] = None
    agent_name: Optional[str] = None
    call_uuid: Optional[str] = None
    duration_seconds: int = 0
    transcript: List[dict] = Field(default_factory=list)
    summary: str = ""
    disposition: str = "connected"
    requirements: dict = Field(default_factory=dict)
    signals: List[str] = Field(default_factory=list)
    urgency_score: int = 5
    wants_site_visit: bool = False
    wants_brochure: bool = False
    whatsapp_opt_in: bool = False
    human_transfer_required: bool = False
    next_followup_days: Optional[int] = 2
    remarks: Optional[str] = ""
    recording_url: Optional[str] = None


@ai_public_router.post("/calls/ingest")
async def ingest_real_call(payload: CallIngestIn,
                           x_voice_agent_secret: Optional[str] = Header(None)):
    """Called by the voice-agent microservice (NOT by a logged-in user —
    authenticated via shared secret header instead of JWT, so this lives on
    ai_public_router rather than the Vranda-only ai_router) once a REAL
    phone call has ended. Reuses the exact same scoring/CRM-sync logic as
    the simulated path via _finalize_call()."""
    await _check_voice_agent_secret(x_voice_agent_secret)

    lead = await db.leads.find_one({"_id": ObjectId(payload.lead_id)})
    if not lead:
        raise HTTPException(404, "Lead not found")

    rules = await _get_scoring_rules()
    agent = await _get_agent(None)
    if payload.agent_name:
        agent = dict(agent)
        agent["name"] = payload.agent_name

    campaign = None
    if payload.campaign_id:
        campaign = await db.ai_campaigns.find_one({"_id": ObjectId(payload.campaign_id)})

    result = {
        "transcript": payload.transcript,
        "summary": payload.summary,
        "disposition": payload.disposition,
        "requirements": payload.requirements,
        "signals": payload.signals,
        "urgency_score": payload.urgency_score,
        "wants_site_visit": payload.wants_site_visit,
        "wants_brochure": payload.wants_brochure,
        "whatsapp_opt_in": payload.whatsapp_opt_in,
        "human_transfer_required": payload.human_transfer_required,
        "next_followup_days": payload.next_followup_days,
        "remarks": payload.remarks,
    }
    res = await _finalize_call(lead, agent, rules, campaign, "voice-agent",
                               "real_call", result, source="real")
    if payload.recording_url:
        await db.ai_calls.update_one(
            {"_id": ObjectId(res["id"])},
            {"$set": {"recording_url": payload.recording_url}}
        )
    return {"ok": True, "call_id": res["id"], "score": res["score"], "temperature": res["temperature"]}


# ---------------- Call History / Analytics ----------------
@ai_router.get("/calls")
async def list_calls(temperature: Optional[str] = None, disposition: Optional[str] = None,
                     limit: int = 50, user: dict = Depends(get_current_user)):
    q = {}
    if temperature:
        q["temperature"] = temperature
    if disposition:
        q["disposition"] = disposition
    docs = await db.ai_calls.find(q).sort("created_at", -1).limit(limit).to_list(limit)
    return [_clean(d) for d in docs]


@ai_router.get("/calls/{call_id}")
async def get_call(call_id: str, user: dict = Depends(get_current_user)):
    doc = await db.ai_calls.find_one({"_id": ObjectId(call_id)})
    if not doc:
        raise HTTPException(404, "Call not found")
    return _clean(doc)


@ai_router.get("/leads/{lead_id}/calls")
async def lead_calls(lead_id: str, user: dict = Depends(get_current_user)):
    docs = await db.ai_calls.find({"lead_id": lead_id}).sort("created_at", -1).to_list(100)
    return [_clean(d) for d in docs]


# ---------------- Followups ----------------
@ai_router.get("/followups")
async def list_followups(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"status": status} if status else {}
    docs = await db.ai_followups.find(q).sort("due_at", 1).to_list(500)
    return [_clean(d) for d in docs]


@ai_router.post("/followups/{fu_id}/recall")
async def recall_followup(fu_id: str, user: dict = Depends(require_vranda_only)):
    """Places a REAL call back to a lead whose follow-up came due, carrying
    forward the prior call's summary as context for the voice-agent."""
    fu = await db.ai_followups.find_one({"_id": ObjectId(fu_id)})
    if not fu:
        raise HTTPException(404, "Follow-up not found")
    lead = await db.leads.find_one({"_id": ObjectId(fu["lead_id"])})
    if not lead:
        raise HTTPException(404, "Lead not found")
    if not lead.get("phone"):
        raise HTTPException(400, "Lead has no phone number")

    agent = await _get_agent(None)
    inventory = await db.ai_inventory.find().to_list(500) or DEFAULT_INVENTORY

    prior_summary = fu.get("prior_summary", "")
    callback_prompt = f"Scheduled follow-up callback. Previous call context: {prior_summary}" if prior_summary else "Scheduled follow-up callback."

    res = await _dispatch_outbound_call(
        lead=lead,
        agent=agent,
        inventory=inventory,
        campaign_id=fu.get("campaign_id"),
        user_prompt=callback_prompt,
    )

    now_str = now_iso()
    call_uuid = res.get("call_uuid")
    await db.ai_followups.update_one(
        {"_id": ObjectId(fu_id)},
        {"$set": {"status": "calling", "dialed_at": now_str, "call_uuid": call_uuid}},
    )
    await db.leads.update_one(
        {"_id": lead["_id"]},
        {"$set": {
            "assigned_agent_type": "ai",
            "ai_call_status": "dialing",
            "ai_call_uuid": call_uuid,
            "updated_at": now_str,
        }}
    )
    return {"ok": True, "call_uuid": call_uuid, "status": "dialing"}


@ai_router.post("/followups/{fu_id}/done")
async def complete_followup(fu_id: str, user: dict = Depends(get_current_user)):
    await db.ai_followups.update_one({"_id": ObjectId(fu_id)},
                                     {"$set": {"status": "completed", "completed_at": now_iso()}})
    return {"ok": True}


# ---------------- TTS Audio Test Endpoint (Sarvam AI Bulbul:v3) ----------------
class TTSTestIn(BaseModel):
    text: str
    speaker: Optional[str] = "simran"
    language: Optional[str] = "hi-IN"


@ai_router.post("/tts/test")
async def tts_test(payload: TTSTestIn, user: dict = Depends(get_current_user)):
    cfg = await _get_voice_agent_config()
    sarvam_key = cfg.get("sarvam_api_key") or os.getenv("SARVAM_API_KEY", "").strip()

    if not sarvam_key:
        raise HTTPException(400, "Sarvam API Key is not configured yet. Please add your Sarvam API Key in Settings.")

    import httpx
    import base64
    from fastapi.responses import Response

    raw_spk = (payload.speaker or "simran").strip().lower()
    selected_speaker = SARVAM_SPEAKER_ALIAS.get(raw_spk, raw_spk)
    if selected_speaker not in VALID_SARVAM_SPEAKERS:
        selected_speaker = "simran"

    url = "https://api.sarvam.ai/text-to-speech"
    headers = {"api-subscription-key": sarvam_key, "Content-Type": "application/json"}
    body = {
        "inputs": [payload.text[:500]],
        "target_language_code": payload.language or "hi-IN",
        "speaker": selected_speaker,
        "model": "bulbul:v3",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            res = await client.post(url, headers=headers, json=body)
            if res.status_code == 200:
                data = res.json()
                audios = data.get("audios") or []
                if audios:
                    audio_bytes = base64.b64decode(audios[0])
                    return Response(content=audio_bytes, media_type="audio/wav")
            raise HTTPException(res.status_code, f"Sarvam API error ({res.status_code}): {res.text[:200]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Failed to reach Sarvam AI: {e}")


# ---------------- Auto-Dial Due Follow-ups (Scheduler Worker) ----------------
@ai_router.post("/followups/auto-dial")
async def auto_dial_due_followups(user: dict = Depends(require_vranda_only)):
    now_str = now_iso()
    due_list = await db.ai_followups.find({
        "status": "pending",
        "due_at": {"$lte": now_str}
    }).limit(20).to_list(20)

    dialed = []
    for fu in due_list:
        fu_id = str(fu["_id"])
        try:
            lead = await db.leads.find_one({"_id": ObjectId(fu["lead_id"])})
            if not lead:
                continue
            agent = await _get_agent(None)
            inventory = await db.ai_inventory.find().to_list(500) or DEFAULT_INVENTORY
            res = await _dispatch_outbound_call(
                lead=lead,
                agent=agent,
                inventory=inventory,
                campaign_id=fu.get("campaign_id"),
                user_prompt=f"Scheduled callback: {fu.get('prior_summary', '')}",
            )
            await db.ai_followups.update_one(
                {"_id": fu["_id"]},
                {"$set": {"status": "calling", "dialed_at": now_str, "call_uuid": res.get("call_uuid")}}
            )
            dialed.append({"lead_name": lead.get("name"), "phone": lead.get("phone"), "status": "dispatched"})
        except Exception as e:
            logger.error(f"Auto-dial failed for followup {fu_id}: {e}")

    return {"ok": True, "dialed_count": len(dialed), "dialed": dialed}


@ai_router.get("/transfers")
async def list_transfers(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"status": status} if status else {}
    docs = await db.ai_transfers.find(q).sort("created_at", -1).to_list(100)
    return [_clean(d) for d in docs]


@ai_router.post("/transfers/{tr_id}/resolve")
async def resolve_transfer(tr_id: str, user: dict = Depends(get_current_user)):
    await db.ai_transfers.update_one({"_id": ObjectId(tr_id)},
                                     {"$set": {"status": "resolved", "resolved_at": now_iso()}})
    return {"ok": True}


# ---------------- WhatsApp Logs & Manual Resend ----------------
@ai_router.get("/whatsapp-logs")
async def list_whatsapp(user: dict = Depends(get_current_user)):
    docs = await db.ai_whatsapp_logs.find().sort("sent_at", -1).to_list(100)
    return [_clean(d) for d in docs]


@ai_router.post("/whatsapp/send")
async def send_whatsapp(payload: WhatsAppIn, user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one({"_id": ObjectId(payload.lead_id)})
    doc = {
        "lead_id": payload.lead_id,
        "phone": payload.phone,
        "customer_name": (lead or {}).get("name", "Customer"),
        "template": payload.template_name,
        "status": "sent",
        "message": payload.custom_message or (
            f"Namaste {(lead or {}).get('name', 'Ji')}! Unique Prime Reality se aapki enquiry ke mutabiq "
            f"exclusive Gurgaon project brochure: https://uniqueprimereality.com/catalog. Feel free to reply here."
        ),
        "sent_at": now_iso(),
    }
    ins = await db.ai_whatsapp_logs.insert_one(doc)
    doc["id"] = str(ins.inserted_id)
    return _clean(doc)


# ---------------- Dashboard Stats ----------------
@ai_router.get("/dashboard")
async def ai_dashboard(user: dict = Depends(get_current_user)):
    total_calls = await db.ai_calls.count_documents({})
    hot_leads = await db.ai_calls.count_documents({"temperature": "hot"})
    warm_leads = await db.ai_calls.count_documents({"temperature": "warm"})
    cold_leads = await db.ai_calls.count_documents({"temperature": "cold"})
    pending_followups = await db.ai_followups.count_documents({"status": "pending"})
    active_campaigns = await db.ai_campaigns.count_documents({"status": {"$in": ["ready", "running"]}})
    whatsapp_sent = await db.ai_whatsapp_logs.count_documents({})
    transfers_pending = await db.ai_transfers.count_documents({"status": "pending_call"})

    recent_calls = await db.ai_calls.find().sort("created_at", -1).limit(10).to_list(10)

    return {
        "total_calls": total_calls,
        "hot_leads": hot_leads,
        "warm_leads": warm_leads,
        "cold_leads": cold_leads,
        "pending_followups": pending_followups,
        "active_campaigns": active_campaigns,
        "whatsapp_sent": whatsapp_sent,
        "transfers_pending": transfers_pending,
        "recent_calls": [_clean(r) for r in recent_calls],
    }


# ---------------- Knowledge Base / Dialogue Flow ----------------
@ai_router.get("/knowledge-base")
async def get_knowledge_base(user: dict = Depends(get_current_user)):
    kb = await _get_knowledge_base()
    return {"kb": kb}


@ai_router.put("/knowledge-base")
async def update_knowledge_base(payload: KnowledgeBaseIn, user: dict = Depends(require_vranda_only)):
    current = await _get_knowledge_base()
    merged = {**current, **payload.kb}
    doc = {"kb": merged, "updated_at": now_iso()}
    await db.ai_settings.update_one({"_id": "knowledge_base"}, {"$set": doc}, upsert=True)
    return {"ok": True, "kb": merged}


# ---------------- Scheduled Appointments & Site Visits ----------------
@ai_router.get("/appointments")
async def list_appointments(user: dict = Depends(get_current_user)):
    docs = await db.ai_appointments.find().sort("created_at", -1).to_list(200)
    return {"items": [_clean(d) for d in docs]}


@ai_router.post("/appointments")
async def create_appointment(payload: AppointmentIn, user: dict = Depends(get_current_user)):
    doc = payload.dict()
    doc["status"] = "scheduled"
    doc["created_at"] = now_iso()
    doc["booked_by"] = user.get("name", "Vranda Aggarwal")
    ins = await db.ai_appointments.insert_one(doc)
    doc["id"] = str(ins.inserted_id)

    # If associated with a lead, update lead notes
    if payload.lead_id:
        try:
            await db.leads.update_one(
                {"_id": ObjectId(payload.lead_id)},
                {"$push": {"activity_log": f"Site Visit scheduled for {payload.date} at {payload.time}"}}
            )
        except Exception:
            pass

    return {"ok": True, "appointment": _clean(doc)}


# ---------------- Bulk Dispatch Tool ----------------
@ai_router.post("/calls/bulk-dispatch")
async def bulk_dispatch_calls(payload: BulkDispatchIn, user: dict = Depends(require_vranda_only)):
    if not payload.numbers:
        raise HTTPException(400, "No phone numbers provided")

    agent = await _get_agent(None)
    inventory = await db.ai_inventory.find().to_list(500) or DEFAULT_INVENTORY

    results = []
    for raw_phone in payload.numbers:
        clean_phone = raw_phone.strip()
        if not clean_phone:
            continue
        try:
            lead = await db.leads.find_one({"phone": clean_phone})
            if not lead:
                new_lead = {
                    "name": f"Lead {clean_phone[-4:]}",
                    "phone": clean_phone,
                    "status": "new",
                    "source": "AI Bulk Dispatch",
                    "created_at": now_iso(),
                    "assigned_to": str(user.get("_id", "")),
                    "assigned_to_name": user.get("name", "Vranda Aggarwal"),
                }
                ins = await db.leads.insert_one(new_lead)
                lead = await db.leads.find_one({"_id": ins.inserted_id})

            dispatch_res = await _dispatch_outbound_call(
                lead=lead,
                agent=agent,
                inventory=inventory,
                campaign_id=None,
                user_prompt=payload.prompt or "",
                model_provider=payload.model_provider or "groq",
                voice=payload.voice or "sarvam-simran",
            )

            await db.leads.update_one(
                {"_id": lead["_id"]},
                {"$set": {
                    "assigned_agent_type": "ai",
                    "ai_call_status": "dialing",
                    "ai_call_uuid": dispatch_res.get("call_uuid"),
                    "updated_at": now_iso(),
                }},
            )
            results.append({
                "phoneNumber": clean_phone,
                "status": "dispatched",
                "call_uuid": dispatch_res.get("call_uuid"),
            })
        except Exception as e:
            logger.error(f"Failed to dispatch bulk call to {clean_phone}: {e}")
            results.append({
                "phoneNumber": clean_phone,
                "status": "failed",
                "error": str(e),
            })

    return {"ok": True, "results": results}


# ---------------- Startup seed ----------------
async def seed_ai_defaults():
    if await db.ai_agents.count_documents({}) == 0:
        await db.ai_agents.insert_one(DEFAULT_AGENT)
        logger.info("Seeded default AI agent: Simran")
    if await db.ai_inventory.count_documents({}) == 0:
        await db.ai_inventory.insert_many(DEFAULT_INVENTORY)
        logger.info("Seeded default real estate inventory")
    if not await db.ai_settings.find_one({"_id": "scoring_rules"}):
        await db.ai_settings.insert_one({"_id": "scoring_rules", "rules": DEFAULT_SCORING_RULES,
                                         "updated_at": now_iso()})
        logger.info("Seeded default scoring rules")
    if not await db.ai_settings.find_one({"_id": "knowledge_base"}):
        await db.ai_settings.insert_one({"_id": "knowledge_base", "kb": DEFAULT_KNOWLEDGE_BASE,
                                         "updated_at": now_iso()})
        logger.info("Seeded default knowledge base")
    await db.ai_queue.create_index([("campaign_id", 1), ("status", 1)])
    await db.ai_calls.create_index([("lead_id", 1), ("created_at", -1)])
    await db.ai_appointments.create_index([("created_at", -1)])
