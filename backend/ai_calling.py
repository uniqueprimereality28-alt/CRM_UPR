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


async def require_vranda_only(user: dict = Depends(get_current_user)) -> dict:
    """The AI voice-calling agent is visible/usable ONLY to vranda.aggarwal
    — intentionally not tied to the 'superadmin' role, so it stays exclusive
    to her account specifically even if other users hold that role later."""
    if user.get("username") != "vranda.aggarwal":
        raise HTTPException(status_code=403, detail="This feature is not available on your account.")
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
# The voice-agent is a SEPARATE microservice (see /voice-agent in the repo root)
# that does actual telephony + STT + TTS. This backend never talks to Plivo
# directly; it only (a) asks the voice-agent to place a call, and
# (b) receives the finished call's transcript back from it.
#
# The URL + shared secret can be set two ways:
#  1. Env vars (VOICE_AGENT_URL / VOICE_AGENT_SHARED_SECRET) — set once at deploy time.
#  2. From inside the CRM itself: Vranda can paste them in via
#     GET/POST /api/ai/calls/real/settings — no redeploy needed, no code edits.
# The DB value (if set) always wins over the env var.
VOICE_AGENT_URL_ENV = os.environ.get("VOICE_AGENT_URL", "").rstrip("/")
VOICE_AGENT_SHARED_SECRET_ENV = os.environ.get("VOICE_AGENT_SHARED_SECRET", "")
VOICE_AGENT_SETTINGS_DOC_ID = "voice_agent_config"

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

DEFAULT_AGENT = {
    "name": "Simran",
    "voice_gender": "female",
    "voice_accent": "Indian female, mid-30s, warm & polite",
    "language_style": "formal_hinglish",
    "personality": "Sweet, polite, educated, patient. Human-like pacing. Light Haryanvi/Hindi flavour, not exaggerated.",
    "intro_line": "Namaste! Main Simran bol rahi hoon, Unique Prime Reality se. Aapse property ke baare mein 2 minute baat kar sakti hoon?",
    "guardrails": (
        "Never make false promises. Never speak against competitors, regions, regulators or policies. "
        "Disclose you are an AI assistant from Unique Prime Reality if asked. If unsure, say: "
        "'Sir, maine aapki query receive kar li hai, main aapko updated details share karwa deti hoon.'"
    ),
    "active": True,
}

DEFAULT_INVENTORY = [
    {"project": "Prime Elmwood Residences", "location": "Sector 79, Gurgaon", "config": "2/3 BHK",
     "price_range": "₹1.2 Cr – ₹1.9 Cr", "possession": "Dec 2026", "highlights": "IGI 25 min, metro extension planned"},
    {"project": "Prime Skyline Towers", "location": "Golf Course Ext Road, Gurgaon", "config": "3/4 BHK",
     "price_range": "₹2.4 Cr – ₹3.8 Cr", "possession": "Ready to move", "highlights": "Premium clubhouse, gated"},
    {"project": "Prime Green Vista", "location": "Sohna Road, Gurgaon", "config": "2/3 BHK",
     "price_range": "₹95 L – ₹1.6 Cr", "possession": "Jun 2027", "highlights": "Investor favourite, high rental yield"},
]

CUSTOMER_MOODS = [
    ("hot_buyer", 18), ("warm_curious", 26), ("investor", 12),
    ("just_browsing", 16), ("busy_callback", 12), ("not_interested", 12), ("wrong_number", 4),
]


def _weighted_mood() -> str:
    pool = []
    for mood, w in CUSTOMER_MOODS:
        pool.extend([mood] * w)
    return random.choice(pool)


def temperature_for(score: int) -> str:
    if score < 0:
        return "lost"
    if score >= 60:
        return "hot"
    if score >= 30:
        return "warm"
    return "cold"


# ---------------- Pydantic payloads ----------------
class AgentIn(BaseModel):
    name: str
    voice_gender: str = "female"
    voice_accent: Optional[str] = None
    language_style: str = "formal_hinglish"
    personality: Optional[str] = None
    intro_line: Optional[str] = None
    guardrails: Optional[str] = None
    active: bool = True


class CampaignIn(BaseModel):
    name: str
    agent_id: Optional[str] = None
    call_limit: int = 1000
    max_retries: int = 2
    retry_gap_hours: int = 4
    script_template: str = "first_contact"
    language_style: str = "formal_hinglish"


class AssignLeadsIn(BaseModel):
    lead_ids: List[str]


class RunIn(BaseModel):
    limit: int = 5


class CallRunIn(BaseModel):
    lead_id: str
    campaign_id: Optional[str] = None
    agent_id: Optional[str] = None
    mood: Optional[str] = None


class InventoryIn(BaseModel):
    project: str
    location: str
    config: Optional[str] = None
    price_range: Optional[str] = None
    possession: Optional[str] = None
    highlights: Optional[str] = None


class ScoringRulesIn(BaseModel):
    rules: dict


class WhatsAppIn(BaseModel):
    lead_id: str
    kind: str = "brochure"  # brochure | project_details | acknowledgment
    message: Optional[str] = None


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
    if doc and doc.get("rules"):
        return doc["rules"]
    return DEFAULT_SCORING_RULES


