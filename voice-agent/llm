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


def _system_prompt(agent: dict, lead: dict, inventory: list[dict]) -> str:
    inv_txt = "\n".join(
        f"- {p.get('project')} | {p.get('location')} | {p.get('config')} | "
        f"{p.get('price_range')} | possession {p.get('possession')} | {p.get('highlights', '')}"
        for p in inventory
    ) or "- (no inventory uploaded)"

    return (
        f"You are {agent.get('name', 'Simran')}, a female AI tele-calling assistant for "
        f"'Unique Prime Reality', a real estate consultancy selling residential projects in "
        f"Gurgaon, currently LIVE on a real phone call with {lead.get('name', 'the customer')}.\n"
        f"Persona: {agent.get('personality', 'polite, educated, mid-30s')}.\n"
        f"Speak in FORMAL HINGLISH (English-heavy, polite) with a very light Haryanvi/Hindi "
        f"flavour — never exaggerated. Keep every reply SHORT (1-2 sentences) — this is a real "
        f"spoken phone call, not a chat message. Never say you are typing or texting.\n"
        f"GUARDRAILS: {agent.get('guardrails', '')}\n"
        f"Goals: greet politely, confirm availability, gauge buying intent, capture requirements "
        f"(property type, BHK, budget, location, parking, possession timeline, callback "
        f"preference), offer to share details on WhatsApp, and offer human transfer to "
        f"{config.TRANSFER_TARGET_NAME} if the customer is a serious buyer or asks for a person.\n\n"
        f"AVAILABLE INVENTORY:\n{inv_txt}\n\n"
        f"Respond with PLAIN SPOKEN TEXT ONLY — no markdown, no stage directions, no JSON. "
        f"If the customer says goodbye / hangs up intent / clearly ends the call, reply with a "
        f"brief polite closing line only."
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


async def opening_line(agent: dict) -> str:
    return agent.get("intro_line") or (
        f"Namaste! Main {agent.get('name', 'Simran')} bol rahi hoon, Unique Prime Reality se. "
        f"Aapse property ke baare mein 2 minute baat kar sakti hoon?"
    )


async def live_turn(agent: dict, lead: dict, inventory: list[dict],
                    history: list[dict], customer_utterance: str) -> str:
    """One conversational turn. `history` is a list of {"speaker","text"} dicts
    (the running transcript so far). Returns the agent's next spoken reply."""
    system = _system_prompt(agent, lead, inventory)
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
