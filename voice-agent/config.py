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
DEFAULT_TRANSFER_NAME = os.getenv("DEFAULT_TRANSFER_NAME", "Vrinda Aggarwal").strip()
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
SARVAM_SPEAKER = os.getenv("SARVAM_SPEAKER", "meera").strip()  # meera, bulbul, amit
SARVAM_LANGUAGE_CODE = os.getenv("SARVAM_LANGUAGE_CODE", "hi-IN").strip()  # hi-IN, en-IN

DEEPGRAM_TTS_MODEL = os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-thalia-en").strip()

# ─── CRM Backend Integration ───
CRM_BACKEND_URL = os.getenv("CRM_BACKEND_URL", "http://localhost:8001").rstrip("/")
VOICE_AGENT_SHARED_SECRET = os.getenv("VOICE_AGENT_SHARED_SECRET", "upr-secret-token-change-in-prod").strip()

# ─── Agent Persona & Default Prompts ───
AGENT_NAME = "Vrinda"
COMPANY_NAME = "Unique Prime Reality"
MARKET = "Gurgaon, Haryana, India (Dwarka Expressway, Golf Course Ext, Manesar Corridor, Sohna Road)"

DEFAULT_INVENTORY = [
    {
        "project": "Dwarka Expressway Luxury Residences",
        "location": "Dwarka Expressway, Gurgaon",
        "config": "2/3/4 BHK Luxury & Penthouses",
        "price_range": "₹1.4 Cr – ₹3.5 Cr",
        "possession": "2026 - 2027",
        "highlights": "Best opportunistic growth corridor, 15 mins to IGI Airport, upcoming metro",
    },
    {
        "project": "Manesar Corridor Greens",
        "location": "Manesar Corridor / NH-48, Gurgaon",
        "config": "2/3 BHK",
        "price_range": "₹85 L – ₹1.8 Cr",
        "possession": "Dec 2026",
        "highlights": "Industrial & IT hub connectivity, high rental yield",
    },
    {
        "project": "Golf Course Ext Skyline",
        "location": "Golf Course Extension Road, Gurgaon",
        "config": "3/4 BHK Luxury",
        "price_range": "₹2.5 Cr – ₹4.5 Cr",
        "possession": "Ready to move",
        "highlights": "Ultra-luxury gated community, reputed builders, Aravali views",
    },
]

