import os
try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    pass

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
# STT: Deepgram Nova-3 (Hindi/Hinglish)
DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "").strip()
DEEPGRAM_STT_MODEL = os.getenv("DEEPGRAM_STT_MODEL", "nova-3").strip()
DEEPGRAM_STT_LANGUAGE = os.getenv("DEEPGRAM_STT_LANGUAGE", "hi").strip()

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
SARVAM_LANGUAGE_CODE = os.getenv("SARVAM_LANGUAGE_CODE", "hi-IN").strip()

DEEPGRAM_TTS_MODEL = os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-thalia-en").strip()

# ─── CRM Backend Integration ───
CRM_BACKEND_URL = os.getenv("CRM_BACKEND_URL", "http://localhost:8001").rstrip("/")
VOICE_AGENT_SHARED_SECRET = os.getenv("VOICE_AGENT_SHARED_SECRET", "upr-secret-token-change-in-prod").strip()

# ─── Agent Persona & Default Prompts ───
AGENT_NAME = "Vrinda"
COMPANY_NAME = "Unique Prime Reality"
MARKET = "Gurgaon, Haryana, India (Dwarka Expressway, Golf Course Ext, Manesar Corridor, Sohna Road)"
OFFICE_LOCATION = "Dwarka Expressway, walking distance to Conscient One mall, Gurgaon, Haryana"

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
    """Compose per-call instructions from CRM Knowledge Base and customer context."""
    agent_config = agent_config or {}
    name = agent_config.get("agent_name") or agent_config.get("agentName") or AGENT_NAME
    company = agent_config.get("company_name") or agent_config.get("companyName") or COMPANY_NAME
    market = agent_config.get("market") or MARKET
    lead_name = (agent_config.get("lead_name") or agent_config.get("leadName") or "").strip()
    if lead_name.startswith("Lead ") or lead_name in ["Valued Customer", "Unknown"]:
        lead_name = ""

    greeting = build_outbound_greeting(reason=user_prompt or "enquiry", agent_config=agent_config)
    gate_no_response = agent_config.get("gate_no_response") or "Thank you for your time, have a nice day!"
    purpose_question = agent_config.get("purpose_question") or "Sir aapki requirement ko better understand karne ke liye kya main jaan sakti hu yeh property purchase personal use ke liye hai ya investment purpose ke liye hai?"
    budget_config_question = agent_config.get("budget_config_question") or "Perfect, and aap kitne budget main and konsi configuration main yeh property plan kar rahe hain like studio apartment, 1 BHK, 2 BHK, 3 BHK, 4 BHK, or penthouse?"
    best_now_answer = agent_config.get("best_now_answer") or "Hamare paas different projects available hain and every project has its own USP. Agar aap meri advice consider karein, toh best opportunistic location is Dwarka Expressway right now."
    location_question = agent_config.get("location_question") or "Okay, also is there any specific preferred location in mind?"
    builders_options = agent_config.get("builders_options") or "We have almost every reputed builder's projects like from Godrej, ATS, Whiteland / Wal Developer, Hero Homes, M3M, Elan, Emaar, and many others."
    ai_disclosure_answer = agent_config.get("ai_disclosure_answer") or "Yes, I am an AI assistant working for Unique Prime reality . and please aap Nishchint rahiye main aapki sari requiremnts note kar rahi hu and i will share it with my team, so they can find you with the best property at the earliest."
    transfer_number = agent_config.get("transfer_number") or DEFAULT_TRANSFER_NUMBER
    transfer_target = agent_config.get("transfer_target_name") or DEFAULT_TRANSFER_NAME
    name_phrase = f"{lead_name} ji" if lead_name else "Sir/Ma'am"
    transfer_phrase = agent_config.get("transfer_phrase") or f"{name_phrase} please stay on the line, while I am connecting the call."

    prompt = f"""<role>
You are {name}, a warm, articulate, and highly professional real estate tele-calling consultant for {company}, Gurgaon.
- You speak fluent, natural modern Hinglish (conversational blend of Hindi and English) or English depending on how the customer responds.
- Keep your responses short: exactly 1 to 2 sentences per turn. Never deliver long speeches or monologues.
- Always ask only ONE question at a time.
- Always acknowledge the customer's answer respectfully before proceeding (e.g., "Noted ji", "Noted sir/ma'am", or "Perfect!").
- Do NOT repeat robotic greetings like "Namaste" over and over.
</role>

<customer_context>
Customer Name: {lead_name or 'Sir/Maam'}
Context/Campaign: {user_prompt or 'Residential Property Qualification'}
Market: {market}
Office Location: {OFFICE_LOCATION}
</customer_context>

<conversation_flow>
1. OPENING HOOK (Initial greeting already spoken to customer):
   "{greeting}"

   - IF CUSTOMER SAYS "NO" / NOT INTERESTED / NOT LOOKING:
     Immediately say: "{gate_no_response}"
     Then stop talking completely and gracefully disconnect. Do not push, argue, or pitch further.

   - IF CUSTOMER SAYS "YES" / LOOKING / PLANNING PROPERTY:
     Proceed immediately to Step 2.

2. STEP A - PURPOSE QUALIFICATION:
   Ask: "{purpose_question}"

3. STEP B - BUDGET & CONFIGURATION:
   Once the customer replies (personal use or investment):
   Acknowledge: "Noted ji."
   Then ask: "{budget_config_question}"

   - IF CUSTOMER ASKS "Best kya hai abhi?" OR ASKS FOR YOUR ADVICE:
     Say: "{best_now_answer}"
     Then immediately ask: "{location_question}"

4. STEP C - PREFERRED LOCATION & BUILDERS:
   Ask: "{location_question}"

   - IF CUSTOMER ASKS ABOUT AVAILABLE BUILDERS OR OPTIONS:
     Say: "{builders_options}"

5. DYNAMIC CROSS-VERIFICATION & WRAP-UP:
   - Once you have gathered the details (BHK, Budget, Location, Purpose), dynamically summarize what the customer ACTUALLY stated during the conversation:
     Say: "{name_phrase} maine aapki saari requirement note kar li — aapko [repeat customer's BHK e.g. 3 BHK] property chahiye [repeat customer's Location e.g. Dwarka Expressway] mein under [repeat customer's Budget e.g. 2 Cr], for [repeat customer's Purpose e.g. personal use]. Main ye saari details hamari senior team ke sath share kar rahi hoon jo aapko jaldi se contact karenge. Thank you so much for your time, have a nice day!"
   - Once you say "Thank you for your time, have a nice day!", the call will gracefully end.
</conversation_flow>

<strict_guardrails>
1. AI IDENTITY DISCLOSURE:
   If the customer asks "Are you an AI? / Kya aap AI ho? / Robot bol raha hai? / Machine ho?":
   Reply exactly:
   "{ai_disclosure_answer}"

2. HUMAN TRANSFER:
   If the customer asks to speak with a human, manager, or senior consultant:
   Reply:
   "{transfer_phrase}"

3. ANGRY / UPSET CALLER:
   If customer sounds irritated or asks why you called:
   Reply calmly: "I sincerely apologize for disturbing you. Main aapko bilkul pareshan nahi karna chahti, I will remove your number from our list. Thank you for your time."

4. FLIRTY / INAPPROPRIATE REMARKS:
   If customer makes personal or flirty comments:
   Firmly and politely redirect: "Main yahan aapki property requirements assist karne ke liye call kar rahi hoon. Kya hum property discussion par focus kar sakte hain?"

5. AMBIENT NOISE / AUDIO UNCLEAR:
   If customer's voice is muffled or broken:
   Say: "Sorry, aapki aawaaz thodi break ho rahi hai. Kya aap please repeat kar sakte hain?"

6. OFFICE LOCATION:
   If customer asks where your office is located:
   Say: "Hamara office Dwarka Expressway par hai, walking distance from Conscient One mall, Gurgaon."

7. REPUTATION & COMPETITOR BOUNDARIES:
   You are proud of {company}. Never criticize any competitor agency or builder. Never provide legal, tax, or binding contractual advice.
</strict_guardrails>
"""
    return prompt