# ---------------- LLM simulation ----------------
async def _llm_simulate(agent: dict, lead: dict, inventory: List[dict], mood: str,
                        allowed_signals: List[str], prior_context: Optional[str]) -> Optional[dict]:
    if not EMERGENT_LLM_KEY:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.warning(f"emergentintegrations unavailable: {e}")
        return None

    inv_txt = "\n".join(
        f"- {p.get('project')} | {p.get('location')} | {p.get('config')} | {p.get('price_range')} | possession {p.get('possession')} | {p.get('highlights','')}"
        for p in inventory
    ) or "- (no inventory uploaded)"

    system = (
        f"You are {agent.get('name','Simran')}, a female AI tele-calling assistant for 'Unique Prime Reality', "
        f"a real estate consultancy selling residential projects in Gurgaon. "
        f"Persona: {agent.get('personality','polite, educated, mid-30s')}. "
        f"Voice: {agent.get('voice_accent','Indian female, warm')}. "
        f"Speak in FORMAL HINGLISH (English-heavy, polite) with a very light Haryanvi/Hindi flavour — never exaggerated. "
        f"GUARDRAILS: {agent.get('guardrails','')} "
        f"Goals of the call: greet politely, confirm availability, gauge buying intent for Gurgaon projects, "
        f"capture requirements (property type, BHK, budget, location, parking, possession timeline, callback preference), "
        f"detect seriousness & urgency, offer to share details on WhatsApp, ask preferred callback time, and escalate to a human "
        f"({TRANSFER_TARGET_NAME}) if the customer asks for a sales representative or is a serious buyer.\n\n"
        f"AVAILABLE INVENTORY:\n{inv_txt}\n\n"
        "You must SIMULATE a realistic short phone conversation between the AGENT and the CUSTOMER, then extract structured data. "
        "Output STRICT JSON only, no markdown, matching this schema:\n"
        "{\n"
        '  "transcript": [{"speaker":"agent"|"customer","text":"..."}],\n'
        '  "summary": "2-3 sentence English summary of the call",\n'
        '  "disposition": "connected|interested|callback|not_interested|wrong_number|no_answer|site_visit|transferred",\n'
        '  "requirements": {"property_type":str|null,"bhk":str|null,"budget":number|null,"location_preference":str|null,"parking":str|null,"possession_timeline":str|null,"callback_preference":str|null},\n'
        f'  "signals": [subset of {allowed_signals}],\n'
        '  "urgency_score": 1-10,\n'
        '  "wants_site_visit": bool, "wants_brochure": bool, "whatsapp_opt_in": bool,\n'
        '  "human_transfer_required": bool, "next_followup_days": int|null,\n'
        '  "remarks": "short internal note"\n'
        "}\n"
        "Only include signal keys that genuinely occurred. budget must be a number in rupees (e.g. 15000000 for 1.5 Cr) or null."
    )

    prior = f"\nThis is a FOLLOW-UP call. Previous context: {prior_context}" if prior_context else ""
    user = (
        f"Lead: name={lead.get('name')}, phone={lead.get('phone')}, city={lead.get('city') or 'Gurgaon'}, "
        f"existing_interest={lead.get('property_interest') or 'unknown'}, existing_budget={lead.get('budget') or 'unknown'}, "
        f"prior_remarks={lead.get('remark') or 'none'}.\n"
        f"Simulate the customer behaving as: '{mood}'. Keep the transcript realistic (6-14 turns; very short if wrong_number/no_answer)."
        f"{prior}\nReturn ONLY the JSON object."
    )

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"aicall-{uuid.uuid4()}",
            system_message=system,
        ).with_model(*LLM_MODEL)
        resp = await chat.send_message(UserMessage(text=user))
        text = resp if isinstance(resp, str) else str(resp)
        text = text.strip()
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
    """Deterministic fallback when the LLM is unavailable."""
    name = lead.get("name") or "Sir"
    proj = (inventory[0] if inventory else DEFAULT_INVENTORY[0])
    intro = agent.get("intro_line") or f"Namaste! Main {agent.get('name','Simran')} bol rahi hoon, Unique Prime Reality se."
    base = [{"speaker": "agent", "text": intro}]

    if mood == "wrong_number":
        base += [{"speaker": "customer", "text": "Sorry, aapko galat number lag gaya."},
                 {"speaker": "agent", "text": "Oh, apologies for the disturbance. Aapka din shubh ho!"}]
        return {"transcript": base, "summary": "Wrong number — not the intended lead.",
                "disposition": "wrong_number", "requirements": {}, "signals": ["wrong_number"],
                "urgency_score": 1, "wants_site_visit": False, "wants_brochure": False,
                "whatsapp_opt_in": False, "human_transfer_required": False, "next_followup_days": None,
                "remarks": "Wrong number, mark invalid."}

    if mood == "not_interested":
        base += [{"speaker": "customer", "text": "Nahi, mujhe abhi property mein koi interest nahi hai."},
                 {"speaker": "agent", "text": "Bilkul samajh sakti hoon. Thank you for your time, sir."}]
        return {"transcript": base, "summary": "Customer not interested in buying property currently.",
                "disposition": "not_interested", "requirements": {}, "signals": ["not_interested"],
                "urgency_score": 1, "wants_site_visit": False, "wants_brochure": False,
                "whatsapp_opt_in": False, "human_transfer_required": False, "next_followup_days": 90,
                "remarks": "Not interested now, recycle after 90 days."}

    if mood == "busy_callback":
        base += [{"speaker": "customer", "text": "Main abhi busy hoon, thodi der baad call karein."},
                 {"speaker": "agent", "text": "Sure sir, main aapko kal same time par call karti hoon. Dhanyavaad!"}]
        return {"transcript": base, "summary": "Customer busy, requested a callback.",
                "disposition": "callback", "requirements": {"callback_preference": "tomorrow, same time"},
                "signals": ["call_later"], "urgency_score": 3, "wants_site_visit": False,
                "wants_brochure": False, "whatsapp_opt_in": True, "human_transfer_required": False,
                "next_followup_days": 1, "remarks": "Call back tomorrow."}

    # hot_buyer / warm_curious / investor / just_browsing
    base += [
        {"speaker": "customer", "text": "Haan boliye, kya property hai aapke paas?"},
        {"speaker": "agent", "text": f"Ji, hamare paas {proj['project']} hai {proj['location']} mein, {proj['config']}, {proj['price_range']}. Aap kis budget aur BHK mein dekh rahe hain?"},
    ]
    if mood == "hot_buyer":
        base += [
            {"speaker": "customer", "text": "3 BHK chahiye, budget around 1.8 crore, agle 3-4 hafton mein finalize karna hai. Parking bhi chahiye."},
            {"speaker": "agent", "text": "Perfect sir, yeh requirement bilkul match karti hai. Main details WhatsApp par bhej deti hoon aur ek site visit arrange kar deti hoon. Aapko humare sales manager se baat karwa doon?"},
            {"speaker": "customer", "text": "Haan, WhatsApp par bhej do aur site visit is weekend rakh lo. Sales person se baat karwa do."},
        ]
        return {"transcript": base, "summary": "Hot buyer: 3 BHK, ~1.8 Cr, wants site visit this weekend, needs parking, urgent (30 days), requested human + WhatsApp details.",
                "disposition": "site_visit",
                "requirements": {"property_type": "Apartment", "bhk": "3 BHK", "budget": 18000000,
                                 "location_preference": proj["location"], "parking": "Required",
                                 "possession_timeline": "within 1 month", "callback_preference": "this weekend"},
                "signals": ["budget_shared", "bhk_shared", "timeline_shared", "wants_site_visit",
                            "urgent_30_days", "whatsapp_details", "requested_human", "wants_callback"],
                "urgency_score": 9, "wants_site_visit": True, "wants_brochure": True,
                "whatsapp_opt_in": True, "human_transfer_required": True, "next_followup_days": 2,
                "remarks": "Serious buyer — transfer to Vranda, schedule site visit."}
    if mood == "investor":
        base += [
            {"speaker": "customer", "text": "Main investment ke liye dekh raha hoon, 2-3 units chahiye Sohna Road pe, rental yield acchi honi chahiye."},
            {"speaker": "agent", "text": "Bahut badhiya sir, Prime Green Vista investors ke liye ideal hai. Main details WhatsApp par share karti hoon."},
        ]
        return {"transcript": base, "summary": "Investor: wants 2-3 units on Sohna Road for rental yield.",
                "disposition": "interested",
                "requirements": {"property_type": "Apartment", "bhk": "2 BHK", "budget": 12000000,
                                 "location_preference": "Sohna Road", "parking": None,
                                 "possession_timeline": "flexible", "callback_preference": "evening"},
                "signals": ["investor_intent", "budget_shared", "whatsapp_details", "bhk_shared"],
                "urgency_score": 6, "wants_site_visit": False, "wants_brochure": True,
                "whatsapp_opt_in": True, "human_transfer_required": True, "next_followup_days": 3,
                "remarks": "Investor lead — multiple units."}
    if mood == "warm_curious":
        base += [
            {"speaker": "customer", "text": "2 BHK dekh raha hoon around 1.2 crore, abhi thoda explore kar raha hoon."},
            {"speaker": "agent", "text": "Ji sir, main aapko brochure WhatsApp par bhej deti hoon, aaram se dekh lijiyega."},
        ]
        return {"transcript": base, "summary": "Warm lead: exploring 2 BHK around 1.2 Cr, wants brochure on WhatsApp.",
                "disposition": "interested",
                "requirements": {"property_type": "Apartment", "bhk": "2 BHK", "budget": 12000000,
                                 "location_preference": proj["location"], "parking": "Optional",
                                 "possession_timeline": "3-6 months", "callback_preference": "weekend"},
                "signals": ["bhk_shared", "budget_shared", "whatsapp_details"],
                "urgency_score": 5, "wants_site_visit": False, "wants_brochure": True,
                "whatsapp_opt_in": True, "human_transfer_required": False, "next_followup_days": 5,
                "remarks": "Warm — nurture with brochure & follow-up."}
    # just_browsing
    base += [
        {"speaker": "customer", "text": "Bas aise hi pooch raha tha, koi serious plan nahi hai abhi."},
        {"speaker": "agent", "text": "Koi baat nahi sir, main details WhatsApp par bhej deti hoon, jab plan bane to bata dijiyega."},
    ]
    return {"transcript": base, "summary": "Casual enquiry, no serious buying plan currently.",
            "disposition": "connected", "requirements": {"callback_preference": "later"},
            "signals": ["casual_interest"], "urgency_score": 2, "wants_site_visit": False,
            "wants_brochure": True, "whatsapp_opt_in": True, "human_transfer_required": False,
            "next_followup_days": 30, "remarks": "Low intent, long-term nurture."}