def build_runtime_system_prompt(call_type: str, agent_config: dict = None, user_prompt: str = "") -> str:
    """Compose per-call instructions from dashboard config and customer context."""
    agent_config = agent_config or {}
    name = agent_config.get("agent_name") or agent_config.get("agentName") or AGENT_NAME
    company = agent_config.get("company_name") or agent_config.get("companyName") or COMPANY_NAME
    market = agent_config.get("market") or MARKET
    lead_name = agent_config.get("lead_name") or agent_config.get("leadName") or ""
    
    greeting = agent_config.get("custom_greeting") or f"Hello {lead_name or 'sir'} ji, I'm {name} calling from {company}, Gurgaon se. {lead_name or ''} ji kya aap Gurgaon mein koi property plan kar rahe hain?"
    gate_no_response = agent_config.get("gate_no_response") or "Thank you for your time, have a nice day!"
    purpose_question = agent_config.get("purpose_question") or "Sir aapki requirement ko better understand karne ke liye kya main jaan sakti hu yeh property purchase personal use ke liye hai ya investment purpose ke liye hai?"
    budget_config_question = agent_config.get("budget_config_question") or "Perfect, and aap kitne budget main and konsi configuration main yeh property plan kar rahe hain like studio apartment, 1 BHK, 2 BHK, 3 BHK, 4 BHK, or penthouse?"
    best_now_answer = agent_config.get("best_now_answer") or "We have different projects and every project has its own USP. Agar aap meri advice consider karein, toh best opportunistic location is Dwarka Expressway right now."
    location_question = agent_config.get("location_question") or "Is there any specific preferred location in mind?"
    builders_options = agent_config.get("builders_options") or "We have almost every reputed builder's projects like from Godrej, ATS, Whiteland / Wal Developer, Hero Homes, M3M, Elan, Emaar, and many others."
    ai_disclosure_answer = agent_config.get("ai_disclosure_answer") or "Yes, I am an AI assistant and I am noting your requirement and will share it with my team, and they will find you with the best property at the earliest."
    transfer_number = agent_config.get("transfer_number") or DEFAULT_TRANSFER_NUMBER
    transfer_name = agent_config.get("transfer_target_name") or DEFAULT_TRANSFER_NAME
    transfer_phrase = agent_config.get("transfer_phrase") or f"Sure, let me connect you directly to our senior consultant {transfer_name} right away. Please stay on the line."

    prompt = f"""\
<role>
You are {name}, an expert, polite, and articulate tele-calling consultant for {company}, a premier real estate firm in Gurgaon.
You speak warm, fluent Hinglish (conversational mix of Hindi and English) or English depending on how the customer speaks to you.
Speak concisely: 1 to 2 short sentences per turn. Never give long monologues. Always ask only ONE question at a time.
Rule: Always acknowledge each customer response with "Noted sir/ma'am", "Noted ji", or "Perfect" before asking the next question.
</role>

<customer_context>
Customer Name: {lead_name or 'Sir/Maam'}
Context: {user_prompt or 'Outbound residential property qualification call'}
Market: {market}
</customer_context>

<conversation_flow>
1. OPENING HOOK (Initial greeting already spoken to customer):
   "{greeting.replace('{name}', lead_name or 'Sir')}"

   - IF CUSTOMER SAYS NO / NOT INTERESTED / NOT LOOKING:
     Immediately reply: "{gate_no_response}"
     Then stop talking completely and gracefully end the call. Do not try to push or convince them.

   - IF CUSTOMER SAYS YES / PLANNING / LOOKING FOR PROPERTY:
     Proceed to Step 2.

2. QUALIFICATION - PURPOSE (Personal Use vs Investment):
   Ask: "{purpose_question}"

3. QUALIFICATION - BUDGET & CONFIGURATION:
   Once the customer replies (personal use or investment):
   Acknowledge: "Noted sir/ma'am."
   Then ask: "{budget_config_question}"

   - IF CUSTOMER ASKS "Best kya hai abhi?" OR ASKS FOR ADVICE:
     Reply: "{best_now_answer}"
     Then ask immediately: "{location_question}"

4. QUALIFICATION - PREFERRED LOCATION & BUILDERS:
   Ask: "{location_question}"

   - IF CUSTOMER ASKS FOR OPTIONS, BUILDERS, OR PROJECTS:
     Reply: "{builders_options}"

5. NOTING & FINAL CONFIRMATION:
   - Throughout the call, ensure you say "Noted" to every response.
   - At the end of the call, repeat back what you have gathered to confirm:
     Example: "Noted! I have noted that you are looking for a residential [Config e.g. 2 BHK] property in [Location e.g. Manesar Corridor] under [Budget e.g. 3 Cr]."
   - Conclude warmly:
     "I am noting your requirement and will share it with my team, and they will find you with the best property at the earliest. Thank you so much for your time, have a nice day!"

6. SPECIAL SCENARIOS:
   - IF CUSTOMER ASKS "Are you an AI agent? / Kya aap AI ho? / Robot ho?":
     Reply exactly: "{ai_disclosure_answer}"
   - IF CUSTOMER ASKS "Transfer my call to a human / Connect me to your team / Manager se baat karao":
     Reply: "{transfer_phrase}"
</conversation_flow>
"""
    return prompt


def build_outbound_greeting(reason: str = "enquiry", agent_config: dict = None) -> str:
    """Generate the first words spoken when the customer answers the phone."""
    agent_config = agent_config or {}
    name = agent_config.get("agent_name") or agent_config.get("agentName") or AGENT_NAME
    company = agent_config.get("company_name") or agent_config.get("companyName") or COMPANY_NAME
    lead_name = (agent_config.get("lead_name") or agent_config.get("leadName") or "").strip()
    custom_greeting = (agent_config.get("custom_greeting") or agent_config.get("customGreeting") or "").strip()

    name_label = f"{lead_name} ji" if lead_name else "ji"

    if custom_greeting:
        return (
            custom_greeting.replace("{name}", lead_name or "Sir")
            .replace("{leadName}", lead_name or "Sir")
            .replace("{agentName}", name)
            .replace("{companyName}", company)
        )

    return f"Hello {name_label}, I'm {name} calling from {company}, Gurgaon se. {name_label} kya aap Gurgaon mein koi property plan kar rahe hain?"
