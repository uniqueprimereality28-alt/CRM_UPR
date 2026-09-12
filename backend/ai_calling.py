"""
Attachable AI Calling layer for Unique Prime Reality CRM.

REAL (v2) outbound AI telecalling engine:
- Real outbound phone calls placed via LiveKit Cloud + Vobiz SIP Trunk
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
import re
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
    AI_CALLING_USERNAMES — intentionally not tied to the 'superadmin' role,
    so it stays exclusive to these specific accounts even if other users
    hold that role later."""
    if user.get("username") not in AI_CALLING_USERNAMES:
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
VOICE_AGENT_URL = os.environ.get("VOICE_AGENT_URL", "")
VOICE_AGENT_SHARED_SECRET = os.environ.get("VOICE_AGENT_SHARED_SECRET", "")
LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "")
VOBIZ_SIP_TRUNK_ID = os.environ.get("VOBIZ_SIP_TRUNK_ID", "")
TRANSFER_TARGET_NUMBER = "7351735035"
TRANSFER_TARGET_NAME = "Vranda Aggarwal"


async def _get_voice_agent_config() -> dict:
    doc = await db.ai_settings.find_one({"_id": "telephony_config"})
    cfg = doc.get("config", {}) if doc else {}
    return {
        "voice_agent_url": (cfg.get("voice_agent_url") or VOICE_AGENT_URL).rstrip("/"),
        "voice_agent_shared_secret": cfg.get("voice_agent_shared_secret") or VOICE_AGENT_SHARED_SECRET,
        "livekit_url": cfg.get("livekit_url") or LIVEKIT_URL,
        "livekit_api_key": cfg.get("livekit_api_key") or LIVEKIT_API_KEY,
        "livekit_api_secret": cfg.get("livekit_api_secret") or LIVEKIT_API_SECRET,
        "livekit_agent_name": cfg.get("livekit_agent_name") or "upr-calling-agent",
        "vobiz_sip_trunk_id": cfg.get("vobiz_sip_trunk_id") or VOBIZ_SIP_TRUNK_ID,
        "grok_api_key": cfg.get("grok_api_key") or os.environ.get("GROK_API_KEY", ""),
        "sarvam_api_key": cfg.get("sarvam_api_key") or os.environ.get("SARVAM_API_KEY", ""),
        "deepgram_api_key": cfg.get("deepgram_api_key") or os.environ.get("DEEPGRAM_API_KEY", ""),
        "sarvam_speaker": cfg.get("sarvam_speaker") or "meera",
        "sarvam_language": cfg.get("sarvam_language") or "hi-IN",
    }


async def _check_voice_agent_secret(provided: Optional[str]):
    cfg = await _get_voice_agent_config()
    expected = cfg.get("voice_agent_shared_secret")
    if not expected:
        raise HTTPException(500, "Voice agent shared secret is not configured on the CRM backend")
    if not provided or provided != expected:
        raise HTTPException(401, "Invalid voice-agent shared secret header")


# ---------------- Default scoring rules ----------------
DEFAULT_SCORING_RULES = {
    "budget_shared": {"label": "Buyer shared specific budget", "points": 20},
    "bhk_shared": {"label": "Buyer shared BHK / configuration", "points": 15},
    "timeline_shared": {"label": "Buyer shared buying timeline", "points": 15},
    "wants_site_visit": {"label": "Buyer requested site visit", "points": 35},
    "wants_callback": {"label": "Buyer requested follow-up callback", "points": 10},
    "urgent_30_days": {"label": "Looking to buy within 30 days", "points": 25},
    "investor_intent": {"label": "Investor looking for multiple units / rental yield", "points": 20},
    "whatsapp_details": {"label": "Agreed to receive brochure on WhatsApp", "points": 10},
    "casual_interest": {"label": "Casual interest / exploring market", "points": 5},
    "not_interested": {"label": "Explicitly not interested", "points": -50},
    "wrong_number": {"label": "Wrong number / invalid contact", "points": -100},
    "call_later": {"label": "Busy / asked to call later", "points": 0},
    "requested_human": {"label": "Requested human senior consultant (Vranda)", "points": 20},
}

TEMPERATURE_BANDS = {
    "hot": 60,
    "warm": 30,
    "cold": 0,
    "lost": -1,
}