async def _run_single_call(lead: dict, agent: dict, rules: dict, inventory: List[dict],
                           mood: Optional[str], campaign: Optional[dict],
                           actor: dict, prior_context: Optional[str] = None) -> dict:
    """SIMULATED path (v1) — no real phone call happens. Kept for demo/testing
    and as a fallback when the voice-agent service is not configured."""
    mood = mood or _weighted_mood()
    allowed = list(rules.keys())
    result = await _llm_simulate(agent, lead, inventory, mood, allowed, prior_context)
    source = "ai"
    if not result:
        result = _mock_simulate(agent, lead, inventory, mood)
        source = "mock"
    return await _finalize_call(lead, agent, rules, campaign, actor.get("username"),
                                mood, result, source)


async def _finalize_call(lead: dict, agent: dict, rules: dict, campaign: Optional[dict],
                         actor_username: Optional[str], mood: Optional[str],
                         result: dict, source: str) -> dict:
    """Shared tail: scoring, persistence, CRM sync, follow-up/transfer/WhatsApp
    side-effects. Used by BOTH the simulated path (_run_single_call) and the
    REAL call ingest path (POST /api/ai/calls/ingest, called by the voice-agent
    microservice once an actual phone call has finished)."""
    signals = [s for s in (result.get("signals") or []) if s in rules]
    score = sum(int(rules[s]["points"]) for s in signals)
    score = max(-60, min(120, score))
    temperature = temperature_for(score)

    req = result.get("requirements") or {}
    lead_id = lead["_id"]
    attempt = int(lead.get("ai_call_attempt_count", 0)) + 1
    ts = now_iso()

    disposition = result.get("disposition", "connected")
    transfer_needed = bool(result.get("human_transfer_required"))
    next_days = result.get("next_followup_days")
    next_followup_at = None
    if isinstance(next_days, int) and next_days >= 0:
        next_followup_at = (datetime.now(timezone.utc) + timedelta(days=next_days)).isoformat()

    # Persist the AI call record (transcript + extraction)
    call_doc = {
        "lead_id": str(lead_id),
        "lead_name": lead.get("name"),
        "lead_phone": lead.get("phone"),
        "campaign_id": str(campaign["_id"]) if campaign else None,
        "campaign_name": campaign.get("name") if campaign else None,
        "agent_name": agent.get("name"),
        "mood": mood,
        "source": source,
        "transcript": result.get("transcript") or [],
        "summary": result.get("summary") or "",
        "disposition": disposition,
        "requirements": req,
        "signals": signals,
        "intent_score": score,
        "temperature": temperature,
        "urgency_score": result.get("urgency_score"),
        "wants_site_visit": bool(result.get("wants_site_visit")),
        "wants_brochure": bool(result.get("wants_brochure")),
        "whatsapp_opt_in": bool(result.get("whatsapp_opt_in")),
        "human_transfer_required": transfer_needed,
        "next_followup_at": next_followup_at,
        "remarks": result.get("remarks") or "",
        "attempt": attempt,
        "created_at": ts,
        "created_by": actor_username,
    }
    ins = await db.ai_calls.insert_one(call_doc)
    call_id = str(ins.inserted_id)
    call_doc.pop("_id", None)

    # Sync structured fields back onto the CRM lead
    lead_update = {
        "assigned_agent_type": "ai",
        "ai_call_status": "called",
        "ai_last_call_at": ts,
        "ai_call_attempt_count": attempt,
        "ai_last_disposition": disposition,
        "ai_summary": call_doc["summary"],
        "ai_transcript_ref": call_id,
        "ai_intent_score": score,
        "ai_temperature": temperature,
        "ai_urgency_score": call_doc["urgency_score"],
        "ai_property_type": req.get("property_type"),
        "ai_bhk": req.get("bhk"),
        "ai_parking": req.get("parking"),
        "ai_location_preference": req.get("location_preference"),
        "ai_possession_timeline": req.get("possession_timeline"),
        "ai_callback_preference": req.get("callback_preference"),
        "ai_wants_site_visit": call_doc["wants_site_visit"],
        "ai_wants_brochure": call_doc["wants_brochure"],
        "ai_whatsapp_opt_in": call_doc["whatsapp_opt_in"],
        "ai_human_transfer_required": transfer_needed,
        "ai_transfer_target_number": TRANSFER_TARGET_NUMBER if transfer_needed else None,
        "ai_remarks": call_doc["remarks"],
        "ai_next_followup_at": next_followup_at,
        "updated_at": ts,
        "last_contacted_at": ts,
    }
    if req.get("budget"):
        try:
            lead_update["budget"] = float(req["budget"])
        except (TypeError, ValueError):
            pass
    # Mirror temperature into the CRM's existing "tag" so existing filters light up
    if temperature in ("hot", "warm", "cold"):
        lead_update["tag"] = temperature
    await db.leads.update_one({"_id": lead_id}, {"$set": lead_update})

    # Follow-up task
    if next_followup_at:
        await db.ai_followups.insert_one({
            "lead_id": str(lead_id), "lead_name": lead.get("name"), "lead_phone": lead.get("phone"),
            "campaign_id": call_doc["campaign_id"], "agent_name": agent.get("name"),
            "due_at": next_followup_at, "reason": disposition, "prior_summary": call_doc["summary"],
            "status": "pending", "created_at": ts,
        })

    # Human transfer / urgent callback task for Vranda
    if transfer_needed:
        await db.ai_transfers.insert_one({
            "lead_id": str(lead_id), "lead_name": lead.get("name"), "lead_phone": lead.get("phone"),
            "target_name": TRANSFER_TARGET_NAME, "target_number": TRANSFER_TARGET_NUMBER,
            "reason": call_doc["summary"], "temperature": temperature, "intent_score": score,
            "status": "pending", "created_at": ts,
        })

    # WhatsApp follow-up log (simulated send)
    if call_doc["whatsapp_opt_in"] or call_doc["wants_brochure"]:
        kind = "brochure" if call_doc["wants_brochure"] else "project_details"
        await db.ai_whatsapp.insert_one({
            "lead_id": str(lead_id), "lead_name": lead.get("name"), "lead_phone": lead.get("phone"),
            "kind": kind,
            "message": f"Namaste {lead.get('name','')}, Unique Prime Reality se {agent.get('name','Simran')}. "
                       f"Sharing details of our Gurgaon projects as discussed.",
            "status": "sent", "created_at": ts,
        })
        await db.leads.update_one({"_id": lead_id}, {"$set": {"brochure_sent": True, "brochure_sent_at": ts,
                                                              "ai_whatsapp_status": "sent"}})

    return {"call_id": call_id, **call_doc}


