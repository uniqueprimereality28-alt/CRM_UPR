"""
LLM calls, split into two jobs:

1. live_turn()   — during the call, given conversation history + the
                    customer's latest utterance, produce the agent's next
                    spoken reply (short, natural, one turn at a time).

2. extract_call_result() — after the call ends, given the FULL real
                    transcript, extract the same structured JSON schema
                    the CRM's simulated path used to invent. This is what
                    gets POSTed to /api/ai/calls/ingest.

Works with any OpenAI-compatible /chat/completions endpoint — Groq's free
tier by default (config.LLM_API_BASE), or point it at your existing
Emergent/OpenAI key if you'd rather use that.
"""
import json
import logging

import httpx

import config

logger = logging.getLogger("voice-agent.llm")


def _system_prompt(agent: dict, lead: dict, inventory: list[dict], prior_summary: str | None = None) -> str:
    inv_txt = "\n".join(
        f"- {p.get('project')} | {p.get('location')} | {p.get('config')} | "
        f"{p.get('price_range')} | possession {p.get('possession')} | {p.get('highlights', '')}"
        for p in inventory
    ) or "- (no inventory uploaded)"

    prior_txt = (
        f"\nCONTEXT FROM A PREVIOUS CALL WITH THIS LEAD: {prior_summary}\n"
        f"This is a FOLLOW-UP call — acknowledge you spoke before, don't re-introduce "
        f"yourself as if this is the first contact, and pick up from where things were left.\n"
        if prior_summary else ""
    )

    lead_name = lead.get("name", "the customer")

    return (
        f"You are {agent.get('name', 'Simran')}, a female tele-calling executive for "
        f"'Unique Prime Reality', a real estate consultancy on Dwarka Expressway, Gurgaon. "
        f"You are LIVE on a real phone call with {lead_name} right now — this is spoken audio, "
        f"not chat, so every line will be heard, not read.\n\n"

        f"VOICE & TONE\n"
        f"Speak in a classy, warm, educated Hinglish — natural English-Hindi code-mixing the way "
        f"an urban Gurgaon sales professional actually talks, not textbook Hindi and not pure "
        f"English. Persona: {agent.get('personality', 'polite, confident, warm, mid-20s to 30s')}. "
        f"Always address the customer respectfully as 'sir' or 'ma'am' (pick up their gender from "
        f"how they respond, or stay neutral if unclear — never guess wrong on purpose). Keep every "
        f"reply SHORT — 1 to 2 sentences max, like a real phone call, never a monologue. Sound "
        f"warm and unhurried, never robotic or like you're reading a script, even though you are "
        f"following one.\n\n"

        f"CALL FLOW — follow this order, but phrase each step naturally in your own words each "
        f"time rather than repeating fixed sentences verbatim, and adapt smoothly if the customer "
        f"jumps ahead, answers two questions at once, or asks something out of order:\n"
        f"1. OPENING: Greet and confirm you're speaking to the right person, e.g. 'Hello, kya "
        f"meri baat {lead_name} ji se ho rahi hai?' Once confirmed, introduce yourself and the "
        f"company: 'Sir/Ma'am, main {agent.get('name', 'Simran')} bol rahi hoon, Unique Prime "
        f"Reality se, Dwarka Expressway, Gurgaon.'\n"
        f"2. QUALIFYING QUESTION: Ask if they're currently looking at any property investment "
        f"in Gurgaon.\n"
        f"   - If NO / not interested: Reply warmly, e.g. 'Noted sir/ma'am, thank you for your "
        f"time, have a good day' — and treat the call as ready to close. Do not push further.\n"
        f"   - If YES: continue to step 3.\n"
        f"3. PURPOSE: Ask whether the investment is for their own living (end-use) or for pure "
        f"investment purpose.\n"
        f"4. CONFIGURATION: Ask which configuration they're looking at — 1BHK, 2BHK, 3BHK, "
        f"4BHK, or penthouse.\n"
        f"5. LOCATION PREFERENCE: Ask if they have a preferred location. If they say they're "
        f"flexible or ask you for a recommendation, tell them Dwarka Expressway is currently the "
        f"most opportunistic/high-potential location.\n"
        f"6. BUDGET & INVENTORY STAGE: Ask what budget they're planning, and whether they'd "
        f"prefer ready-to-move options or are fine with under-construction/new-launch projects.\n"
        f"7. CLOSING: Once all of the above is captured, tell them their requirements have been "
        f"noted and will be forwarded to the team, who will connect with them shortly. Thank "
        f"them for their time and end with 'Have a good day, sir/ma'am.'\n\n"

        f"GUARDRAILS: {agent.get('guardrails', '')}\n"
        f"Never invent prices, possession dates, or project names that aren't in AVAILABLE "
        f"INVENTORY below — if asked for specifics you don't have, say a team member will share "
        f"exact details on WhatsApp/call. If the customer is clearly a serious/hot lead or "
        f"explicitly asks for a human, offer to connect them to {config.TRANSFER_TARGET_NAME}.\n"
        f"{prior_txt}\n"
        f"AVAILABLE INVENTORY:\n{inv_txt}\n\n"

        f"Respond with PLAIN SPOKEN TEXT ONLY — no markdown, no stage directions, no JSON, no "
        f"emojis. If the customer says goodbye, hangs up intent, or clearly ends the call at any "
        f"point (even mid-flow), skip straight to a brief, warm closing line — don't force the "
        f"remaining questions."
    )