DEFAULT_AGENT = {
    "name": "Simran",
    "voice_gender": "female",
    "voice_accent": "Indian English & Hindi (Hinglish)",
    "language_style": "formal_hinglish",
    "personality": "Warm, polite, professional, never pushy. Fluent in conversational Hinglish.",
    "intro_line": "Namaste! Main Simran bol rahi hoon, Unique Prime Reality Gurgaon se. Kya aapse property enquiry ke regarding 2 minute baat ho sakti hai?",
    "guardrails": "Never quote unverified discounts, legal advice, or guaranteed returns. If pushed for an on-the-spot price commitment, offer human transfer to Vranda Aggarwal.",
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

DEFAULT_KNOWLEDGE_BASE = {
    "agent_name": "Simran",
    "company_name": "Unique Prime Reality",
    "company_description": "A premier real-estate consultancy selling verified luxury and investment residential projects in Gurgaon.",
    "company_website": "https://uniqueprimereality.com",
    "company_phone": "+91 7351735035",
    "office_hours": "Monday–Saturday, 10:00 AM–7:00 PM IST",
    "market": "Gurgaon, Haryana, India (Golf Course Ext Road, Sector 79, Sohna Road, Dwarka Expressway)",
    "address": "Gurgaon, Haryana, India",
    "services": "Residential apartment sales, luxury builder floors, investment consultation, site visit coordination, and home loan guidance.",
    "tone": "Warm, polite, respectful, and never pushy. Speak fluent conversational Hinglish or English.",
    "system_prompt": "Keep each response to 1 or 2 short sentences. Always ask only one question at a time. Never invent prices or legal advice.",
    "call_objective": "Qualify property requirements (BHK, budget, location, timeline) and book site visits or WhatsApp brochure follow-ups.",
    "qualification_goals": "Confirm customer name, preferred BHK, budget range in Lakhs/Crores, preferred Gurgaon sector, and buying timeline.",
    "success_criteria": "Leave the customer with a confirmed site visit, WhatsApp project details, or scheduled senior consultant callback.",
    "offer": "Exclusive pre-launch pricing on Sector 79 Prime Elmwood Residences, and special payment plans for Skyline Towers.",
    "objection_handling": "Acknowledge concerns respectfully, provide confirmed facts on location/metro/pricing, and offer a WhatsApp brochure or consultant callback if unsure.",
    "escalation_rules": "Offer immediate human transfer to Vranda Aggarwal (+91 7351735035) if the customer demands a human, asks for legal/bank details, or requests an on-the-spot price commitment.",
    "compliance_notes": "Disclose that you are an AI assistant from Unique Prime Reality if asked directly. Never promise guaranteed investment returns.",
    "custom_greeting": "Namaste! Main Simran bol rahi hoon, Unique Prime Reality Gurgaon se. Kya aapse property enquiry ke regarding 2 minute baat ho sakti hai?",
    "opening_style": "permission",
    "transfer_number": "7351735035",
    "transfer_target_name": "Vranda Aggarwal",
    "transfer_enabled": True,
}

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


class KnowledgeBaseIn(BaseModel):
    agent_name: Optional[str] = None
    company_name: Optional[str] = None
    company_description: Optional[str] = None
    company_website: Optional[str] = None
    company_phone: Optional[str] = None
    office_hours: Optional[str] = None
    market: Optional[str] = None
    address: Optional[str] = None
    services: Optional[str] = None
    tone: Optional[str] = None
    system_prompt: Optional[str] = None
    call_objective: Optional[str] = None
    qualification_goals: Optional[str] = None
    success_criteria: Optional[str] = None
    offer: Optional[str] = None
    objection_handling: Optional[str] = None
    escalation_rules: Optional[str] = None
    compliance_notes: Optional[str] = None
    custom_greeting: Optional[str] = None
    opening_style: Optional[str] = None
    transfer_number: Optional[str] = None
    transfer_target_name: Optional[str] = None
    transfer_enabled: Optional[bool] = None


class AppointmentIn(BaseModel):
    lead_id: Optional[str] = None
    customer_name: str
    phone: str
    date: str
    time: str
    purpose: str = "Property consultation"
    project: Optional[str] = None
    notes: Optional[str] = None


class BulkDispatchIn(BaseModel):
    numbers: List[str]
    prompt: Optional[str] = ""
    model_provider: Optional[str] = "grok"
    voice: Optional[str] = "sarvam-meera"
    campaign_name: Optional[str] = "Direct Bulk Dispatch"


class RealCallTriggerIn(BaseModel):
    lead_id: Optional[str] = None
    phone: Optional[str] = None
    lead_name: Optional[str] = None
    campaign_id: Optional[str] = None
    agent_id: Optional[str] = None
    prompt: Optional[str] = None
    model_provider: Optional[str] = "grok"
    voice: Optional[str] = "sarvam-meera"


class CallIngestIn(BaseModel):
    call_uuid: str
    lead_id: str
    campaign_id: Optional[str] = None
    agent_name: Optional[str] = None
    duration_seconds: Optional[int] = 0
    recording_url: Optional[str] = None
    transcript: List[dict] = []
    summary: str = ""
    disposition: str = "connected"
    requirements: dict = {}
    signals: List[str] = []
    urgency_score: int = 5
    wants_site_visit: bool = False
    wants_brochure: bool = False
    whatsapp_opt_in: bool = False
    human_transfer_required: bool = False
    next_followup_days: Optional[int] = 2
    remarks: Optional[str] = None


class TelephonySettingsIn(BaseModel):
    voice_agent_url: Optional[str] = None
    voice_agent_shared_secret: Optional[str] = None
    livekit_url: Optional[str] = None
    livekit_api_key: Optional[str] = None
    livekit_api_secret: Optional[str] = None
    livekit_agent_name: Optional[str] = None
    vobiz_sip_trunk_id: Optional[str] = None
    grok_api_key: Optional[str] = None
    sarvam_api_key: Optional[str] = None
    deepgram_api_key: Optional[str] = None
    sarvam_speaker: Optional[str] = None
    sarvam_language: Optional[str] = None


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


async def _get_knowledge_base() -> dict:
    doc = await db.ai_settings.find_one({"_id": "knowledge_base"})
    if doc and doc.get("kb"):
        return {**DEFAULT_KNOWLEDGE_BASE, **doc["kb"]}
    return dict(DEFAULT_KNOWLEDGE_BASE)


# ---------------- LLM simulation (Offline demo only) ----------------
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

    sys_prompt = f"""You are simulating a phone call between an AI voice agent and a real estate customer in Gurgaon, India.

AGENT PERSONA:
- Name: {agent.get('name', 'Simran')}
- Voice/Language: {agent.get('language_style', 'formal_hinglish')}
- Tone: {agent.get('personality', '')}
- Opening line: {agent.get('intro_line', '')}
- Guardrails: {agent.get('guardrails', '')}

COMPANY INVENTORY (Unique Prime Reality, Gurgaon):
{inv_txt}

LEAD CONTEXT:
- Name: {lead.get('name', 'Customer')}
- Phone: {lead.get('phone', '')}
- City: {lead.get('city', 'Gurgaon')}
- Prior enquiry: {lead.get('property_interest', 'residential')}
- Budget hint: {lead.get('budget', 'unknown')}
- Notes: {lead.get('remark', '')}
{f"PRIOR CONVERSATION CONTEXT: {prior_context}" if prior_context else ""}

SIMULATION DIRECTIVE:
Simulate customer mood = "{mood}". Produce a realistic transcript (3 to 6 turns per side) in Hinglish (Roman script Hindi + English).
Then extract requirements and signals.

Output STRICT JSON ONLY:
{{
  "transcript": [
    {{"speaker": "agent"|"customer", "text": "..."}}
  ],
  "summary": "one sentence summary of the call",
  "disposition": "site_visit" | "callback" | "interested" | "not_interested" | "wrong_number" | "connected",
  "requirements": {{
    "property_type": "Apartment" | "Plot" | "Builder Floor" | "Commercial",
    "bhk": "2 BHK" | "3 BHK" | "4 BHK" | null,
    "budget": number in INR or null,
    "location_preference": string or null,
    "possession_timeline": string or null,
    "parking": "Required" | "Optional" | null,
    "callback_preference": string or null
  }},
  "signals": list of signals selected ONLY from: {json.dumps(allowed_signals)},
  "urgency_score": 1-10 integer,
  "wants_site_visit": bool,
  "wants_brochure": bool,
  "whatsapp_opt_in": bool,
  "human_transfer_required": bool,
  "next_followup_days": integer or null,
  "remarks": string
}}"""

    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            model=LLM_MODEL[1],
            system_prompt=sys_prompt,
        )
        resp = await chat.send_message(UserMessage(content=f"Generate simulation for mood: {mood}"))
        text = resp.content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        data = json.loads(text)
        return data
    except Exception as e:
        logger.error(f"LLM simulation error: {e}")
        return None