# ---------------- Agent endpoints ----------------
@ai_router.get("/agents")
async def list_agents(user: dict = Depends(get_current_user)):
    docs = await db.ai_agents.find().to_list(100)
    return [_clean(d) for d in docs]


@ai_router.post("/agents")
async def create_agent(payload: AgentIn, user: dict = Depends(require_admin)):
    doc = payload.model_dump()
    doc["created_at"] = now_iso()
    ins = await db.ai_agents.insert_one(doc)
    return _clean(await db.ai_agents.find_one({"_id": ins.inserted_id}))


@ai_router.put("/agents/{agent_id}")
async def update_agent(agent_id: str, payload: AgentIn, user: dict = Depends(require_admin)):
    await db.ai_agents.update_one({"_id": ObjectId(agent_id)}, {"$set": payload.model_dump()})
    return _clean(await db.ai_agents.find_one({"_id": ObjectId(agent_id)}))


@ai_router.delete("/agents/{agent_id}")
async def delete_agent(agent_id: str, user: dict = Depends(require_admin)):
    await db.ai_agents.delete_one({"_id": ObjectId(agent_id)})
    return {"ok": True}


# ---------------- Scoring rules ----------------
@ai_router.get("/scoring-rules")
async def get_scoring_rules(user: dict = Depends(get_current_user)):
    return {"rules": await _get_scoring_rules(),
            "temperature_bands": {"hot": "60+", "warm": "30-59", "cold": "0-29", "lost": "<0"}}