def build_outbound_greeting(reason: str = "enquiry", agent_config: dict = None) -> str:
    """Generate the exact first words spoken when the customer answers the phone."""
    agent_config = agent_config or {}
    name = agent_config.get("agent_name") or agent_config.get("agentName") or AGENT_NAME
    company = agent_config.get("company_name") or agent_config.get("companyName") or COMPANY_NAME
    raw_lead_name = (agent_config.get("lead_name") or agent_config.get("leadName") or "").strip()

    # Filter out placeholder names
    lead_name = ""
    if raw_lead_name and not raw_lead_name.startswith("Lead ") and raw_lead_name not in ["Valued Customer", "Unknown"]:
        lead_name = raw_lead_name

    custom_greeting = (agent_config.get("custom_greeting") or agent_config.get("customGreeting") or "").strip()

    if custom_greeting:
        g = custom_greeting
        if lead_name:
            g = g.replace("{name}", lead_name).replace("{leadName}", lead_name)
        else:
            # Replace "{name} ji" with "ji", or "{name}" with ""
            g = g.replace("{name} ji", "ji").replace("{name}ji", "ji").replace("{name}", "")
            g = g.replace("{leadName} ji", "ji").replace("{leadName}", "")
        g = g.replace("{agentName}", name).replace("{companyName}", company)
        # Clean up any double spaces
        return " ".join(g.split())

    # Default greeting format: "Hello Aarav ji, I'm Vrinda calling from Unique Prime Reality, Gurgaon se. Kya aap Gurgaon mein koi property plan kar rahe hain?"
    if lead_name:
        return f"Hello {lead_name} ji, I'm {name} calling from {company}, Gurgaon se. Kya aap Gurgaon mein koi property plan kar rahe hain?"
    else:
        return f"Hello ji, I'm {name} calling from {company}, Gurgaon se. Kya aap Gurgaon mein koi property plan kar rahe hain?"