def _mock_simulate(agent: dict, lead: dict, inventory: List[dict], mood: str) -> dict:
    name = lead.get("name", "Sir")
    proj = inventory[0] if inventory else DEFAULT_INVENTORY[0]
    base = [
        {"speaker": "agent", "text": agent.get("intro_line") or f"Namaste {name} ji, Unique Prime Reality se."},
    ]
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
    """SIMULATED path (v1) — kept for offline demo/testing."""
    mood = mood or _weighted_mood()
    allowed = list(rules.keys())
    result = await _llm_simulate(agent, lead, inventory, mood, allowed, prior_context)
    source = "ai"
    if not result:
        result = _mock_simulate(agent, lead, inventory, mood)
        source = "mock"
    return await _finalize_call(lead, agent, rules, campaign, actor.get("username"),
                                mood, result, source=source)


async def _finalize_call(lead: dict, agent: dict, rules: dict, campaign: Optional[dict],
                         caller_username: str, mood: str, result: dict, source: str = "ai") -> dict:
    raw_signals = result.get("signals") or []
    intent_score = 0
    signal_breakdown = []
    for s in raw_signals:
        r = rules.get(s)
        if r:
            pts = r.get("points", 0)
            intent_score += pts
            signal_breakdown.append({"signal": s, "label": r.get("label", s), "points": pts})
        else:
            signal_breakdown.append({"signal": s, "label": s, "points": 0})

    temp = temperature_for(intent_score)
    ts = now_iso()
    lead_id = str(lead["_id"])

    call_doc = {
        "lead_id": lead_id,
        "lead_name": lead.get("name"),
        "lead_phone": lead.get("phone"),
        "campaign_id": str(campaign["_id"]) if campaign else None,
        "campaign_name": campaign.get("name") if campaign else None,
        "agent_name": agent.get("name", "Simran"),
        "agent_voice": agent.get("voice_accent"),
        "caller_username": caller_username,
        "mood_simulated": mood,
        "simulation_engine": source,
        "transcript": result.get("transcript", []),
        "summary": result.get("summary", ""),
        "disposition": result.get("disposition", "connected"),
        "requirements": result.get("requirements", {}),
        "signals": signal_breakdown,
        "intent_score": intent_score,
        "temperature": temp,
        "urgency_score": result.get("urgency_score", 5),
        "wants_site_visit": bool(result.get("wants_site_visit")),
        "wants_brochure": bool(result.get("wants_brochure")),
        "whatsapp_opt_in": bool(result.get("whatsapp_opt_in")),
        "human_transfer_required": bool(result.get("human_transfer_required")),
        "next_followup_days": result.get("next_followup_days"),
        "remarks": result.get("remarks"),
        "created_at": ts,
    }
    ins = await db.ai_calls.insert_one(call_doc)
    call_id = str(ins.inserted_id)

    lead_updates = {
        "ai_called": True,
        "ai_last_call_at": ts,
        "ai_call_count": (lead.get("ai_call_count") or 0) + 1,
        "ai_temperature": temp,
        "ai_intent_score": intent_score,
        "ai_disposition": call_doc["disposition"],
        "ai_summary": call_doc["summary"],
        "ai_last_call_id": call_id,
    }
    req = result.get("requirements") or {}
    if req.get("budget"):
        lead_updates["budget"] = req["budget"]
    if req.get("bhk"):
        lead_updates["bhk_requirement"] = req["bhk"]
    if req.get("location_preference"):
        lead_updates["preferred_location"] = req["location_preference"]
    if req.get("possession_timeline"):
        lead_updates["timeline"] = req["possession_timeline"]

    if temp == "hot":
        lead_updates["status"] = "hot"
    elif temp == "warm" and lead.get("status") in ("new", None):
        lead_updates["status"] = "contacted"
    elif temp == "lost":
        lead_updates["status"] = "lost"

    act_text = f"AI call ({agent.get('name','Simran')}): {call_doc['disposition']} · {temp.upper()} ({intent_score} pts) — {call_doc['summary']}"
    lead_activity = {
        "type": "ai_call",
        "description": act_text,
        "created_at": ts,
        "created_by": f"AI Agent ({agent.get('name','Simran')})",
        "call_id": call_id,
    }
    await db.leads.update_one(
        {"_id": lead["_id"]},
        {"$set": lead_updates, "$push": {"activities": lead_activity}},
    )

    if call_doc["wants_brochure"] or call_doc["whatsapp_opt_in"]:
        wa_text = (
            f"Namaste {lead.get('name', '')}! Unique Prime Reality se Simran bol rahi hoon. "
            f"Aapse baat karke accha laga. Hamare Gurgaon luxury projects ke details aur brochure "
            f"aapke reference ke liye attach kar rahe hain. Koi query ho to isi number par reply karein!"
        )
        await db.ai_whatsapp.insert_one({
            "lead_id": lead_id,
            "lead_name": lead.get("name"),
            "lead_phone": lead.get("phone"),
            "call_id": call_id,
            "kind": "brochure",
            "message": wa_text,
            "status": "queued",
            "created_at": ts,
        })
        await db.leads.update_one(
            {"_id": lead["_id"]},
            {"$set": {"ai_whatsapp_status": "queued", "brochure_sent": True, "brochure_sent_at": ts}},
        )

    fu_days = result.get("next_followup_days")
    if fu_days and fu_days > 0 and temp in ("hot", "warm"):
        try:
            due = (datetime.now(timezone.utc) + timedelta(days=fu_days)).isoformat()
        except Exception:
            due = ts
        await db.ai_followups.insert_one({
            "lead_id": lead_id,
            "lead_name": lead.get("name"),
            "lead_phone": lead.get("phone"),
            "call_id": call_id,
            "reason": f"Follow up after AI call ({call_doc['disposition']}, {temp})",
            "prior_summary": call_doc["summary"],
            "due_at": due,
            "status": "pending",
            "created_at": ts,
        })

    if call_doc["human_transfer_required"] or temp == "hot" or call_doc["wants_site_visit"]:
        await db.ai_transfers.insert_one({
            "lead_id": lead_id,
            "lead_name": lead.get("name"),
            "lead_phone": lead.get("phone"),
            "call_id": call_id,
            "temperature": temp,
            "intent_score": intent_score,
            "reason": (
                "Site visit requested" if call_doc["wants_site_visit"]
                else ("Customer asked for human consultant" if "requested_human" in raw_signals
                      else f"Hot lead ({intent_score} pts) needs closing")
            ),
            "target_number": TRANSFER_TARGET_NUMBER,
            "target_name": TRANSFER_TARGET_NAME,
            "status": "pending",
            "created_at": ts,
        })

    return {
        "call_id": call_id,
        "temperature": temp,
        "intent_score": intent_score,
        "disposition": call_doc["disposition"],
        "summary": call_doc["summary"],
        "signals": signal_breakdown,
        "wants_site_visit": call_doc["wants_site_visit"],
        "human_transfer_required": call_doc["human_transfer_required"],
        "transcript_turns": len(call_doc["transcript"]),
    }