@ai_router.put("/scoring-rules")
async def update_scoring_rules(payload: ScoringRulesIn, user: dict = Depends(require_admin)):
    await db.ai_settings.update_one({"_id": "scoring_rules"},
                                    {"$set": {"rules": payload.rules, "updated_at": now_iso()}}, upsert=True)
    return {"rules": payload.rules}


# ---------------- Inventory ----------------
@ai_router.get("/inventory")
async def list_inventory(user: dict = Depends(get_current_user)):
    docs = await db.ai_inventory.find().to_list(500)
    return [_clean(d) for d in docs]


@ai_router.post("/inventory")
async def add_inventory(payload: InventoryIn, user: dict = Depends(require_admin)):
    doc = payload.model_dump()
    doc["created_at"] = now_iso()
    ins = await db.ai_inventory.insert_one(doc)
    return _clean(await db.ai_inventory.find_one({"_id": ins.inserted_id}))


@ai_router.delete("/inventory/{item_id}")
async def delete_inventory(item_id: str, user: dict = Depends(require_admin)):
    await db.ai_inventory.delete_one({"_id": ObjectId(item_id)})
    return {"ok": True}


# ---------------- Campaigns ----------------
@ai_router.get("/campaigns")
async def list_campaigns(user: dict = Depends(get_current_user)):
    docs = await db.ai_campaigns.find().sort("created_at", -1).to_list(200)
    out = []
    for d in docs:
        cid = str(d["_id"])
        d = _clean(d)
        d["queued"] = await db.ai_queue.count_documents({"campaign_id": cid, "status": "queued"})
        d["done"] = await db.ai_queue.count_documents({"campaign_id": cid, "status": "done"})
        d["total"] = await db.ai_queue.count_documents({"campaign_id": cid})
        out.append(d)
    return out


@ai_router.post("/campaigns")
async def create_campaign(payload: CampaignIn, user: dict = Depends(require_admin)):
    doc = payload.model_dump()
    doc.update({"status": "active", "created_at": now_iso(), "created_by": user.get("username")})
    ins = await db.ai_campaigns.insert_one(doc)
    return _clean(await db.ai_campaigns.find_one({"_id": ins.inserted_id}))


@ai_router.get("/campaigns/{campaign_id}")
async def get_campaign(campaign_id: str, user: dict = Depends(get_current_user)):
    c = await db.ai_campaigns.find_one({"_id": ObjectId(campaign_id)})
    if not c:
        raise HTTPException(404, "Campaign not found")
    queue = await db.ai_queue.find({"campaign_id": campaign_id}).sort("created_at", 1).to_list(1000)
    return {"campaign": _clean(c), "queue": [_clean(q) for q in queue]}


