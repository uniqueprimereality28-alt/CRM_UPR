import os
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

# ─── LiveKit & Telephony ───
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "").strip()
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "").strip()
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "").strip()
LIVEKIT_AGENT_NAME = os.getenv("LIVEKIT_AGENT_NAME", "upr-calling-agent").strip()

VOBIZ_SIP_TRUNK_ID = os.getenv("VOBIZ_SIP_TRUNK_ID") or os.getenv("OUTBOUND_SIP_TRUNK_ID", "").strip()
DEFAULT_TRANSFER_NUMBER = os.getenv("DEFAULT_TRANSFER_NUMBER", "+917351735035").strip()
DEFAULT_TRANSFER_NAME = os.getenv("DEFAULT_TRANSFER_NAME", "Vranda Aggarwal").strip()
MAX_CALL_DURATION_SECONDS = int(os.getenv("MAX_CALL_DURATION_SECONDS", "600"))

# ─── AI Providers ───
# STT: Deepgram
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "").strip()
DEEPGRAM_STT_MODEL = os.getenv("DEEPGRAM_STT_MODEL", "nova-3").strip()
DEEPGRAM_STT_LANGUAGE = os.getenv("DEEPGRAM_STT_LANGUAGE", "hi").strip()  # "hi", "en-IN", "en", "multi"

# LLM: Grok (xAI) or Groq / OpenAI fallback
GROK_API_KEY = os.getenv("GROK_API_KEY") or os.getenv("XAI_API_KEY", "").strip()
GROK_MODEL = os.getenv("GROK_MODEL", "grok-2-latest").strip()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile").strip()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()

# TTS: Sarvam AI (Indian voices) or Deepgram Aura fallback
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "").strip()
SARVAM_SPEAKER = os.getenv("SARVAM_SPEAKER", "meera").strip()  # meera, pavithra, maitri, arvind, amartya
SARVAM_LANGUAGE_CODE = os.getenv("SARVAM_LANGUAGE_CODE", "hi-IN").strip()  # hi-IN, en-IN

DEEPGRAM_TTS_MODEL = os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-thalia-en").strip()

# ─── CRM Backend Integration ───
CRM_BACKEND_URL = os.getenv("CRM_BACKEND_URL", "http://localhost:8001").rstrip("/")
VOICE_AGENT_SHARED_SECRET = os.getenv("VOICE_AGENT_SHARED_SECRET", "upr-secret-token-change-in-prod").strip()

# ─── Agent Persona & Default Prompts ───
AGENT_NAME = "Simran"
COMPANY_NAME = "Unique Prime Reality"
MARKET = "Gurgaon, Haryana, India"

DEFAULT_INVENTORY = [
    {
        "project": "Prime Elmwood Residences",
        "location": "Sector 79, Gurgaon",
        "config": "2/3 BHK",
        "price_range": "₹1.2 Cr – ₹1.9 Cr",
        "possession": "Dec 2026",
        "highlights": "IGI Airport 25 mins, upcoming metro extension, modern clubhouse",
    },
    {
        "project": "Prime Skyline Towers",
        "location": "Golf Course Extension Road, Gurgaon",
        "config": "3/4 BHK Luxury",
        "price_range": "₹2.4 Cr – ₹3.8 Cr",
        "possession": "Ready to move",
        "highlights": "Ultra-luxury gated community, panoramic Aravali views",
    },
    {
        "project": "Prime Green Vista",
        "location": "Sohna Road, Gurgaon",
        "config": "2/3 BHK",
        "price_range": "₹95 L – ₹1.6 Cr",
        "possession": "Jun 2027",
        "highlights": "Investor favourite, expected high rental yield, close to cloverleaf",
    },
]

BASE_AGENT_CONTEXT = f"""\
<role>
You are {AGENT_NAME}, an expert, courteous, and polite tele-calling consultant for {COMPANY_NAME}, a premier real estate firm in Gurgaon.
You speak warm, natural Hinglish (conversational mix of Hindi and English) or English depending on how the customer speaks to you.
Speak concisely: 1 to 2 short sentences per response. Never give long lectures. Always ask only ONE question at a time.
Disclose that you are an AI calling assistant from {COMPANY_NAME} if asked directly.
</role>

<business>
Company: {COMPANY_NAME}
Location: Gurgaon, Haryana
Key Projects:
- Prime Elmwood Residences (Sector 79, Gurgaon | 2/3 BHK | ₹1.2 Cr – ₹1.9 Cr | Possession Dec 2026)
- Prime Skyline Towers (Golf Course Ext Road | 3/4 BHK | ₹2.4 Cr – ₹3.8 Cr | Ready to move)
- Prime Green Vista (Sohna Road | 2/3 BHK | ₹95 L – ₹1.6 Cr | Possession Jun 2027)
Never invent unverified discounts, legal approvals, or false promises.
</business>

<conversation_rules>
1. Greet the customer warmly and confirm if it's a good time to speak.
2. Ask about their requirement: BHK configuration (2/3/4 BHK), budget range, preferred location in Gurgaon, and timeline to buy.
3. If they are interested, offer to send project brochures/details on WhatsApp or schedule a site visit this weekend.
4. If they ask for a human representative, want legal/loan guidance, or have complex queries, offer to connect them to senior consultant {DEFAULT_TRANSFER_NAME}.
5. If they say not interested or wrong number, apologize politely and end the call gracefully.
6. Keep speech natural, respectful, and engaging with Indian conversational markers ("Ji", "Sure sir/ma'am", "Bilkul").
</conversation_rules>
"""

def build_runtime_system_prompt(call_type: str, agent_config: dict = None, user_prompt: str = "") -> str:
    """Compose per-call instructions from dashboard config and customer context."""
    agent_config = agent_config or {}
    name = agent_config.get("agentName") or AGENT_NAME
    company = agent_config.get("companyName") or COMPANY_NAME
    custom_instructions = agent_config.get("systemPrompt") or ""
    objective = agent_config.get("callObjective") or "Qualify buyer requirement and schedule site visit or WhatsApp follow-up."
    
    lead_name = agent_config.get("leadName") or ""
    lead_context = f"\n<lead_info>\nCustomer Name: {lead_name}\nContext: {user_prompt}\n</lead_info>" if (lead_name or user_prompt) else ""

    prompt = f"""{BASE_AGENT_CONTEXT}
<call_type>{call_type.upper()}</call_type>
<call_objective>{objective}</call_objective>
{lead_context}
"""
    if custom_instructions:
        prompt += f"\n<specific_instructions>\n{custom_instructions}\n</specific_instructions>\n"

    return prompt

def build_outbound_greeting(reason: str = "enquiry", agent_config: dict = None) -> str:
    agent_config = agent_config or {}
    name = agent_config.get("agentName") or AGENT_NAME
    lead_name = agent_config.get("leadName", "").strip()
    company = agent_config.get("companyName") or COMPANY_NAME
    
    greeting_prefix = f"Namaste {lead_name} ji!" if lead_name else "Namaste!"
    return (
        f"{greeting_prefix} Main {name} bol rahi hoon from {company}, Gurgaon. "
        f"Aapne property ke regarding enquire kiya tha, kya aapse 2 minute baat ho sakti hai?"
    )