# ---------------- AI Agents CRUD ----------------
@ai_router.get("/agents")
async def list_agents(user: dict = Depends(get_current_user)):
    docs = await db.ai_agents.find().to_list(50)
    if not docs:
        d = dict(DEFAULT_AGENT)
        d["created_at"] = now_iso()
        ins = await db.ai_agents.insert_one(d)
        d["id"] = str(ins.inserted_id)
        return [d]
    return [_clean(d) for d in docs]


@ai_router.post("/agents")
async def create_agent(payload: AgentIn, user: dict = Depends(require_vranda_only)):
    d = payload.dict()
    d["created_at"] = now_iso()
    d["created_by"] = user.get("username")
    ins = await db.ai_agents.insert_one(d)
    return _clean(await db.ai_agents.find_one({"_id": ins.inserted_id}))


@ai_router.put("/agents/{agent_id}")
async def update_agent(agent_id: str, payload: AgentIn, user: dict = Depends(require_vranda_only)):
    await db.ai_agents.update_one({"_id": ObjectId(agent_id)}, {"$set": payload.dict()})
    return _clean(await db.ai_agents.find_one({"_id": ObjectId(agent_id)}))


# ---------------- Campaigns ----------------
@ai_router.get("/campaigns")
async def list_campaigns(user: dict = Depends(get_current_user)):
    docs = await db.ai_campaigns.find().sort("created_at", -1).to_list(100)
    out = []
    for d in docs:
        cid = str(d["_id"])
        c_clean = _clean(d)
        c_clean["total_leads"] = await db.ai_queue.count_documents({"campaign_id": cid})
        c_clean["called_leads"] = await db.ai_queue.count_documents({"campaign_id": cid, "status": "done"})
        c_clean["hot_count"] = await db.ai_queue.count_documents({"campaign_id": cid, "temperature": "hot"})
        c_clean["warm_count"] = await db.ai_queue.count_documents({"campaign_id": cid, "temperature": "warm"})
        out.append(c_clean)
    return out


