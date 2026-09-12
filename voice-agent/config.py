"""
Configuration and Prompt Engine for Unique Prime Reality AI Voice Agent
Loads LiveKit, Vobiz SIP, Deepgram, Grok, and Sarvam settings from environment.
"""

import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

# ─── LiveKit Cloud ───
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "").strip()
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "").strip()
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "").strip()
LIVEKIT_AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "upr-calling-agent").strip()

# ─── Telephony (Vobiz SIP Trunk) ───
VOBIZ_SIP_TRUNK_ID = (
    os.getenv("VOBIZ_SIP_TRUNK_ID")
    or os.getenv("OUTBOUND_SIP_TRUNK_ID")
    or ""
).strip()

# ─── AI Models ───
# STT: Deepgram
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "").strip()
DEEPGRAM_STT_MODEL = os.getenv("DEEPGRAM_STT_MODEL", "nova-3")
DEEPGRAM_STT_LANGUAGE = os.getenv("DEEPGRAM_STT_LANGUAGE", "hi-Latn")

# LLM: Grok (xAI) with Groq / OpenAI fallback
GROK_API_KEY = os.getenv("GROK_API_KEY", "").strip()
GROK_MODEL = os.getenv("GROK_MODEL", "grok-2-public")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# TTS: Sarvam AI Indian Voice
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "").strip()
SARVAM_SPEAKER = os.getenv("SARVAM_SPEAKER", "meera")
SARVAM_LANGUAGE_CODE = os.getenv("SARVAM_LANGUAGE_CODE", "hi-IN")
DEEPGRAM_TTS_MODEL = os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-andromeda-en")

# ─── CRM Backend Integration ───
CRM_BACKEND_URL = os.getenv("CRM_BACKEND_URL", "http://localhost:8000").rstrip("/")
VOICE_AGENT_SHARED_SECRET = os.getenv("VOICE_AGENT_SHARED_SECRET", "").strip()

# ─── Default Identity ───
AGENT_NAME = os.getenv("AGENT_NAME", "Simran")
COMPANY_NAME = "Unique Prime Reality"
DEFAULT_TRANSFER_NUMBER = os.getenv("DEFAULT_TRANSFER_NUMBER", "7351735035")
DEFAULT_TRANSFER_NAME = os.getenv("DEFAULT_TRANSFER_NAME", "Vranda Aggarwal")

BASE_AGENT_CONTEXT = f"""You are {AGENT_NAME}, an expert, polite, and warm senior property advisor at {COMPANY_NAME}, a premier real estate firm in Gurgaon, India.

<voice_and_tone>
- Speak in natural, friendly conversational Hinglish (blend of Hindi and polite English) or fluent English depending on how the customer responds.
- Keep responses short, concise, and engaging — phone calls require brevity (1-2 sentences maximum per turn).
- Be extremely respectful ("Aap", "Sir/Ma'am", "Ji", "Bilkul").
- Listen carefully and never talk over the customer.
</voice_and_tone>
"""

def build_runtime_system_prompt(call_type: str, agent_config: dict = None, user_prompt: str = "") -> str:
    """Compose per-call instructions from dashboard config and customer context."""
    agent_config = agent_config or {}
    name = agent_config.get("agentName") or AGENT_NAME
    company = agent_config.get("companyName") or COMPANY_NAME
    custom_instructions = agent_config.get("systemPrompt") or ""
    objective = agent_config.get("callObjective") or "Qualify buyer requirement and schedule site visit or WhatsApp follow-up."
    company_desc = agent_config.get("companyDescription") or ""
    market = agent_config.get("market") or "Gurgaon, Haryana"
    services = agent_config.get("services") or ""
    tone = agent_config.get("tone") or "Warm, polite, concise, and helpful Hinglish."
    qualification_goals = agent_config.get("qualificationGoals") or ""
    offer = agent_config.get("offer") or ""
    objections = agent_config.get("objectionHandling") or ""
    escalation = agent_config.get("escalationRules") or ""
    compliance = agent_config.get("complianceNotes") or ""
    
    lead_name = agent_config.get("leadName") or ""
    lead_context = f"\n<lead_info>\nCustomer Name: {lead_name}\nContext: {user_prompt}\n</lead_info>" if (lead_name or user_prompt) else ""

    sections = [
        BASE_AGENT_CONTEXT,
        f"<call_type>{call_type.upper()}</call_type>",
        f"<call_objective>{objective}</call_objective>",
    ]
    if company_desc or services or market:
        sections.append(f"<business_knowledge>\nCompany: {company}\nMarket: {market}\nDescription: {company_desc}\nServices: {services}\n</business_knowledge>")
    if tone:
        sections.append(f"<voice_and_tone>{tone}</voice_and_tone>")
    if qualification_goals:
        sections.append(f"<qualification_goals>{qualification_goals}</qualification_goals>")
    if offer:
        sections.append(f"<special_offer>{offer}</special_offer>")
    if objections:
        sections.append(f"<objection_handling>{objections}</objection_handling>")
    if escalation:
        sections.append(f"<escalation_rules>{escalation}</escalation_rules>")
    if compliance:
        sections.append(f"<compliance_notes>{compliance}</compliance_notes>")
    if lead_context:
        sections.append(lead_context)
    if custom_instructions:
        sections.append(f"<specific_instructions>\n{custom_instructions}\n</specific_instructions>")

    return "\n\n".join(sections)

def build_outbound_greeting(reason: str = "enquiry", agent_config: dict = None) -> str:
    agent_config = agent_config or {}
    name = agent_config.get("agentName") or AGENT_NAME
    lead_name = agent_config.get("leadName", "").strip()
    company = agent_config.get("companyName") or COMPANY_NAME
    custom_greeting = agent_config.get("customGreeting", "").strip()
    opening_style = agent_config.get("openingStyle", "permission")
    
    if custom_greeting:
        return (
            custom_greeting.replace("{agentName}", name)
            .replace("{companyName}", company)
            .replace("{leadName}", lead_name or "sir")
        )

    greeting_prefix = f"Namaste {lead_name} ji!" if lead_name else "Namaste!"
    if opening_style == "direct":
        return f"{greeting_prefix} Main {name} bol rahi hoon {company} Gurgaon se hamare exclusive luxury residential projects ke regarding."
    elif opening_style == "warm":
        return f"{greeting_prefix} Main {name} from {company}. Aapse baat karke bahut khushi hui. Kya aapse property requirements ke regarding 2 minute baat ho sakti hai?"

    return (
        f"{greeting_prefix} Main {name} bol rahi hoon from {company}, Gurgaon. "
        f"Aapne property ke regarding enquire kiya tha, kya aapse 2 minute baat ho sakti hai?"
    )