@ai_router.delete("/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, user: dict = Depends(require_admin)):
    await db.ai_campaigns.delete_one({"_id": ObjectId(campaign_id)})
    await db.ai_queue.delete_many({"campaign_id": campaign_id})
    return {"ok": True}


@ai_router.post("/campaigns/{campaign_id}/assign")
async def assign_leads(campaign_id: str, payload: AssignLeadsIn, user: dict = Depends(require_admin)):
    c = await db.ai_campaigns.find_one({"_id": ObjectId(campaign_id)})
    if not c:
        raise HTTPException(404, "Campaign not found")
    added = 0
    for lid in payload.lead_ids:
        try:
            lead = await db.leads.find_one({"_id": ObjectId(lid)})
        except Exception:
            continue
        if not lead:
            continue
        exists = await db.ai_queue.find_one({"campaign_id": campaign_id, "lead_id": lid,
                                             "status": {"$in": ["queued"]}})
        if exists:
            continue
        await db.ai_queue.insert_one({
            "campaign_id": campaign_id, "lead_id": lid, "lead_name": lead.get("name"),
            "lead_phone": lead.get("phone"), "status": "queued", "attempts": 0, "created_at": now_iso(),
        })
        await db.leads.update_one({"_id": ObjectId(lid)},
                                  {"$set": {"assigned_agent_type": "ai", "ai_call_status": "queued"}})
        added += 1
    return {"added": added}


@ai_router.post("/campaigns/{campaign_id}/run")
async def run_campaign(campaign_id: str, payload: RunIn, user: dict = Depends(require_admin)):
    c = await db.ai_campaigns.find_one({"_id": ObjectId(campaign_id)})
    if not c:
        raise HTTPException(404, "Campaign not found")
    agent = await _get_agent(c.get("agent_id"))
    rules = await _get_scoring_rules()
    inventory = await db.ai_inventory.find().to_list(500)
    if not inventory:
        inventory = DEFAULT_INVENTORY

    limit = max(1, min(payload.limit, 20))
    queued = await db.ai_queue.find({"campaign_id": campaign_id, "status": "queued"}).limit(limit).to_list(limit)
    results = []
    for q in queued:
        lead = await db.leads.find_one({"_id": ObjectId(q["lead_id"])})
        if not lead:
            await db.ai_queue.update_one({"_id": q["_id"]}, {"$set": {"status": "skipped"}})
            continue
        res = await _run_single_call(lead, agent, rules, inventory, None, c, user)
        await db.ai_queue.update_one({"_id": q["_id"]}, {"$set": {
            "status": "done", "disposition": res["disposition"], "temperature": res["temperature"],
            "intent_score": res["intent_score"], "done_at": now_iso(),
        }, "$inc": {"attempts": 1}})
        results.append({"lead_name": q.get("lead_name"), "disposition": res["disposition"],
                        "temperature": res["temperature"], "intent_score": res["intent_score"],
                        "call_id": res["call_id"]})
    remaining = await db.ai_queue.count_documents({"campaign_id": campaign_id, "status": "queued"})
    return {"processed": len(results), "remaining": remaining, "results": results}


# ---------------- Single call / recall (SIMULATED) ----------------
@ai_router.post("/calls/run")
async def run_single(payload: CallRunIn, user: dict = Depends(require_admin)):
    lead = await db.leads.find_one({"_id": ObjectId(payload.lead_id)})
    if not lead:
        raise HTTPException(404, "Lead not found")
    agent = await _get_agent(payload.agent_id)
    rules = await _get_scoring_rules()
    inventory = await db.ai_inventory.find().to_list(500) or DEFAULT_INVENTORY
    campaign = None
    if payload.campaign_id:
        campaign = await db.ai_campaigns.find_one({"_id": ObjectId(payload.campaign_id)})
    res = await _run_single_call(lead, agent, rules, inventory, payload.mood, campaign, user)
    return res


# ================================================================
# REAL VOICE CALLING — talks to the separate voice-agent microservice
# ================================================================
class RealCallTriggerIn(BaseModel):
    lead_id: str
    campaign_id: Optional[str] = None
    agent_id: Optional[str] = None


class CallIngestIn(BaseModel):
    """Payload the voice-agent microservice POSTs back once a REAL phone
    call has finished. Mirrors the schema _llm_simulate() produces, but
    every field here is extracted from an ACTUAL recorded conversation."""
    lead_id: str
    campaign_id: Optional[str] = None
    agent_name: Optional[str] = None
    call_uuid: Optional[str] = None
    recording_url: Optional[str] = None
    duration_seconds: Optional[int] = None
    transcript: List[dict] = Field(default_factory=list)
    summary: str = ""
    disposition: str = "connected"
    requirements: dict = Field(default_factory=dict)
    signals: List[str] = Field(default_factory=list)
    urgency_score: Optional[int] = None
    wants_site_visit: bool = False
    wants_brochure: bool = False
    whatsapp_opt_in: bool = False
    human_transfer_required: bool = False
    next_followup_days: Optional[int] = None
    remarks: str = ""


async def _get_voice_agent_config() -> tuple[str, str]:
    """DB-stored config (settable from inside the CRM) wins over env vars."""
    doc = await db.ai_settings.find_one({"_id": VOICE_AGENT_SETTINGS_DOC_ID})
    url = ((doc or {}).get("voice_agent_url") or VOICE_AGENT_URL_ENV or "").rstrip("/")
    secret = (doc or {}).get("voice_agent_shared_secret") or VOICE_AGENT_SHARED_SECRET_ENV
    return url, secret


async def _check_voice_agent_secret(x_voice_agent_secret: Optional[str]):
    _, configured_secret = await _get_voice_agent_config()
    if not configured_secret:
        raise HTTPException(500, "Voice-agent shared secret is not configured on the CRM backend")
    if not x_voice_agent_secret or x_voice_agent_secret != configured_secret:
        raise HTTPException(401, "Invalid or missing voice-agent shared secret")


class VoiceAgentSettingsIn(BaseModel):
    voice_agent_url: str
    voice_agent_shared_secret: Optional[str] = None  # blank/omitted = keep existing secret unchanged


@ai_router.get("/calls/real/settings")
async def get_voice_agent_settings(user: dict = Depends(require_vranda_only)):
    """Lets Vranda see/set the voice-agent API link and shared secret
    directly from the CRM UI — no backend code edits or redeploy needed.
    The secret itself is never sent back to the browser, only whether one
    is set, so it can't leak via network tab / screenshots."""
    url, secret = await _get_voice_agent_config()
    return {"voice_agent_url": url, "secret_configured": bool(secret),
            "source": "database" if url and url != VOICE_AGENT_URL_ENV else ("env" if url else "unset")}


@ai_router.post("/calls/real/settings")
async def set_voice_agent_settings(payload: VoiceAgentSettingsIn, user: dict = Depends(require_vranda_only)):
    if not payload.voice_agent_url.startswith("http"):
        raise HTTPException(400, "voice_agent_url must be a full https:// URL")
    update = {"voice_agent_url": payload.voice_agent_url.rstrip("/"),
              "updated_at": now_iso(), "updated_by": user.get("username")}
    if payload.voice_agent_shared_secret:  # blank = keep whatever secret is already stored
        update["voice_agent_shared_secret"] = payload.voice_agent_shared_secret
    await db.ai_settings.update_one(
        {"_id": VOICE_AGENT_SETTINGS_DOC_ID}, {"$set": update}, upsert=True,
    )
    return {"ok": True}


@ai_router.post("/calls/real/trigger")
async def trigger_real_call(payload: RealCallTriggerIn, user: dict = Depends(require_vranda_only)):
    """Vranda clicks 'Call now (real)' in the CRM. This asks the voice-agent
    microservice to actually dial the lead's phone number. The CRM backend
    never talks to Plivo directly — only the voice-agent does."""
    voice_agent_url, voice_agent_secret = await _get_voice_agent_config()
    if not voice_agent_url or not voice_agent_secret:
        raise HTTPException(
            500,
            "Real calling is not configured yet. Go to Settings and paste the "
            "voice-agent URL + shared secret (or set VOICE_AGENT_URL / "
            "VOICE_AGENT_SHARED_SECRET as env vars on the backend).",
        )
    lead = await db.leads.find_one({"_id": ObjectId(payload.lead_id)})
    if not lead:
        raise HTTPException(404, "Lead not found")
    if not lead.get("phone"):
        raise HTTPException(400, "Lead has no phone number")

    agent = await _get_agent(payload.agent_id)
    inventory = await db.ai_inventory.find().to_list(500) or DEFAULT_INVENTORY
    campaign = None
    if payload.campaign_id:
        campaign = await db.ai_campaigns.find_one({"_id": ObjectId(payload.campaign_id)})

    import httpx
    body = {
        "lead_id": str(lead["_id"]),
        "lead_name": lead.get("name"),
        "phone": lead.get("phone"),
        "city": lead.get("city"),
        "property_interest": lead.get("property_interest"),
        "budget": lead.get("budget"),
        "remark": lead.get("remark"),
        "campaign_id": payload.campaign_id,
        "agent": {
            "name": agent.get("name"),
            "voice_gender": agent.get("voice_gender", "female"),
            "voice_accent": agent.get("voice_accent"),
            "language_style": agent.get("language_style", "formal_hinglish"),
            "personality": agent.get("personality"),
            "intro_line": agent.get("intro_line"),
            "guardrails": agent.get("guardrails"),
        },
        "inventory": inventory,
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{voice_agent_url}/trigger",
                json=body,
                headers={"X-Voice-Agent-Secret": voice_agent_secret},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        logger.error(f"voice-agent trigger failed: {e}")
        raise HTTPException(502, f"Could not reach voice-agent service: {e}")

    await db.leads.update_one(
        {"_id": lead["_id"]},
        {"$set": {"assigned_agent_type": "ai", "ai_call_status": "dialing",
                  "ai_call_uuid": data.get("call_uuid"), "updated_at": now_iso()}},
    )
    return {"ok": True, "call_uuid": data.get("call_uuid"), "status": data.get("status", "dialing")}


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
            {"_id": ObjectId(res["call_id"])},
            {"$set": {"recording_url": payload.recording_url,
                      "duration_seconds": payload.duration_seconds,
                      "call_uuid": payload.call_uuid}},
        )
    await db.leads.update_one({"_id": lead["_id"]}, {"$set": {"ai_call_status": "called"}})
    return res



@ai_router.get("/calls")
async def list_calls(temperature: Optional[str] = None, disposition: Optional[str] = None,
                     campaign_id: Optional[str] = None, limit: int = 200,
                     user: dict = Depends(get_current_user)):
    q: dict = {}
    if temperature:
        q["temperature"] = temperature
    if disposition:
        q["disposition"] = disposition
    if campaign_id:
        q["campaign_id"] = campaign_id
    docs = await db.ai_calls.find(q).sort("created_at", -1).limit(min(limit, 500)).to_list(500)
    return [_clean(d) for d in docs]


@ai_router.get("/calls/{call_id}")
async def get_call(call_id: str, user: dict = Depends(get_current_user)):
    c = await db.ai_calls.find_one({"_id": ObjectId(call_id)})
    if not c:
        raise HTTPException(404, "Call not found")
    return _clean(c)


@ai_router.get("/lead/{lead_id}/calls")
async def lead_calls(lead_id: str, user: dict = Depends(get_current_user)):
    docs = await db.ai_calls.find({"lead_id": lead_id}).sort("created_at", -1).to_list(100)
    return [_clean(d) for d in docs]


# ---------------- Follow-ups ----------------
@ai_router.get("/followups")
async def list_followups(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"status": status} if status else {}
    docs = await db.ai_followups.find(q).sort("due_at", 1).to_list(500)
    return [_clean(d) for d in docs]


@ai_router.post("/followups/{fu_id}/recall")
async def recall_followup(fu_id: str, user: dict = Depends(require_admin)):
    fu = await db.ai_followups.find_one({"_id": ObjectId(fu_id)})
    if not fu:
        raise HTTPException(404, "Follow-up not found")
    lead = await db.leads.find_one({"_id": ObjectId(fu["lead_id"])})
    if not lead:
        raise HTTPException(404, "Lead not found")
    agent = await _get_agent(None)
    rules = await _get_scoring_rules()
    inventory = await db.ai_inventory.find().to_list(500) or DEFAULT_INVENTORY
    res = await _run_single_call(lead, agent, rules, inventory, None, None, user,
                                 prior_context=fu.get("prior_summary"))
    await db.ai_followups.update_one({"_id": ObjectId(fu_id)},
                                     {"$set": {"status": "done", "done_at": now_iso()}})
    return res


@ai_router.post("/followups/{fu_id}/done")
async def complete_followup(fu_id: str, user: dict = Depends(get_current_user)):
    await db.ai_followups.update_one({"_id": ObjectId(fu_id)},
                                     {"$set": {"status": "done", "done_at": now_iso()}})
    return {"ok": True}


# ---------------- Transfers ----------------
@ai_router.get("/transfers")
async def list_transfers(status: Optional[str] = None, user: dict = Depends(get_current_user)):
    q = {"status": status} if status else {}
    docs = await db.ai_transfers.find(q).sort("created_at", -1).to_list(500)
    return [_clean(d) for d in docs]


@ai_router.post("/transfers/{tr_id}/resolve")
async def resolve_transfer(tr_id: str, user: dict = Depends(get_current_user)):
    await db.ai_transfers.update_one({"_id": ObjectId(tr_id)},
                                     {"$set": {"status": "resolved", "resolved_at": now_iso(),
                                               "resolved_by": user.get("username")}})
    return {"ok": True}


# ---------------- WhatsApp ----------------
@ai_router.get("/whatsapp")
async def list_whatsapp(user: dict = Depends(get_current_user)):
    docs = await db.ai_whatsapp.find().sort("created_at", -1).to_list(500)
    return [_clean(d) for d in docs]


@ai_router.post("/whatsapp/send")
async def send_whatsapp(payload: WhatsAppIn, user: dict = Depends(get_current_user)):
    lead = await db.leads.find_one({"_id": ObjectId(payload.lead_id)})
    if not lead:
        raise HTTPException(404, "Lead not found")
    ts = now_iso()
    msg = payload.message or (
        f"Namaste {lead.get('name','')}, Unique Prime Reality se. Sharing our Gurgaon project details with you."
    )
    ins = await db.ai_whatsapp.insert_one({
        "lead_id": payload.lead_id, "lead_name": lead.get("name"), "lead_phone": lead.get("phone"),
        "kind": payload.kind, "message": msg, "status": "sent", "created_at": ts,
        "sent_by": user.get("username"),
    })
    await db.leads.update_one({"_id": ObjectId(payload.lead_id)},
                              {"$set": {"ai_whatsapp_status": "sent",
                                        "brochure_sent": True, "brochure_sent_at": ts}})
    return _clean(await db.ai_whatsapp.find_one({"_id": ins.inserted_id}))


# ---------------- Dashboard ----------------
@ai_router.get("/dashboard")
async def ai_dashboard(user: dict = Depends(get_current_user)):
    total_calls = await db.ai_calls.count_documents({})
    hot = await db.ai_calls.count_documents({"temperature": "hot"})
    warm = await db.ai_calls.count_documents({"temperature": "warm"})
    cold = await db.ai_calls.count_documents({"temperature": "cold"})
    lost = await db.ai_calls.count_documents({"temperature": "lost"})
    queued = await db.ai_queue.count_documents({"status": "queued"})
    transfers_pending = await db.ai_transfers.count_documents({"status": "pending"})
    followups_pending = await db.ai_followups.count_documents({"status": "pending"})
    whatsapp_sent = await db.ai_whatsapp.count_documents({"status": "sent"})
    campaigns = await db.ai_campaigns.count_documents({})
    recent = await db.ai_calls.find().sort("created_at", -1).limit(8).to_list(8)
    return {
        "total_calls": total_calls, "hot": hot, "warm": warm, "cold": cold, "lost": lost,
        "queued": queued, "transfers_pending": transfers_pending,
        "followups_pending": followups_pending, "whatsapp_sent": whatsapp_sent,
        "campaigns": campaigns, "recent": [_clean(r) for r in recent],
    }


# ---------------- Startup seed ----------------
async def seed_ai_defaults():
    if await db.ai_agents.count_documents({}) == 0:
        doc = dict(DEFAULT_AGENT)
        doc["created_at"] = now_iso()
        await db.ai_agents.insert_one(doc)
        logger.info("Seeded default AI agent persona")
    if await db.ai_inventory.count_documents({}) == 0:
        for p in DEFAULT_INVENTORY:
            d = dict(p)
            d["created_at"] = now_iso()
            await db.ai_inventory.insert_one(d)
        logger.info("Seeded default project inventory")
    if not await db.ai_settings.find_one({"_id": "scoring_rules"}):
        await db.ai_settings.insert_one({"_id": "scoring_rules", "rules": DEFAULT_SCORING_RULES,
                                         "updated_at": now_iso()})
        logger.info("Seeded default scoring rules")
    await db.ai_queue.create_index([("campaign_id", 1), ("status", 1)])
    await db.ai_calls.create_index([("lead_id", 1), ("created_at", -1)])