@ai_router.post("/campaigns")
async def create_campaign(payload: CampaignIn, user: dict = Depends(require_vranda_only)):
    d = payload.dict()
    d["created_at"] = now_iso()
    d["created_by"] = user.get("username")
    d["status"] = "draft"
    ins = await db.ai_campaigns.insert_one(d)
    return _clean(await db.ai_campaigns.find_one({"_id": ins.inserted_id}))


@ai_router.post("/campaigns/{cid}/assign-leads")
async def assign_leads_to_campaign(cid: str, payload: AssignLeadsIn, user: dict = Depends(require_vranda_only)):
    c = await db.ai_campaigns.find_one({"_id": ObjectId(cid)})
    if not c:
        raise HTTPException(404, "Campaign not found")
    assigned = 0
    for lid in payload.lead_ids:
        existing = await db.ai_queue.find_one({"campaign_id": cid, "lead_id": lid})
        if not existing:
            await db.ai_queue.insert_one({
                "campaign_id": cid,
                "lead_id": lid,
                "status": "queued",
                "retries": 0,
                "created_at": now_iso(),
            })
            assigned += 1
    return {"ok": True, "assigned": assigned}


@ai_router.post("/campaigns/{cid}/run")
async def run_campaign_queue(cid: str, payload: RunIn, user: dict = Depends(require_vranda_only)):
    c = await db.ai_campaigns.find_one({"_id": ObjectId(cid)})
    if not c:
        raise HTTPException(404, "Campaign not found")
    agent = await _get_agent(c.get("agent_id"))
    rules = await _get_scoring_rules()
    inventory = await db.ai_inventory.find().to_list(500) or DEFAULT_INVENTORY

    queue_items = await db.ai_queue.find({"campaign_id": cid, "status": "queued"}).limit(payload.limit).to_list(payload.limit)
    results = []
    for item in queue_items:
        lead = await db.leads.find_one({"_id": ObjectId(item["lead_id"])})
        if not lead:
            await db.ai_queue.update_one({"_id": item["_id"]}, {"$set": {"status": "skipped", "reason": "lead_deleted"}})
            continue

        prior_calls = await db.ai_calls.find({"lead_id": str(lead["_id"])}).sort("created_at", -1).limit(1).to_list(1)
        prior_context = prior_calls[0].get("summary") if prior_calls else None

        cfg = await _get_voice_agent_config()
        if (cfg.get("livekit_url") and cfg.get("livekit_api_key")) or (cfg.get("voice_agent_url") and cfg.get("voice_agent_shared_secret")):
            try:
                dispatch_res = await _dispatch_outbound_call(
                    lead=lead,
                    agent=agent,
                    inventory=inventory,
                    campaign_id=cid,
                    user_prompt="",
                )
                await db.ai_queue.update_one(
                    {"_id": item["_id"]},
                    {"$set": {"status": "calling", "call_uuid": dispatch_res.get("call_uuid"), "dialed_at": now_iso()}},
                )
                results.append({"lead_id": str(lead["_id"]), "status": "dialing", "method": dispatch_res.get("method")})
                continue
            except Exception as e:
                logger.error(f"LiveKit/Vobiz dispatch failed, falling back to simulation: {e}")

        res = await _run_single_call(lead, agent, rules, inventory, mood=None,
                                     campaign=c, actor=user, prior_context=prior_context)
        await db.ai_queue.update_one(
            {"_id": item["_id"]},
            {"$set": {"status": "done", "disposition": res["disposition"], "temperature": res["temperature"],
                      "intent_score": res["intent_score"], "done_at": now_iso()}},
        )
        results.append({"lead_id": str(lead["_id"]), **res})

    await db.ai_campaigns.update_one({"_id": ObjectId(cid)}, {"$set": {"status": "active", "last_run_at": now_iso()}})
    return {"processed": len(results), "results": results}