async def _chat(messages: list[dict], max_tokens: int = 200, json_mode: bool = False) -> str:
    if not config.LLM_API_KEY:
        raise RuntimeError("LLM_API_KEY is not set — see .env.example")
    body = {
        "model": config.LLM_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.6,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{config.LLM_API_BASE}/chat/completions",
            json=body,
            headers={"Authorization": f"Bearer {config.LLM_API_KEY}"},
        )
        resp.raise_for_status()
        data = resp.json()
    return data["choices"][0]["message"]["content"].strip()


async def opening_line(agent: dict, lead: dict | None = None) -> str:
    lead_name = (lead or {}).get("name")
    if agent.get("intro_line"):
        return agent["intro_line"]
    if lead_name:
        return f"Hello, kya meri baat {lead_name} ji se ho rahi hai?"
    return (
        f"Namaste! Main {agent.get('name', 'Simran')} bol rahi hoon, Unique Prime Reality se, "
        f"Dwarka Expressway, Gurgaon."
    )


async def live_turn(agent: dict, lead: dict, inventory: list[dict],
                    history: list[dict], customer_utterance: str,
                    prior_summary: str | None = None) -> str:
    """One conversational turn. `history` is a list of {"speaker","text"} dicts
    (the running transcript so far). Returns the agent's next spoken reply."""
    system = _system_prompt(agent, lead, inventory, prior_summary)
    messages = [{"role": "system", "content": system}]
    for turn in history:
        role = "assistant" if turn["speaker"] == "agent" else "user"
        messages.append({"role": role, "content": turn["text"]})
    messages.append({"role": "user", "content": customer_utterance})
    try:
        return await _chat(messages, max_tokens=120)
    except Exception as e:
        logger.warning(f"live_turn LLM call failed: {e}")
        return "Sorry, main aapko sun nahi paayi. Kya aap dobara bata sakte hain?"


EXTRACTION_SCHEMA_PROMPT = """You will be given the FULL transcript of a real \
phone call between an AI real-estate tele-calling agent and a customer. \
Extract structured data from it. Output STRICT JSON only, no markdown, matching:
{
  "summary": "2-3 sentence English summary of the call",
  "disposition": "connected|interested|callback|not_interested|wrong_number|no_answer|site_visit|transferred",
  "requirements": {"property_type": str|null, "bhk": str|null, "budget": number|null, "location_preference": str|null, "parking": str|null, "possession_timeline": str|null, "callback_preference": str|null},
  "signals": [subset of ALLOWED_SIGNALS],
  "urgency_score": 1-10,
  "wants_site_visit": bool, "wants_brochure": bool, "whatsapp_opt_in": bool,
  "human_transfer_required": bool, "next_followup_days": int|null,
  "remarks": "short internal note for the sales team"
}
budget must be a number in rupees (e.g. 15000000 for 1.5 Cr) or null. \
Only include signal keys that genuinely occurred in the conversation."""


async def extract_call_result(transcript: list[dict], allowed_signals: list[str]) -> dict:
    """Post-call extraction from the REAL transcript. Falls back to a minimal
    safe default if the LLM call fails, so a call is never lost/unscored."""
    transcript_txt = "\n".join(f"{t['speaker'].upper()}: {t['text']}" for t in transcript)
    system = EXTRACTION_SCHEMA_PROMPT.replace(
        "ALLOWED_SIGNALS", json.dumps(allowed_signals)
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"TRANSCRIPT:\n{transcript_txt}\n\nReturn ONLY the JSON object."},
    ]
    try:
        text = await _chat(messages, max_tokens=500, json_mode=True)
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
        return json.loads(text)
    except Exception as e:
        logger.error(f"extract_call_result failed, using safe fallback: {e}")
        return {
            "summary": "Call completed; automatic extraction failed — review transcript manually.",
            "disposition": "connected",
            "requirements": {},
            "signals": [],
            "urgency_score": 3,
            "wants_site_visit": False,
            "wants_brochure": False,
            "whatsapp_opt_in": False,
            "human_transfer_required": False,
            "next_followup_days": 3,
            "remarks": "Extraction failed — please listen to the recording.",
        }