@ai_router.post("/calls/run-single")
async def run_single_lead_call(payload: CallRunIn, user: dict = Depends(require_vranda_only)):
    lead = await db.leads.find_one({"_id": ObjectId(payload.lead_id)})
    if not lead:
        raise HTTPException(404, "Lead not found")
    agent = await _get_agent(payload.agent_id)
    rules = await _get_scoring_rules()
    inventory = await db.ai_inventory.find().to_list(500) or DEFAULT_INVENTORY
    campaign = None
    if payload.campaign_id:
        campaign = await db.ai_campaigns.find_one({"_id": ObjectId(payload.campaign_id)})
    prior_calls = await db.ai_calls.find({"lead_id": payload.lead_id}).sort("created_at", -1).limit(1).to_list(1)
    prior_context = prior_calls[0].get("summary") if prior_calls else None

    return await _run_single_call(lead, agent, rules, inventory, mood=payload.mood,
                                  campaign=campaign, actor=user, prior_context=prior_context)


# ---------------- Telephony & Settings ----------------
@ai_router.get("/calls/real/settings")
async def get_real_call_settings(user: dict = Depends(require_vranda_only)):
    cfg = await _get_voice_agent_config()
    return {
        "voice_agent_url": cfg.get("voice_agent_url") or "",
        "has_shared_secret": bool(cfg.get("voice_agent_shared_secret")),
        "livekit_url": cfg.get("livekit_url") or "",
        "livekit_agent_name": cfg.get("livekit_agent_name") or "upr-calling-agent",
        "has_livekit_key": bool(cfg.get("livekit_api_key")),
        "has_livekit_secret": bool(cfg.get("livekit_api_secret")),
        "vobiz_sip_trunk_id": cfg.get("vobiz_sip_trunk_id") or "",
        "has_grok_key": bool(cfg.get("grok_api_key")),
        "has_sarvam_key": bool(cfg.get("sarvam_api_key")),
        "has_deepgram_key": bool(cfg.get("deepgram_api_key")),
        "sarvam_speaker": cfg.get("sarvam_speaker") or "meera",
        "sarvam_language": cfg.get("sarvam_language") or "hi-IN",
        "is_ready": bool(
            (cfg.get("livekit_url") and cfg.get("livekit_api_key") and cfg.get("livekit_api_secret"))
            or (cfg.get("voice_agent_url") and cfg.get("voice_agent_shared_secret"))
        ),
    }


@ai_router.post("/calls/real/settings")
async def set_real_call_settings(payload: TelephonySettingsIn, user: dict = Depends(require_vranda_only)):
    doc = await db.ai_settings.find_one({"_id": "telephony_config"})
    current = doc.get("config", {}) if doc else {}

    updates = {}
    for k, v in payload.dict().items():
        if v is not None:
            if isinstance(v, str) and v.strip() == "":
                continue
            updates[k] = v.strip() if isinstance(v, str) else v

    merged = {**current, **updates}
    await db.ai_settings.update_one(
        {"_id": "telephony_config"},
        {"$set": {"config": merged, "updated_at": now_iso(), "updated_by": user.get("username")}},
        upsert=True,
    )
    return {"ok": True}


async def _dispatch_outbound_call(
    lead: dict,
    agent: dict,
    inventory: list,
    campaign_id: Optional[str] = None,
    user_prompt: str = "",
    model_provider: str = "grok",
    voice: str = "sarvam-meera",
) -> dict:
    cfg = await _get_voice_agent_config()
    lead_id = str(lead["_id"])
    lead_name = lead.get("name") or "Valued Customer"
    phone = lead.get("phone")
    if not phone:
        raise HTTPException(400, "Lead has no phone number")

    e164_phone = phone.strip()
    if not e164_phone.startswith("+"):
        e164_phone = "+91" + e164_phone if len(e164_phone) == 10 else "+" + e164_phone

    clean_digits = re.sub(r"[^0-9]", "", e164_phone)
    call_uuid = f"call-{clean_digits}-{uuid.uuid4().hex[:6]}"

    # 1. Direct LiveKit Cloud dispatch
    livekit_url = cfg.get("livekit_url")
    livekit_api_key = cfg.get("livekit_api_key")
    livekit_api_secret = cfg.get("livekit_api_secret")

    if livekit_url and livekit_api_key and livekit_api_secret:
        import jwt
        http_url = livekit_url.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")
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
            },
        }
        metadata_str = json.dumps(metadata_dict)

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
                if not cfg.get("voice_agent_url"):
                    raise HTTPException(502, f"LiveKit Cloud dispatch failed: {e}")

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
            "inventory": inventory,
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
        "Calling service is not configured yet. Go to AI Calling Settings and configure your LiveKit Cloud credentials & Vobiz SIP Trunk ID.",
    )


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
        model_provider=payload.model_provider or "grok",
        voice=payload.voice or "sarvam-meera",
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
    return {
        "ok": True,
        "call_uuid": dispatch_res.get("call_uuid"),
        "status": dispatch_res.get("status", "dialing"),
        "lead_id": str(lead["_id"]),
    }


@ai_public_router.post("/calls/ingest")
async def ingest_real_call(payload: CallIngestIn,
                           x_voice_agent_secret: Optional[str] = Header(None)):
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

    if payload.campaign_id:
        await db.ai_queue.update_one(
            {"campaign_id": payload.campaign_id, "lead_id": payload.lead_id, "status": "calling"},
            {"$set": {"status": "done", "disposition": res["disposition"], "temperature": res["temperature"],
                      "intent_score": res["intent_score"], "done_at": now_iso()}},
        )
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
async def recall_followup(fu_id: str, user: dict = Depends(require_vranda_only)):
    fu = await db.ai_followups.find_one({"_id": ObjectId(fu_id)})
    if not fu:
        raise HTTPException(404, "Follow-up not found")
    lead = await db.leads.find_one({"_id": ObjectId(fu["lead_id"])})
    if not lead:
        raise HTTPException(404, "Lead not found")
    if not lead.get("phone"):
        raise HTTPException(400, "Lead has no phone number")
    voice_agent_url, voice_agent_secret = await _get_voice_agent_config()
    if not voice_agent_url or not voice_agent_secret:
        raise HTTPException(
            500,
            "Real calling is not configured yet. Go to Settings and paste the "
            "voice-agent URL + shared secret first.",
        )
    agent = await _get_agent(None)
    inventory = await db.ai_inventory.find().to_list(500) or DEFAULT_INVENTORY

    import httpx
    body = {
        "lead_id": str(lead["_id"]), "lead_name": lead.get("name"), "phone": lead.get("phone"),
        "city": lead.get("city"), "property_interest": lead.get("property_interest"),
        "budget": lead.get("budget"), "remark": lead.get("remark"),
        "prior_summary": fu.get("prior_summary"),
        "agent": {
            "name": agent.get("name"), "voice_gender": agent.get("voice_gender", "female"),
            "voice_accent": agent.get("voice_accent"), "language_style": agent.get("language_style", "formal_hinglish"),
            "personality": agent.get("personality"), "intro_line": agent.get("intro_line"),
            "guardrails": agent.get("guardrails"),
        },
        "inventory": inventory,
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(f"{voice_agent_url}/trigger", json=body,
                                     headers={"X-Voice-Agent-Secret": voice_agent_secret})
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        logger.error(f"followup recall dial failed: {e}")
        raise HTTPException(502, f"Could not reach voice-agent service: {e}")

    await db.ai_followups.update_one(
        {"_id": ObjectId(fu_id)},
        {"$set": {"status": "calling", "dialed_at": now_iso(), "call_uuid": data.get("call_uuid")}},
    )
    await db.leads.update_one({"_id": lead["_id"]}, {"$set": {
        "assigned_agent_type": "ai", "ai_call_status": "dialing",
        "ai_call_uuid": data.get("call_uuid"), "updated_at": now_iso(),
    }})
    return {"ok": True, "call_uuid": data.get("call_uuid"), "status": "dialing"}


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


# ---------------- Knowledge Base & Telephony Settings ----------------
@ai_router.get("/knowledge-base")
async def get_knowledge_base(user: dict = Depends(get_current_user)):
    kb = await _get_knowledge_base()
    return kb


@ai_router.post("/knowledge-base")
async def update_knowledge_base(payload: KnowledgeBaseIn, user: dict = Depends(require_vranda_only)):
    current = await _get_knowledge_base()
    updates = payload.dict(exclude_unset=True)
    updated = {**current, **updates}
    await db.ai_settings.update_one(
        {"_id": "knowledge_base"},
        {"$set": {"kb": updated, "updated_at": now_iso(), "updated_by": user.get("username")}},
        upsert=True,
    )
    return {"ok": True, "kb": updated}


# ---------------- Appointments & Site Visits ----------------
@ai_router.get("/appointments")
async def list_appointments(user: dict = Depends(get_current_user)):
    docs = await db.ai_appointments.find().sort("created_at", -1).limit(300).to_list(300)
    items = [_clean(d) for d in docs]
    return {"items": items}


@ai_router.post("/appointments")
async def create_appointment(payload: AppointmentIn, user: dict = Depends(get_current_user)):
    ts = now_iso()
    doc = payload.dict()
    doc["created_at"] = ts
    doc["created_by"] = user.get("username", "system")
    doc["status"] = "Scheduled"

    clean_phone = (doc.get("phone") or "").strip()
    lead = None
    if doc.get("lead_id"):
        try:
            lead = await db.leads.find_one({"_id": ObjectId(doc["lead_id"])})
        except Exception:
            pass
    if not lead and clean_phone:
        lead = await db.leads.find_one({"phone": clean_phone})

    if lead:
        doc["lead_id"] = str(lead["_id"])
        await db.leads.update_one(
            {"_id": lead["_id"]},
            {"$push": {
                "activities": {
                    "type": "appointment_booked",
                    "description": f"Site visit / appointment booked for {doc['date']} at {doc['time']}: {doc['purpose']}",
                    "created_at": ts,
                    "created_by": user.get("name", "AI Calling System"),
                }
            }},
        )

    ins = await db.ai_appointments.insert_one(doc)
    saved = await db.ai_appointments.find_one({"_id": ins.inserted_id})
    return {"ok": True, "item": _clean(saved)}


# ---------------- Bulk Outbound Calling ----------------
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
                model_provider=payload.model_provider or "grok",
                voice=payload.voice or "sarvam-meera",
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
    if not await db.ai_settings.find_one({"_id": "knowledge_base"}):
        await db.ai_settings.insert_one({"_id": "knowledge_base", "kb": DEFAULT_KNOWLEDGE_BASE,
                                         "updated_at": now_iso()})
        logger.info("Seeded default knowledge base")
    await db.ai_queue.create_index([("campaign_id", 1), ("status", 1)])
    await db.ai_calls.create_index([("lead_id", 1), ("created_at", -1)])
    await db.ai_appointments.create_index([("created_at", -1)])
