"""
AI Call Logs — a clean, read-friendly log of calls made/received by the AI
calling agent (Sarvam), imported from the call export file.

WHAT IT DOES
- Import a CSV / XLSX / JSON export (POST /api/ai-call-logs/import).
  Only useful fields are stored. Usage, credits, cost, campaign IDs and any
  other unknown columns are dropped on import and never reach the database.
- Auto-flags every call: interested / qualified / callback / not interested /
  no answer, and writes a short summary of each call (if the file has none).
- Stats + hourly counts for any date/time window.
- Remarks, manual category override, auto summary.
- Assign a call's lead ONLY to Vranda or Sandeep (AI_CALLING_USERNAMES).

ACCESS: same rule as the rest of the AI calling module — only the accounts
in AI_CALLING_USERNAMES (Vranda + Sandeep). Nobody else can read or write.

Nothing in ai_calling.py is changed; this module has its own collection
(`ai_call_logs`) so imported history never interferes with live AI calls.
"""
import asyncio
import csv
import hashlib
import io
import json
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from server import db, now_iso, Lead, _log_activity, require_admin
from ai_calling import require_ai_logs_access, AI_CALLING_USERNAMES, EMERGENT_LLM_KEY, LLM_MODEL
from ai_call_export import build_csv, build_pdf

logger = logging.getLogger("crm.ai_call_logs")

router = APIRouter(prefix="/api/ai-call-logs", dependencies=[Depends(require_ai_logs_access)])

IST = timezone(timedelta(hours=5, minutes=30))  # India has no DST

CATEGORIES = ["qualified", "interested", "callback", "not_interested", "no_answer", "other"]
# Categories that count as "interested people" in the headline number.
INTERESTED_SET = {"qualified", "interested"}
# "No answer" and "picked up but did not speak" both count as NOT interested.
NOT_INTERESTED_SET = {"not_interested", "no_answer"}
TEMPERATURES = ["hot", "warm", "cold", "lost"]

# Sort order used when "Best leads first" is chosen.
CATEGORY_RANK = {"qualified": 0, "interested": 1, "callback": 2, "other": 3, "no_answer": 4, "not_interested": 5}

# ---- AI lead score (0-100) — same hot / warm / cold bands as the AI Calling module
HOT_FROM, WARM_FROM = 60, 30
SIGNAL_POINTS = {"interested": 20, "visit": 25, "budget": 15, "bhk": 8,
                 "location": 7, "whatsapp": 12, "callback": 5}


# ---------------------------------------------------------------------------
# Column mapping — the export's headers can vary, so match loosely.
# Keys are normalised (lowercase, letters/digits only).
# ---------------------------------------------------------------------------
def _norm(s: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


ALIASES = {
    "call_id": ["callid", "id", "calluuid", "uuid", "sessionid", "conversationid", "interactionid"],
    "phone": ["phone", "phonenumber", "mobile", "mobilenumber", "number", "customernumber", "contactnumber",
              "userphonenumber", "tonumber", "callee", "customerphone", "leadphone", "contact"],
    "from_number": ["fromnumber", "caller", "callernumber"],
    "name": ["name", "customername", "leadname", "contactname", "customer"],
    "direction": ["direction", "calltype", "type", "callDirection".lower()],
    "started_at": ["startedat", "starttime", "calltime", "callstarttime", "timestamp", "datetime", "createdat",
                   "calldate", "date", "time"],
    "date_only": ["dateonly", "day"],
    "duration": ["duration", "durationseconds", "callduration", "talktime", "durationsec", "callDurationSeconds".lower()],
    "status": ["status", "callstatus", "outcome", "result", "callresult"],
    "disposition": ["disposition", "calldisposition", "intent", "leadstatus", "interest", "interestlevel"],
    "conversation": ["conversation", "transcript", "messages", "chat", "callTranscript".lower(), "dialogue"],
    "summary": ["summary", "callsummary", "analysis", "aisummary", "notes"],
    "remark": ["remark", "remarks", "comment", "comments", "note"],
}

AGENT_WORDS = {"agent", "assistant", "ai", "bot", "system", "simran", "vrinda", "vranda", "model", "aiagent"}
CUSTOMER_WORDS = {"user", "customer", "client", "human", "caller", "lead", "person", "visitor", "contact"}


def _pick(row: dict, key: str) -> Any:
    """Return the first non-empty value in `row` matching any alias of `key`."""
    for alias in ALIASES[key]:
        v = row.get(alias)
        if v is not None and str(v).strip() != "" and str(v).strip().lower() != "nan":
            return v
    return None


# ---------------------------------------------------------------------------
# Parsers
# ---------------------------------------------------------------------------
def _clean_phone(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    if re.fullmatch(r"\d+\.0", s):  # Excel float artefact
        s = s[:-2]
    digits = re.sub(r"\D", "", s)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits


def _parse_duration(v: Any) -> int:
    if v is None or str(v).strip() == "":
        return 0
    if isinstance(v, (int, float)):
        return max(0, int(v))
    s = str(v).strip().lower()
    if re.fullmatch(r"\d+(\.\d+)?", s):
        return max(0, int(float(s)))
    if re.fullmatch(r"\d{1,2}:\d{2}(:\d{2})?", s):
        parts = [int(p) for p in s.split(":")]
        return parts[0] * 60 + parts[1] if len(parts) == 2 else parts[0] * 3600 + parts[1] * 60 + parts[2]
    total = 0
    for num, unit in re.findall(r"(\d+)\s*(h|m|s)", s):
        total += int(num) * {"h": 3600, "m": 60, "s": 1}[unit]
    return total


_DT_FORMATS = [
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d-%m-%Y %H:%M:%S", "%d-%m-%Y %H:%M",
    "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y %I:%M %p", "%d/%m/%Y %I:%M:%S %p",
    "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%d %b %Y %H:%M", "%d %b %Y %I:%M %p",
    "%d-%b-%Y %H:%M", "%d-%b-%Y %I:%M %p", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y",
]


def _parse_datetime(v: Any) -> Optional[datetime]:
    """Parse to an aware datetime. Times without a timezone are treated as IST."""
    if v is None or str(v).strip() == "":
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=IST)
    if isinstance(v, (int, float)):  # unix seconds / millis
        ts = float(v)
        if ts > 1e12:
            ts /= 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    s = str(v).strip()
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=IST)
    except ValueError:
        pass
    for fmt in _DT_FORMATS:
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=IST)
        except ValueError:
            continue
    return None


def _speaker_role(label: str) -> str:
    l = re.sub(r"[^a-z]", "", (label or "").lower())
    if l in CUSTOMER_WORDS or any(l.startswith(w) for w in ("user", "customer", "client", "human")):
        return "customer"
    return "agent"


_TURN_RX = re.compile(
    r"(?:(?<=\s)|^)(?:\[?(?P<ts>\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–]?\s*)?"
    r"\[?(?P<lab>agent|assistant|ai|bot|simran|vrinda|vranda|model|user|customer|client|human|caller|lead)\]?\s*[:：]\s*",
    re.I | re.M,
)


def _turn_time(t: dict) -> str:
    v = t.get("timestamp") or t.get("time") or t.get("start") or t.get("start_time") or ""
    return str(v).strip()[:12] if v not in (None, "") else ""


def _parse_conversation(v: Any) -> List[dict]:
    """Accepts a JSON list, a JSON string, or text like 'Agent: ... User: ...'
    (one turn per line OR everything on one line). Returns
    [{speaker: 'agent'|'customer'|'unknown', text: str, time?: str}].
    'unknown' is used only when the text has no speaker labels at all."""
    if v is None or str(v).strip() == "":
        return []
    data = v
    if isinstance(v, str):
        s = v.strip()
        if s[:1] in "[{":
            try:
                data = json.loads(s)
            except ValueError:
                data = s
        else:
            data = s
    if isinstance(data, dict):
        data = data.get("messages") or data.get("transcript") or data.get("conversation") or []
    turns: List[dict] = []
    if isinstance(data, list):
        for t in data:
            if isinstance(t, dict):
                text = t.get("text") or t.get("content") or t.get("message") or t.get("utterance") or t.get("transcript") or ""
                spk = t.get("speaker") or t.get("role") or t.get("from") or t.get("sender") or t.get("participant") or "agent"
                if str(text).strip():
                    turn = {"speaker": _speaker_role(str(spk)), "text": str(text).strip()}
                    tm = _turn_time(t)
                    if tm:
                        turn["time"] = tm
                    turns.append(turn)
            elif isinstance(t, str) and t.strip():
                turns.extend(_parse_conversation(t))
        return turns

    text = str(data).replace("\r", "")
    marks = list(_TURN_RX.finditer(text))
    if not marks:
        # No speaker labels anywhere — keep every line, but don't guess who spoke.
        return [{"speaker": "unknown", "text": ln.strip()} for ln in text.split("\n") if ln.strip()]
    lead_in = text[: marks[0].start()].strip()
    if lead_in:
        turns.append({"speaker": "unknown", "text": " ".join(lead_in.split())})
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        body = " ".join(text[m.end(): end].split())
        if body:
            turn = {"speaker": _speaker_role(m.group("lab")), "text": body}
            if m.group("ts"):
                turn["time"] = m.group("ts")
            turns.append(turn)
    return turns


# ---------------------------------------------------------------------------
# Auto-flagging
# ---------------------------------------------------------------------------
def _rx(words: List[str]) -> re.Pattern:
    return re.compile("|".join(words), re.I)


# Signals a real prospect gives (English + Hinglish + a little Devanagari).
SIG_INTERESTED = _rx([r"\binterested\b", r"\binterest hai\b", r"\bpasand\b", r"\bdetails? (bhej|send|share)",
                      r"\bsend (me )?(the )?(details|brochure|price)", r"\bbhej do\b", r"\bbata(o|iye)\b.*\b(price|rate)",
                      "रुचि", "इंटरेस्ट", "डिटेल्स भेज"])
SIG_VISIT = _rx([r"\bsite ?visit\b", r"\bvisit\b", r"\bcome (and )?see\b", r"\bmilna\b", r"\bdekhne aa",
                 r"\baa(ta|unga|yenge)\b", "साइट विजिट", "देखने"])
SIG_BUDGET = _rx([r"\bbudget\b", r"\b\d+(\.\d+)?\s*(lakh|lac|crore|cr|l)\b", r"\b(lakh|crore)\b", "बजट", "लाख", "करोड़"])
SIG_BHK = _rx([r"\b[1-6]\s?bhk\b", r"\bbedroom\b", r"\bflat\b", r"\bapartment\b", r"\bplot\b", r"\bvilla\b",
               r"\bshop\b", r"\bfloor\b", r"\bpenthouse\b", "बीएचके"])
SIG_LOCATION = _rx([r"\bsector\s?\d+", r"\bgurgaon\b", r"\bgurugram\b", r"\bdelhi\b", r"\bnoida\b", r"\bdwarka\b",
                    r"\bgolf course\b", r"\bsohna\b", r"\bnear\b.*\b(metro|school)\b", "गुड़गांव"])
# --- "smart" lead readiness: what the customer (or the AI summary) actually captured ---
CAP_PURPOSE = _rx([r"\bpersonal use\b", r"\bself[- ]?use\b", r"\bend[- ]?use\b", r"\binvest(ment|or|ing)?\b",
                   r"\bown use\b", r"\bresidential\b"])
CAP_BUDGET = _rx([r"\bbudget\b", r"\b\d+(\.\d+)?\s*(-|to)?\s*\d*\s*(lakh|lac|lakhs|crore|crores|cr|l)\b",
                  r"\b\d[\d,]*\s*(per|/)\s*sq", "बजट", "लाख", "करोड़"])
CAP_CONFIG = _rx([r"\b[1-6](\s?-\s?[1-6])?\s?bhk\b", r"\bplot\b", r"\bvilla\b", r"\bfloor\b", r"\bpenthouse\b",
                  r"\b\d+(\s?-\s?\d+)?\s*sq\.?\s*(yd|yard|ft|feet)", r"\bcommercial\b", r"\bshop\b"])
CAP_LOCATION = _rx([r"\bsector\s?\d+", r"\bdwarka\b", r"\bexpressway\b", r"\bspr\b", r"\bsohna\b",
                    r"\bgolf course\b", r"\bmanesar\b", r"\bnew gurgaon\b", r"\bbhiwadi\b", r"\bpreferred location",
                    r"\bnear\b", r"\bsagatpur\b", r"\bbarwah"])
CAP_TIMELINE = _rx([r"\bwithin\s+(\d+|one|two|three|a)\s*(-\s*\d+\s*)?(day|week|month)", r"\b\d+\s*-\s*\d+\s*months?\b",
                    r"\btimeline\b", r"\bthis month\b", r"\bnext month\b", r"\bimmediate", r"\bsoon\b",
                    r"\bwithin\s+\d+\s*years?\b"])
CAP_FAST = _rx([r"\bwithin\s+(one|a|1|2|two|3|three)\s*(-\s*\d+\s*)?(week|month)", r"\b1\s*-\s*2\s*months?\b",
                r"\bthis month\b", r"\bimmediate", r"\bnext month\b"])
HINT_CALLBACK = _rx([r"\bcall ?back\b", r"\bcall (him|her|them|me|you|again)?\s*(back|later|tomorrow|again)\b",
                     r"\b(can'?t|cannot|could not|unable to) (talk|speak)\b", r"\bbusy\b", r"\bcall later\b",
                     r"\bcall tomorrow\b", r"\bcallback\b", r"\bfollowing (morning|day)\b"])
CALLBACK_WHEN = re.compile(
    r"\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b(tomorrow|kal|today|next week|evening|morning|afternoon)\b|"
    r"\b\d{1,2}(:\d{2})?\s?(am|pm)\b", re.I)


_NOT_GIVEN = re.compile(
    r"[^;.|]*\b(not|never|no)\s+(yet\s+)?(specified|discussed|disclosed|mentioned|provided|shared|stated|decided|finali[sz]ed)\b[^;.|]*"
    r"|[^;.|]*\b(not currently looking)\b[^;.|]*", re.I)


def captured_fields(text: str) -> List[str]:
    """Which of purpose / budget / config / location / timeline the customer gave.
    Phrases like "budget not specified" do NOT count as captured."""
    text = _NOT_GIVEN.sub(" ", text or "")
    out = []
    for name, rx in (("purpose", CAP_PURPOSE), ("budget", CAP_BUDGET), ("config", CAP_CONFIG),
                     ("location", CAP_LOCATION), ("timeline", CAP_TIMELINE)):
        if rx.search(text or ""):
            out.append(name)
    return out


def smart_boost(fields: List[str], text: str) -> int:
    """Extra points for a lead that gave real buying details. 5 per detail, a budget
    is worth more, and a short timeline (within ~2 months) is a strong buying signal."""
    pts = 5 * len(fields)
    if "budget" in fields:
        pts += 3
    if CAP_FAST.search(text or ""):
        pts += 8
    return pts


def callback_when(text: str) -> str:
    seen: dict = {}
    for m in CALLBACK_WHEN.finditer(text or ""):
        seen.setdefault(m.group(0).lower(), m.group(0))
    return ", ".join(seen.values())[:60]


SIG_WHATSAPP = _rx([r"\bwhats ?app\b", r"\bbrochure\b", r"\bmessage (me|kar)", "व्हाट्सएप"])
SIG_CALLBACK = _rx([r"\bcall (me )?(back|later|tomorrow|kal)\b", r"\bcallback\b", r"\bbusy\b", r"\blater\b",
                    r"\bbaad (me|mein)\b", r"\bkal\b.*\bcall\b", r"\bphir se\b", "बाद में", "कल फोन", "व्यस्त"])
SIG_YES = _rx([r"\b(haan|han|ha|yes|yeah|sure|ok(ay)?|theek hai|bilkul|zaroor)\b", "हाँ", "हां", "जी हाँ", "ठीक है"])
SIG_NO = _rx([r"\bnot interested\b", r"\bno interest\b", r"\bnahi chahiye\b", r"\bnahin chahiye\b",
              r"\bdon'?t (call|want|need)\b", r"\bstop calling\b", r"\bmat kar", r"\bnahi karna\b",
              r"\binterested nahi\b", r"\bnot looking\b", r"\bnot required\b", r"\bno need\b",
              "नहीं चाहिए", "रुचि नहीं", "इंटरेस्टेड नहीं", "मत करो"])
SIG_WRONG = _rx([r"\bwrong number\b", r"\bgalat number\b", r"\bnot me\b", r"\bnot (the )?owner\b", "गलत नंबर"])

NO_ANSWER_STATUS = _rx([r"no.?answer", r"not.?answer", r"unanswered", r"busy", r"failed", r"voice ?mail",
                        r"not.?connect", r"missed", r"unreachable", r"switched.?off", r"rejected", r"no.?response",
                        r"cancel", r"timeout", r"time.?out"])
ANSWERED_STATUS = _rx([r"complete", r"answer", r"connect", r"success", r"picked", r"received", r"done"])

SIGNAL_LABELS = {
    "interested": "Showed interest", "visit": "Talked about site visit", "budget": "Shared budget",
    "bhk": "Shared property type / BHK", "location": "Mentioned location", "whatsapp": "Asked for details on WhatsApp",
    "callback": "Asked to call later", "not_interested": "Said not interested", "wrong_number": "Wrong number",
    "no_reply": "Customer did not speak", "short_call": "Very short call",
}


def analyse_call(conversation: List[dict], status: str, disposition: str, duration: int,
                 summary: str = "") -> dict:
    """Returns {category, answered, signals[], score}. Deterministic, no
    external calls — cheap enough to run on every imported row."""
    customer_text = " ".join(t["text"] for t in conversation if t["speaker"] == "customer")
    all_text = " ".join(t["text"] for t in conversation)
    customer_words = len(customer_text.split())
    status_l = (status or "").lower()
    hint = f"{disposition or ''} {summary or ''}".lower()

    # ---- did the person actually pick up and speak? ----
    status_says_no = bool(NO_ANSWER_STATUS.search(status_l)) and not ANSWERED_STATUS.search(status_l)
    spoke = customer_words >= 2
    unlabeled = bool(conversation) and all(t["speaker"] == "unknown" for t in conversation)
    if unlabeled:
        # Transcript has no speaker labels: judge by status/length instead of who spoke.
        answered = (not status_says_no) and (duration >= 15 or len(all_text.split()) >= 8)
        spoke = answered
    elif conversation:
        answered = spoke
    else:
        # No transcript: fall back on status / duration.
        answered = (not status_says_no) and duration >= 20

    signals: List[str] = []
    if not answered:
        if conversation and not spoke and duration >= 5 and not status_says_no:
            # Phone WAS picked up, the person just did not speak. That is a
            # CONNECTED call — and counts as not interested.
            return {"category": "not_interested", "answered": True, "signals": ["no_reply"], "score": -1}
        if duration < 15:
            signals.append("short_call")
        # Never picked up at all: not connected (also counted as not interested).
        return {"category": "no_answer", "answered": False, "signals": signals, "score": -1}

    # Judge on what the *customer* said; agent lines only feed the fallback below
    # so the AI's own pitch ("would you like a site visit?") doesn't count as interest.
    txt = customer_text if customer_words else all_text
    if SIG_WRONG.search(txt) or SIG_WRONG.search(hint):
        return {"category": "not_interested", "answered": True,
                "signals": ["wrong_number"], "score": -5}

    score = 0
    if SIG_INTERESTED.search(txt): signals.append("interested"); score += 2
    if SIG_VISIT.search(txt): signals.append("visit"); score += 3
    if SIG_BUDGET.search(txt): signals.append("budget"); score += 2
    if SIG_BHK.search(txt): signals.append("bhk"); score += 1
    if SIG_LOCATION.search(txt): signals.append("location"); score += 1
    if SIG_WHATSAPP.search(txt): signals.append("whatsapp"); score += 2
    if SIG_CALLBACK.search(txt): signals.append("callback")
    if score == 0 and len(SIG_YES.findall(txt)) >= 2 and customer_words >= 6:
        score += 1  # engaged, said yes a few times

    # The AI summary often says "agreed to call back tomorrow" even when the
    # customer's own lines don't (the agent said it) — so read the summary too.
    if HINT_CALLBACK.search(hint) and not re.search(r"\b(not interested|do not call|dnc|wrong number)\b", hint):
        if "callback" not in signals:
            signals.append("callback")

    # Hints from the export's own disposition / summary (if present)
    if re.search(r"\b(not interested|declined|do not call|dnc|wrong number)\b", hint):
        score -= 3; signals.append("not_interested")
    elif re.search(r"\b(interested|qualified|hot|warm|site visit|appointment)\b", hint):
        score += 2

    said_no = bool(SIG_NO.search(txt))
    if said_no:
        signals.append("not_interested")
        if "interested" in signals:  # "interested nahi hai" is not interest
            signals.remove("interested")
            score -= 2

    # ---- decide ----
    strong = {"visit", "budget", "whatsapp"} & set(signals)
    if said_no and not strong:
        return {"category": "not_interested", "answered": True,
                "signals": _dedupe(signals), "score": -3}
    if "not_interested" in signals and score <= 0:
        return {"category": "not_interested", "answered": True,
                "signals": _dedupe(signals), "score": score}

    # qualified = clear intent + at least one concrete requirement or a visit
    concrete = {"visit", "budget", "bhk", "location"} & set(signals)
    if score >= 5 or ("visit" in signals) or (score >= 4 and len(concrete) >= 2):
        cat = "qualified"
    elif score >= 2:
        cat = "interested"
    elif "callback" in signals:
        cat = "callback"
    elif customer_words < 8 and duration < 25:
        cat = "no_answer" if not customer_words else "other"
        if cat == "no_answer":
            signals.append("short_call")
    else:
        cat = "other"
    # SMART: a customer who has given real buying details (budget + at least two of
    # purpose / property type / location / timeline) is a qualified (hot) lead,
    # even when the exact keywords above were not spoken.
    if cat in ("interested", "other", "callback") and not said_no:
        cap = captured_fields(f"{txt} {hint}")
        if "budget" in cap and len(cap) >= 3:
            cat = "qualified"
            for k in ("budget", "bhk", "location"):
                if k not in signals and ({"budget": "budget", "bhk": "config", "location": "location"}[k] in cap):
                    signals.append(k)
    return {"category": cat, "answered": cat != "no_answer",
            "signals": _dedupe(signals), "score": score}


def temperature_band(score: int, category: str) -> str:
    if category in NOT_INTERESTED_SET:
        return "lost"
    if score >= HOT_FROM:
        return "hot"
    if score >= WARM_FROM:
        return "warm"
    return "cold"


def rate_call(conversation: List[dict], category: str, signals: List[str],
              duration: int, answered: bool, summary: str = "") -> tuple:
    """AI lead score 0-100 from the WHOLE conversation + its temperature.
    Looks at what the customer said (interest, budget, BHK, location, visit,
    WhatsApp), how much they engaged (turns / words) and how long they stayed.
    Returns (score, temperature)."""
    if not answered or category in NOT_INTERESTED_SET or "wrong_number" in (signals or []):
        return 0, "lost"
    theirs = [t for t in (conversation or []) if t.get("speaker") != "agent"]
    words = sum(len((t.get("text") or "").split()) for t in theirs)
    pts = sum(SIGNAL_POINTS.get(s, 0) for s in (signals or []))
    pts += min(12, len(theirs) * 2)      # back-and-forth
    pts += min(8, words // 8)            # how much they talked
    pts += min(8, (duration or 0) // 20)  # how long they stayed
    cust = " ".join((t.get("text") or "") for t in theirs)
    cap = captured_fields(f"{cust} {summary or ''}")
    pts += smart_boost(cap, f"{cust} {summary or ''}")
    if len(cap) >= 2 and category not in ("qualified", "interested"):
        pts = max(pts, WARM_FROM + 1)     # gave two real details (e.g. purpose + location) => at least warm
    if category == "qualified":
        pts = max(pts, HOT_FROM)          # a hand-marked / clear qualified lead is at least hot
    elif category == "interested":
        pts = max(pts, WARM_FROM)
    score = max(0, min(100, int(pts)))
    return score, temperature_band(score, category)


# Every detail the score is made of — shown in the "edit score" popup.
SCORE_DETAILS = ["interested", "visit", "budget", "bhk", "location", "whatsapp", "callback",
                 "engagement", "talk", "duration"]


def score_breakdown(conversation: List[dict], category: str, signals: List[str],
                    duration: int, answered: bool) -> Dict[str, int]:
    """Points the automatic engine gives for each detail of this call
    (all zeros for calls that were never picked up / not interested)."""
    zero = {k: 0 for k in SCORE_DETAILS}
    if not answered or category in NOT_INTERESTED_SET or "wrong_number" in (signals or []):
        return zero
    theirs = [t for t in (conversation or []) if t.get("speaker") != "agent"]
    words = sum(len((t.get("text") or "").split()) for t in theirs)
    out = {k: (SIGNAL_POINTS.get(k, 0) if k in (signals or []) else 0)
           for k in ("interested", "visit", "budget", "bhk", "location", "whatsapp", "callback")}
    out["engagement"] = min(12, len(theirs) * 2)
    out["talk"] = min(8, words // 8)
    out["duration"] = min(8, (duration or 0) // 20)
    return out


_CAT_LINE = {
    "qualified": "Qualified lead — clear interest with real requirements.",
    "interested": "Showed interest.",
    "callback": "Asked to be called back later.",
    "not_interested": "Not interested.",
    "no_answer": "Call was not picked up or the person did not speak.",
    "other": "Spoke with the agent, no clear interest yet.",
}
_RX_BUDGET = re.compile(r"(\d+(?:\.\d+)?)\s*(lakh|lac|crore|cr)\b", re.I)
_RX_BHK = re.compile(r"\b([1-6])\s?bhk\b", re.I)
_RX_SECTOR = re.compile(r"\bsector\s?(\d+)", re.I)


def auto_summary(conversation: List[dict], category: str, signals: List[str]) -> str:
    """Short plain-English summary used when the export has no summary of its own."""
    parts = [_CAT_LINE.get(category, "")]
    txt = " ".join(t["text"] for t in conversation if t["speaker"] == "customer")
    facts = []
    b = _RX_BUDGET.search(txt)
    if b:
        facts.append(f"budget {b.group(1)} {b.group(2).lower()}")
    k = _RX_BHK.search(txt)
    if k:
        facts.append(f"{k.group(1)} BHK")
    sc = _RX_SECTOR.search(txt)
    if sc:
        facts.append(f"Sector {sc.group(1)}")
    if facts:
        parts.append("Mentioned: " + ", ".join(facts) + ".")
    if "visit" in signals:
        parts.append("Open to a site visit.")
    if "whatsapp" in signals:
        parts.append("Wants details on WhatsApp.")
    return " ".join(p for p in parts if p)


_REASON_RULES = [
    (r"voice ?mail|answering.?machine", "Voicemail"),
    (r"busy", "Line busy"),
    (r"switched.?off|unreachable|not.?reachable|out.?of.?(coverage|network)", "Unreachable / switched off"),
    (r"invalid|wrong.?number|not.?exist|unallocated", "Invalid number"),
    (r"reject|declin|denied|blocked", "Rejected / cut by person"),
    (r"cancel", "Cancelled"),
    (r"fail|error", "Call failed"),
    (r"no.?answer|not.?answer|unanswered|missed|no.?response|time.?out|ring", "No answer"),
]
REASON_NAMES = [r[1] for r in _REASON_RULES] + [
    "Picked up, no one spoke", "Hung up within seconds", "Not connected (no reason in file)",
]


def not_connected_reason(status: str, signals: List[str], duration: int) -> str:
    """Plain-English reason a call did not connect. Uses the export's own status
    first, then what we can tell from the call itself."""
    s = (status or "").lower()
    for rx, label in _REASON_RULES:
        if re.search(rx, s):
            return label
    if "no_reply" in signals:
        return "Picked up, no one spoke"
    if "short_call" in signals or (duration or 0) < 10:
        return "Hung up within seconds" if (duration or 0) >= 3 else "No answer"
    return "Not connected (no reason in file)"


# ---------------------------------------------------------------------------
# Follow-up detection — "call me tomorrow at 5", "kal shaam ko", "send on WhatsApp"
# Runs on every imported call and on existing calls (backfill), no AI credits used.
# ---------------------------------------------------------------------------
_WEEKDAYS = {
    "monday": 0, "somvar": 0, "सोमवार": 0, "tuesday": 1, "mangalwar": 1, "mangalvar": 1, "मंगलवार": 1,
    "wednesday": 2, "budhwar": 2, "budhvar": 2, "बुधवार": 2, "thursday": 3, "guruwar": 3, "veerwar": 3,
    "brihaspatiwar": 3, "गुरुवार": 3, "friday": 4, "shukrawar": 4, "shukravar": 4, "शुक्रवार": 4,
    "saturday": 5, "shaniwar": 5, "shanivar": 5, "शनिवार": 5, "sunday": 6, "raviwar": 6, "itwar": 6, "रविवार": 6,
}
_RX_FU_DAYS_AHEAD = re.compile(r"\b(\d{1,2})\s*(?:din|days?)\s*(?:baad|bad|later|mein|me)?\b|\bafter\s*(\d{1,2})\s*days?\b|\bin\s*(\d{1,2})\s*days?\b", re.I)
_RX_FU_TODAY = re.compile(r"\b(today|aaj)\b|आज", re.I)
_RX_FU_TOMORROW = re.compile(r"\b(tomorrow|tmrw|kal)\b|कल", re.I)
_RX_FU_DAYAFTER = re.compile(r"\b(day after tomorrow|parso|parson)\b|परसों|परसो", re.I)
_RX_FU_NEXTWEEK = re.compile(r"\b(next week|agle hafte|agle week|next monday)\b|अगले हफ्ते|अगले सप्ताह", re.I)
_RX_FU_NEXTMONTH = re.compile(r"\b(next month|agle mahine|agle month)\b|अगले महीने", re.I)
_RX_FU_CLOCK = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje|bje|o'?clock)\b|(\d{1,2})(?::(\d{2}))?\s*बजे", re.I)
_PART_OF_DAY = [
    (re.compile(r"\b(subah|morning)\b|सुबह", re.I), 10),
    (re.compile(r"\b(dopahar|afternoon|lunch)\b|दोपहर", re.I), 14),
    (re.compile(r"\b(shaam|sham|evening)\b|शाम", re.I), 18),
    (re.compile(r"\b(raat|night)\b|रात", re.I), 20),
]
DEFAULT_FOLLOWUP_HOUR = 11


def _extract_followup_when(text: str, base: datetime) -> tuple:
    """Find a day + time the customer (or agent) agreed on. `base` is the call
    start in IST. Returns (datetime_ist | None, phrase_found | '', has_explicit_day_or_time)."""
    t = text or ""
    day_offset: Optional[int] = None
    phrase: List[str] = []
    m = _RX_FU_DAYAFTER.search(t)
    if m:
        day_offset = 2; phrase.append(m.group(0))
    elif _RX_FU_NEXTWEEK.search(t):
        day_offset = 7; phrase.append(_RX_FU_NEXTWEEK.search(t).group(0))
    elif _RX_FU_NEXTMONTH.search(t):
        day_offset = 30; phrase.append(_RX_FU_NEXTMONTH.search(t).group(0))
    elif _RX_FU_TOMORROW.search(t):
        day_offset = 1; phrase.append(_RX_FU_TOMORROW.search(t).group(0))
    elif _RX_FU_TODAY.search(t):
        day_offset = 0; phrase.append(_RX_FU_TODAY.search(t).group(0))
    else:
        n = _RX_FU_DAYS_AHEAD.search(t)
        if n:
            num = int(next(g for g in n.groups() if g))
            if 1 <= num <= 60:
                day_offset = num; phrase.append(n.group(0).strip())
        if day_offset is None:
            low = t.lower()
            for word, wd in _WEEKDAYS.items():
                if re.search(r"(?<![a-z])" + re.escape(word) + r"(?![a-z])", low) or word in t:
                    day_offset = (wd - base.weekday()) % 7 or 7
                    phrase.append(word)
                    break

    hour: Optional[int] = None
    minute = 0
    c = _RX_FU_CLOCK.search(t)
    if c:
        h = int(c.group(1) or c.group(4))
        minute = int(c.group(2) or c.group(5) or 0)
        unit = (c.group(3) or "baje").lower()
        if 0 <= h <= 23 and minute < 60:
            if unit == "pm" and h < 12:
                h += 12
            elif unit == "am" and h == 12:
                h = 0
            elif unit not in ("am", "pm") and h <= 12:
                # "5 baje": pick the sensible half of the day for a business call
                pod = next((hh for rx, hh in _PART_OF_DAY if rx.search(t)), None)
                if pod is not None:
                    h = h + 12 if (pod >= 14 and h < 12) else h
                elif 1 <= h <= 7:
                    h += 12
            hour = h
            phrase.append(c.group(0).strip())
    if hour is None:
        for rx, hh in _PART_OF_DAY:
            pm = rx.search(t)
            if pm:
                hour = hh; phrase.append(pm.group(0)); break

    if day_offset is None and hour is None:
        return None, "", False
    explicit_hour = hour is not None
    if hour is None:
        hour = DEFAULT_FOLLOWUP_HOUR
    if day_offset is None:
        # Only a time was given: same day if still ahead of the call, else next day.
        cand = base.replace(hour=hour, minute=minute, second=0, microsecond=0)
        day_offset = 0 if cand > base else 1
    when = (base + timedelta(days=day_offset)).replace(hour=hour, minute=minute, second=0, microsecond=0)
    return when, " ".join(dict.fromkeys(phrase)), True


def detect_followup(conversation: List[dict], category: str, signals: List[str],
                    answered: bool, started_at: Optional[datetime]) -> dict:
    """Decides whether a call needs a follow-up, why, and when.
    followup_time_source: 'stated' = the customer gave a day/time, 'suggested' = we
    picked next day 11:00 because the lead is worth chasing but no time was said."""
    empty = {"followup_needed": False, "followup_reason": "", "followup_at": None,
             "followup_when_text": "", "followup_time_source": None}
    if not answered or category in NOT_INTERESTED_SET or "wrong_number" in (signals or []):
        return empty
    sig = set(signals or [])
    reasons: List[str] = []
    if "callback" in sig:
        reasons.append("Asked to be called back")
    if "whatsapp" in sig:
        reasons.append("Wants details on WhatsApp")
    if "visit" in sig:
        reasons.append("Talked about a site visit")
    if category in INTERESTED_SET and not reasons:
        reasons.append("Interested lead")
    if category == "callback" and not reasons:
        reasons.append("Asked to be called back")
    if not reasons:
        return empty

    base = (started_at or datetime.now(timezone.utc)).astimezone(IST)
    customer_text = " ".join(t["text"] for t in conversation if t.get("speaker") == "customer")
    # Agent confirmations ("Theek hai, kal 5 baje call karungi") also carry the agreed time.
    agent_confirm = " ".join(t["text"] for t in conversation
                             if t.get("speaker") != "customer"
                             and re.search(r"\b(call|phone|contact|milte|baat)\b|कॉल|फोन", t.get("text", ""), re.I))
    when, phrase, explicit = _extract_followup_when(customer_text, base)
    if when is None and agent_confirm:
        when, phrase, explicit = _extract_followup_when(agent_confirm, base)
    if when is not None:
        source = "stated"
    else:
        when = (base + timedelta(days=1)).replace(hour=DEFAULT_FOLLOWUP_HOUR, minute=0, second=0, microsecond=0)
        phrase, source = "", "suggested"
    return {
        "followup_needed": True,
        "followup_reason": "; ".join(reasons),
        "followup_at": when.astimezone(timezone.utc).isoformat(),
        "followup_when_text": phrase,
        "followup_time_source": source,
    }


def _dedupe(seq: List[str]) -> List[str]:
    out: List[str] = []
    for s in seq:
        if s not in out:
            out.append(s)
    return out


# ---------------------------------------------------------------------------
# File reading
# ---------------------------------------------------------------------------
def _read_rows(filename: str, raw: bytes) -> List[dict]:
    name = (filename or "").lower()
    if name.endswith(".json"):
        data = json.loads(raw.decode("utf-8-sig"))
        if isinstance(data, dict):
            data = data.get("calls") or data.get("data") or data.get("items") or data.get("results") or [data]
        return [{_norm(k): v for k, v in (r or {}).items()} for r in data if isinstance(r, dict)]
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        rows: List[dict] = []
        for ws in wb.worksheets:
            it = ws.iter_rows(values_only=True)
            header = None
            for r in it:
                if header is None:
                    if r and any(c is not None and str(c).strip() for c in r):
                        header = [_norm(c) for c in r]
                    continue
                if r and any(c is not None and str(c).strip() for c in r):
                    rows.append({header[i]: r[i] for i in range(min(len(header), len(r))) if header[i]})
            if rows:
                break  # first sheet that has data
        return rows
    # CSV / TSV / txt
    text = None
    for enc in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeError:
            continue
    text = text or ""
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    return [{_norm(k): v for k, v in r.items() if k} for r in reader]


def _build_doc(row: dict) -> Optional[dict]:
    phone = _clean_phone(_pick(row, "phone"))
    direction_raw = str(_pick(row, "direction") or "").lower()
    if not phone:
        phone = _clean_phone(_pick(row, "from_number"))
    if not phone:
        return None

    started = _parse_datetime(_pick(row, "started_at"))
    if started is None:
        return None
    # Some exports keep date and time in two columns
    time_only = row.get("timeonly") or row.get("calltimeonly")
    if time_only and re.fullmatch(r"\d{1,2}:\d{2}(:\d{2})?", str(time_only).strip()):
        d = _parse_datetime(_pick(row, "date_only"))
        if d:
            h, m, *s = [int(x) for x in str(time_only).strip().split(":")]
            started = d.replace(hour=h, minute=m, second=(s[0] if s else 0))

    conversation = _parse_conversation(_pick(row, "conversation"))
    duration = _parse_duration(_pick(row, "duration"))
    status = str(_pick(row, "status") or "").strip()
    disposition = str(_pick(row, "disposition") or "").strip()
    summary = str(_pick(row, "summary") or "").strip()
    remark = str(_pick(row, "remark") or "").strip()

    if "in" in direction_raw and "out" not in direction_raw:
        direction = "inbound"
    else:
        direction = "outbound"

    call_id = str(_pick(row, "call_id") or "").strip()
    call_key = call_id or hashlib.sha1(f"{phone}|{started.isoformat()}".encode()).hexdigest()[:20]

    result = analyse_call(conversation, status, disposition, duration, summary)
    ai_score, temperature = rate_call(conversation, result["category"], result["signals"],
                                      duration, result["answered"], summary)
    summary_is_auto = not summary
    cust_txt = " ".join(t["text"] for t in conversation if t["speaker"] != "agent")
    captured = captured_fields(f"{cust_txt} {summary}") if result["answered"] and result["category"] not in NOT_INTERESTED_SET else []
    cb_when = callback_when(summary) if "callback" in result["signals"] else ""
    if summary_is_auto:
        summary = auto_summary(conversation, result["category"], result["signals"])
    followup = detect_followup(conversation, result["category"], result["signals"],
                               result["answered"], started)
    return {
        **followup,
        "followup_done": False,
        "call_key": call_key,
        "phone": phone,
        "name": str(_pick(row, "name") or "").strip(),
        "direction": direction,
        "started_at": started.astimezone(timezone.utc).isoformat(),
        "duration_seconds": duration,
        "status": status,
        "answered": result["answered"],
        "captured": captured,
        "callback_when": cb_when,
        # Picked up (even if the person stayed silent) = the lead was CONTACTED.
        "contacted": bool(result["answered"]),
        "not_connected_reason": None if result["answered"] else not_connected_reason(status, result["signals"], duration),
        "conversation": conversation,
        "summary": summary,
        "summary_auto": summary_is_auto,
        "remark": remark,
        "category": result["category"],
        "category_auto": result["category"],
        "signals": result["signals"],
        "score": result["score"],
        "ai_score": ai_score,
        "temperature": temperature,
        "score_source": "rules",
        "assigned_to": None,
        "assigned_to_name": None,
    }


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------
LIST_FIELDS = {"conversation": 0}  # excluded from list queries for speed


def _out(doc: dict, with_conversation: bool = False) -> dict:
    d = dict(doc)
    d["id"] = str(d.pop("_id"))
    turns = d.get("conversation") or []
    d["turns"] = len(turns)
    if with_conversation:
        manual = d.get("manual_score_details")
        d["score_details"] = manual if (d.get("score_source") == "manual" and manual) else score_breakdown(
            turns, d.get("category") or "other", d.get("signals") or [],
            d.get("duration_seconds") or 0, bool(d.get("answered")))
    if not with_conversation:
        d.pop("conversation", None)
    # first customer line makes a nice preview when there's no summary
    return d


def _range_query(date_from: Optional[str], date_to: Optional[str]) -> dict:
    q: dict = {}
    rng: dict = {}
    if date_from:
        d = _parse_datetime(date_from)
        if d:
            rng["$gte"] = d.astimezone(timezone.utc).isoformat()
    if date_to:
        d = _parse_datetime(date_to)
        if d:
            rng["$lte"] = d.astimezone(timezone.utc).isoformat()
    if rng:
        q["started_at"] = rng
    return q


def _list_query(date_from, date_to, category, assigned, direction, q_text,
                connected=None, reason=None, temperature=None, followup=None) -> dict:
    q = _range_query(date_from, date_to)
    if followup == "pending":
        q["followup_needed"] = True
        q["followup_done"] = {"$ne": True}
    elif followup == "done":
        q["followup_done"] = True
    elif followup == "overdue":
        q["followup_needed"] = True
        q["followup_done"] = {"$ne": True}
        q["followup_at"] = {"$lt": datetime.now(timezone.utc).isoformat()}
    if connected == "yes":
        q["answered"] = True
    elif connected == "no":
        q["answered"] = {"$ne": True}
    if reason and reason != "all":
        q["not_connected_reason"] = reason
    if category and category != "all":
        if category == "interested_all":
            q["category"] = {"$in": list(INTERESTED_SET)}
        elif category == "not_interested_all":
            q["category"] = {"$in": list(NOT_INTERESTED_SET)}
        else:
            q["category"] = category
    if temperature and temperature != "all":
        q["temperature"] = temperature
    if assigned == "unassigned":
        q["assigned_to"] = None
    elif assigned and assigned != "all":
        q["assigned_to"] = assigned
    if direction in ("inbound", "outbound"):
        q["direction"] = direction
    if q_text:
        rx = {"$regex": re.escape(q_text.strip()), "$options": "i"}
        q["$or"] = [{"name": rx}, {"phone": rx}, {"summary": rx}, {"remark": rx}]
    return q


ASSIGNABLE_ROLES = {"sales", "team_lead"}


async def _assignees() -> List[dict]:
    """Everyone an AI-call lead can be handed to: any active sales person / team
    lead, plus Vranda and Sandeep (kept so existing assignments keep working)."""
    users = await db.users.find({
        "active": {"$ne": False},
        "$or": [{"role": {"$in": list(ASSIGNABLE_ROLES)}},
                {"username": {"$in": list(AI_CALLING_USERNAMES)}}],
    }).to_list(500)
    order = {"vranda.aggarwal": 0, "sandeep.chauhan": 1}
    users.sort(key=lambda u: (order.get(u.get("username"), 9), (u.get("name") or "").lower()))
    return [{"id": str(u["_id"]), "name": u.get("name") or u.get("username"), "username": u.get("username"),
             "role": u.get("role")} for u in users]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@router.get("/assignees")
async def assignees():
    """Every active sales person / team lead (plus Vranda & Sandeep) can receive AI-call leads."""
    return await _assignees()


async def _backfill_reasons() -> None:
    """Calls imported before reasons existed get one filled in (cheap, runs once)."""
    missing = db.ai_call_logs.find(
        {"answered": {"$ne": True}, "not_connected_reason": {"$in": [None, ""]}},
        {"status": 1, "signals": 1, "duration_seconds": 1},
    )
    async for d in missing:
        await db.ai_call_logs.update_one(
            {"_id": d["_id"]},
            {"$set": {"not_connected_reason": not_connected_reason(
                d.get("status") or "", d.get("signals") or [], d.get("duration_seconds") or 0)}},
        )


async def _backfill_pickups() -> None:
    """Older imports counted "picked up, no one spoke" as NOT connected.
    Those are connected calls (and count as not interested) — fix them once."""
    await db.ai_call_logs.update_many(
        {"answered": {"$ne": True}, "signals": "no_reply"},
        {"$set": {"answered": True, "not_connected_reason": None}},
    )
    await db.ai_call_logs.update_many(
        {"answered": True, "signals": "no_reply", "category": "no_answer",
         "category_manual": {"$ne": True}},
        {"$set": {"category": "not_interested", "category_auto": "not_interested"}},
    )


async def _backfill_scores() -> None:
    """Calls imported before AI scoring existed get a score + temperature (once)."""
    cur = db.ai_call_logs.find({"ai_score": {"$exists": False}})
    async for d in cur:
        sc, temp = rate_call(d.get("conversation") or [], d.get("category") or "other",
                             d.get("signals") or [], d.get("duration_seconds") or 0,
                             bool(d.get("answered")), d.get("summary") or "")
        await db.ai_call_logs.update_one(
            {"_id": d["_id"]}, {"$set": {"ai_score": sc, "temperature": temp, "score_source": "rules"}})


async def _backfill_followups() -> None:
    """Existing calls (and any new upload) get follow-up + time detected once.
    Hand-edited follow-ups are never touched."""
    cur = db.ai_call_logs.find({"followup_needed": {"$exists": False}})
    async for d in cur:
        started = _parse_datetime(d.get("started_at"))
        f = detect_followup(d.get("conversation") or [], d.get("category") or "other",
                            d.get("signals") or [], bool(d.get("answered")), started)
        f["followup_done"] = False
        await db.ai_call_logs.update_one({"_id": d["_id"]}, {"$set": f})


SYSTEM_ACTOR = {"_id": "system", "name": "AI Call Logs"}


async def _sync_leads_bulk() -> None:
    """Every picked-up AI call (even silent):
      * the CRM lead gets the green "AI Calling Agent" tag — whoever it is assigned to
        (assignment is never touched),
      * a lead still on "new" moves to "contacted",
      * last_contacted_at is brought up to date.
    One pass over the leads (phone -> lead map), so it stays fast."""
    calls = await db.ai_call_logs.find(
        {"answered": True, "ai_tag_synced": {"$ne": True}},
        {"phone": 1, "started_at": 1},
    ).to_list(None)
    if not calls:
        return
    by_phone: dict = {}
    async for l in db.leads.find({}, {"phone": 1, "status": 1}):
        key = re.sub(r"\D", "", str(l.get("phone") or ""))[-10:]
        if key:
            by_phone.setdefault(key, []).append(l)
    latest: dict = {}
    for c in calls:
        key = re.sub(r"\D", "", str(c.get("phone") or ""))[-10:]
        for l in by_phone.get(key, []):
            when = str(c.get("started_at") or "")
            if when > latest.get(l["_id"], ("", ""))[0]:
                latest[l["_id"]] = (when, l.get("status") or "new")
    stamp = now_iso()
    ids = list(latest)
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        await db.leads.update_many(
            {"_id": {"$in": chunk}},
            {"$set": {"ai_agent": True, "ai_agent_at": stamp, "last_contacted_at": stamp}})
        await db.leads.update_many(
            {"_id": {"$in": chunk}, "status": {"$in": ["new", None]}},
            {"$set": {"status": "contacted", "updated_at": stamp}})
    cids = [c["_id"] for c in calls]
    for i in range(0, len(cids), 1000):
        await db.ai_call_logs.update_many(
            {"_id": {"$in": cids[i:i + 1000]}},
            {"$set": {"contacted": True, "contacted_synced": True, "ai_tag_synced": True}})


async def _backfill_contacted() -> None:
    await _sync_leads_bulk()


_BACKFILL_STATE = {"done": False, "running": False}


async def _backfills_now() -> None:
    await _backfill_reasons()
    await _backfill_pickups()
    await _backfill_scores()
    await _backfill_followups()
    await _backfill_contacted()


async def _run_backfills(force: bool = False) -> None:
    """Never makes a page wait. The fix-ups run once per server start in the
    background (and again after each import, which passes force=True)."""
    if _BACKFILL_STATE["running"] or (_BACKFILL_STATE["done"] and not force):
        return
    _BACKFILL_STATE["running"] = True

    async def _job():
        try:
            await _backfills_now()
            _BACKFILL_STATE["done"] = True
        except Exception:  # noqa: BLE001
            logger.exception("call-log backfill failed")
        finally:
            _BACKFILL_STATE["running"] = False
    asyncio.create_task(_job())


def _phone10(v) -> str:
    return re.sub(r"\D", "", str(v or ""))[-10:]


@router.get("/shortlist")
async def shortlist(limit: int = 300):
    """The AI lead shortlist: Hot / Warm / Cold / Call back.
    * one row per phone number (their best / latest call),
    * a hot lead stays in HOT even if it asked for a call back (shown with a chip),
    * a warm or cold lead that asked for a call back goes to CALL BACK only,
    * not-interested, never-picked-up and wrong numbers are left out."""
    await _run_backfills()
    docs = await db.ai_call_logs.find(
        {"answered": True, "category": {"$nin": list(NOT_INTERESTED_SET)}},
        {"conversation": 0},
    ).sort("started_at", -1).to_list(20000)
    best: dict = {}
    for d in docs:
        if "wrong_number" in (d.get("signals") or []):
            continue
        k = _phone10(d.get("phone")) or str(d["_id"])
        cur = best.get(k)
        if not cur or (d.get("ai_score") or 0) > (cur.get("ai_score") or 0):
            best[k] = d
    # which of these phones are already tagged / assigned in the CRM
    crm: dict = {}
    async for l in db.leads.find({}, {"phone": 1, "assigned_to": 1, "assigned_to_name": 1}):
        k10 = _phone10(l.get("phone"))
        # if the same number exists twice in the CRM, prefer the copy that is assigned
        if k10 not in crm or (l.get("assigned_to") and not crm[k10].get("assigned_to")):
            crm[k10] = l
    groups = {"hot": [], "warm": [], "cold": [], "callback": []}
    for k, d in best.items():
        temp = d.get("temperature") or "cold"
        has_cb = "callback" in (d.get("signals") or [])
        if temp == "lost":
            continue
        lead = crm.get(k) or {}
        row = {
            "id": str(d["_id"]), "name": (d.get("name") or "").strip(), "phone": d.get("phone"),
            "result": "Interested" if d.get("category") in INTERESTED_SET else "Undecided",
            "category": d.get("category"), "temperature": temp, "ai_score": d.get("ai_score") or 0,
            "duration_seconds": d.get("duration_seconds") or 0, "summary": d.get("summary") or "",
            "captured": d.get("captured") or [], "callback": has_cb,
            "callback_when": d.get("callback_when") or "", "started_at": d.get("started_at"),
            "assigned_to": lead.get("assigned_to") or d.get("assigned_to"),
            "assigned_to_name": lead.get("assigned_to_name") or d.get("assigned_to_name"),
            "ai_agent": True, "remark": d.get("remark") or "",
        }
        row["unassigned"] = not row["assigned_to"]
        group = "hot" if temp == "hot" else ("callback" if has_cb else temp)
        groups[group].append(row)
    for g in groups.values():
        g.sort(key=lambda r: (-r["ai_score"], str(r["started_at"] or "")), reverse=False)
    counts = {g: len(v) for g, v in groups.items()}
    unassigned_counts = {g: sum(1 for r in v if r["unassigned"]) for g, v in groups.items()}
    return {"counts": counts, "unassigned_counts": unassigned_counts, **{g: v[:max(1, min(limit, 1000))] for g, v in groups.items()}}


@router.get("/stats")
async def stats(date_from: Optional[str] = None, date_to: Optional[str] = None):
    """Headline numbers + calls-per-hour for the chosen window (all IST)."""
    await _run_backfills()
    q = _range_query(date_from, date_to)
    docs = await db.ai_call_logs.find(
        q, {"started_at": 1, "category": 1, "answered": 1, "assigned_to": 1, "direction": 1,
            "not_connected_reason": 1, "signals": 1, "temperature": 1}
    ).to_list(50000)

    total = len(docs)
    answered = sum(1 for d in docs if d.get("answered"))
    qualified = sum(1 for d in docs if d.get("category") == "qualified")
    interested = sum(1 for d in docs if d.get("category") in INTERESTED_SET)
    assigned = sum(1 for d in docs if d.get("assigned_to"))
    inbound = sum(1 for d in docs if d.get("direction") == "inbound")

    by_hour = [0] * 24
    for d in docs:
        try:
            h = datetime.fromisoformat(d["started_at"]).astimezone(IST).hour
            by_hour[h] += 1
        except Exception:
            continue

    counts_by_cat = {c: 0 for c in CATEGORIES}
    for d in docs:
        counts_by_cat[d.get("category") or "other"] = counts_by_cat.get(d.get("category") or "other", 0) + 1

    by_temperature = {t: 0 for t in TEMPERATURES}
    for d in docs:
        t = d.get("temperature")
        if t in by_temperature:
            by_temperature[t] += 1
    picked_silent = sum(1 for d in docs if d.get("answered") and "no_reply" in (d.get("signals") or []))
    not_interested_total = sum(1 for d in docs if d.get("category") in NOT_INTERESTED_SET)

    reasons: dict = {}
    for d in docs:
        if not d.get("answered"):
            r = d.get("not_connected_reason") or "Not connected (no reason in file)"
            reasons[r] = reasons.get(r, 0) + 1
    reasons_list = sorted(({"reason": k, "count": v} for k, v in reasons.items()), key=lambda x: -x["count"])

    return {
        "connected": answered, "not_connected": total - answered, "reasons": reasons_list,
        "total": total, "answered": answered, "interested": interested, "qualified": qualified,
        "assigned": assigned, "inbound": inbound, "outbound": total - inbound,
        "by_hour": by_hour, "by_category": counts_by_cat,
        "by_temperature": by_temperature, "picked_no_speech": picked_silent,
        "not_interested_total": not_interested_total,
    }


@router.get("")
async def list_logs(
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    category: Optional[str] = None, assigned: Optional[str] = None,
    direction: Optional[str] = None, connected: Optional[str] = None, reason: Optional[str] = None,
    temperature: Optional[str] = None, followup: Optional[str] = None,
    q: Optional[str] = None, sort: str = "newest", page: int = 1, limit: int = 25,
):
    await _run_backfills()
    query = _list_query(date_from, date_to, category, assigned, direction, q, connected, reason, temperature, followup)
    total = await db.ai_call_logs.count_documents(query)
    limit = max(1, min(limit, 100))
    page = max(1, page)

    if sort == "best":
        # rank by category then score — done in Python because category rank isn't a Mongo field
        docs = await db.ai_call_logs.find(query, LIST_FIELDS).to_list(20000)
        docs.sort(key=lambda d: (CATEGORY_RANK.get(d.get("category"), 3), -(d.get("score") or 0),
                                 -(d.get("duration_seconds") or 0)))
        docs = docs[(page - 1) * limit: page * limit]
    else:
        key, direction_ = {
            "newest": ("started_at", -1), "oldest": ("started_at", 1),
            "longest": ("duration_seconds", -1), "shortest": ("duration_seconds", 1),
            "name": ("name", 1), "hottest": ("ai_score", -1), "followup": ("followup_at", 1),
        }.get(sort, ("started_at", -1))
        docs = await (db.ai_call_logs.find(query, LIST_FIELDS)
                      .sort(key, direction_).skip((page - 1) * limit).limit(limit).to_list(limit))
    return {"items": [_out(d) for d in docs], "total": total, "page": page, "pages": max(1, -(-total // limit))}


@router.get("/template")
async def download_template():
    """A ready-to-fill Excel file showing exactly what an upload should look like."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    wb = Workbook()
    ws = wb.active
    ws.title = "Calls"
    headers = ["call_id", "phone", "name", "direction", "start_time", "duration_seconds", "status", "conversation"]
    ws.append(headers)
    ws.append(["C-1001", "9876543210", "Rahul Sharma", "outbound", "2026-09-30 14:05:00", 96, "completed",
               "Agent: Namaste, main Simran bol rahi hoon Unique Prime Reality se.\n"
               "User: Haan boliye.\n"
               "Agent: Aap Gurgaon me flat dekh rahe the?\n"
               "User: Haan, 3 BHK chahiye, budget 1.5 crore hai.\n"
               "Agent: Kya main WhatsApp par details bhej doon? Site visit bhi kara sakte hain.\n"
               "User: Ji bhej do, Sunday ko visit kar lenge."])
    ws.append(["C-1002", "9811122233", "", "inbound", "2026-09-30 14:20:00", 41, "completed",
               "Agent: Namaste, Unique Prime Reality.\nUser: Mujhe abhi interested nahi hai, mat call karo."])
    ws.append(["C-1003", "9899900011", "Neha", "outbound", "2026-09-30 15:02:00", 0, "no-answer", ""])
    ws.append(["C-1004", "9810011122", "", "outbound", "2026-09-30 15:10:00", 0, "busy", ""])
    ws.append(["C-1005", "9990011223", "", "outbound", "2026-09-30 15:18:00", 0, "failed", ""])
    ws.append(["C-1006", "9718800011", "", "outbound", "2026-09-30 15:25:00", 22, "voicemail", ""])
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F4E79")
    widths = [12, 14, 18, 12, 20, 18, 12, 90]
    for i, w in enumerate(widths):
        ws.column_dimensions[chr(65 + i)].width = w
    for row in ws.iter_rows(min_row=2):
        row[7].alignment = Alignment(wrap_text=True, vertical="top")

    help_ws = wb.create_sheet("How to fill")
    help_rows = [
        ["Column", "Required?", "What to put", "Example"],
        ["phone", "YES", "Customer's phone number (10 digits, +91 / 0 prefix is fine)", "9876543210"],
        ["start_time", "YES", "When the call started (India time). Date + time.", "2026-09-30 14:05:00"],
        ["conversation", "Recommended", "The full chat. One line per turn, starting with Agent: or User:", "Agent: Hello...\\nUser: Haan boliye"],
        ["call_id", "Recommended", "Unique ID of the call. Stops duplicates if you upload the same call twice.", "C-1001"],
        ["direction", "Optional", "inbound or outbound (default outbound)", "outbound"],
        ["name", "Optional", "Customer name if known", "Rahul Sharma"],
        ["duration_seconds", "Optional", "Length of the call in seconds (or mm:ss)", "96"],
        ["status", "Recommended", "completed / no-answer / busy / failed / voicemail / switched-off. This becomes the \"not connected\" reason on the dashboard.", "no-answer"],
        ["summary", "Optional", "AI's own summary of the call, if the export has one", ""],
        ["", "", "", ""],
        ["Note", "", "Extra columns (credits, usage, campaign id, cost...) are ignored automatically. "
                     "CSV, XLSX and JSON files all work.", ""],
    ]
    for r in help_rows:
        help_ws.append(r)
    for c in help_ws[1]:
        c.font = Font(bold=True)
    for col, w in zip("ABCD", (18, 14, 70, 32)):
        help_ws.column_dimensions[col].width = w

    buf = io.BytesIO()
    wb.save(buf)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="ai_call_logs_template.xlsx"'},
    )


EXPORT_SCOPES = {
    "interested": ("interested_all", "Interested calls"),
    "not_interested": ("not_interested_all", "Not interested calls"),
    "all": (None, "All calls (interested and not interested)"),
}


@router.get("/export")
async def export_calls(
    fmt: str = Query("pdf", pattern="^(pdf|csv)$"),
    scope: str = Query("interested", pattern="^(interested|not_interested|all)$"),
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    assigned: Optional[str] = None, direction: Optional[str] = None,
    temperature: Optional[str] = None, q: Optional[str] = None,
):
    """Download interested / not interested calls as PDF or CSV.
    Same date / assignee / direction / temperature filters as the list."""
    await _run_backfills()
    category, title = EXPORT_SCOPES[scope]
    query = _list_query(date_from, date_to, category, assigned, direction, q, None, None, temperature)
    docs = await db.ai_call_logs.find(query).sort("started_at", -1).to_list(20000)
    rows = [_out(d, with_conversation=True) for d in docs]
    for r in rows:
        r["result"] = ("Interested" if r.get("category") in INTERESTED_SET
                       else "Not interested" if r.get("category") in NOT_INTERESTED_SET else "Undecided")

    stamp = datetime.now(IST).strftime("%Y-%m-%d_%H%M")
    fname = f"ai_calls_{scope}_{stamp}.{fmt}"
    if fmt == "csv":
        content, media = build_csv(rows), "text/csv; charset=utf-8"
    else:
        rng = []
        if date_from or date_to:
            f_ = lambda v: (_parse_datetime(v).astimezone(IST).strftime("%d %b %Y %I:%M %p") if v and _parse_datetime(v) else "start")
            rng.append(f"Period: {f_(date_from)} to {f_(date_to) if date_to else 'now'}")
        if temperature and temperature != "all":
            rng.append(f"Temperature: {temperature}")
        if direction in ("inbound", "outbound"):
            rng.append(f"Direction: {direction}")
        content, media = build_pdf(rows, title, " | ".join(rng)), "application/pdf"
    return Response(content=content, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.post("/import")
async def import_calls(file: UploadFile = File(...), user: dict = Depends(require_ai_logs_access)):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "The file is empty.")
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(400, "File is too large (max 25 MB).")
    try:
        rows = _read_rows(file.filename or "", raw)
    except Exception as e:  # noqa: BLE001
        logger.warning("call log import: unreadable file: %s", e)
        raise HTTPException(400, "Could not read this file. Please upload a .csv, .xlsx or .json export.")
    if not rows:
        raise HTTPException(400, "No rows found in the file.")

    docs: List[dict] = []
    skipped = 0
    for r in rows:
        d = _build_doc(r)
        if d is None:
            skipped += 1
        else:
            docs.append(d)
    if not docs:
        raise HTTPException(
            400,
            "No usable calls found. Each row needs at least a phone number and a start time. "
            "Download the template to see the format.",
        )

    keys = [d["call_key"] for d in docs]
    existing = set()
    async for e in db.ai_call_logs.find({"call_key": {"$in": keys}}, {"call_key": 1}):
        existing.add(e["call_key"])

    ts = now_iso()
    fresh, seen, updated = [], set(), 0
    for d in docs:
        if d["call_key"] in seen:
            continue
        seen.add(d["call_key"])
        if d["call_key"] in existing:
            # Re-upload of a call we already have: refresh what the file says
            # (conversation, status, flags) but never touch remarks, assignment
            # or a category the team set by hand.
            old = await db.ai_call_logs.find_one(
                {"call_key": d["call_key"]},
                {"category_manual": 1, "category": 1, "summary_auto": 1, "summary": 1, "remark": 1, "name": 1,
                 "followup_manual": 1, "score_source": 1, "name_manual": 1},
            )
            upd = {k: d[k] for k in (
                "direction", "started_at", "duration_seconds", "status", "answered", "not_connected_reason",
                "conversation", "signals", "score", "category_auto")}
            keep_score = (old or {}).get("score_source") == "manual"   # hand-entered score is never overwritten
            if not (old or {}).get("category_manual"):
                upd["category"] = d["category"]
                if not keep_score:
                    upd["ai_score"], upd["temperature"] = d["ai_score"], d["temperature"]
            elif not keep_score:
                upd["ai_score"], upd["temperature"] = rate_call(
                    d["conversation"], old["category"], d["signals"], d["duration_seconds"], d["answered"],
                    d.get("summary") or "")
            if not keep_score:
                upd["score_source"] = "rules"
            upd["contacted"] = d["contacted"]
            if not (old or {}).get("followup_manual"):
                for k in ("followup_needed", "followup_reason", "followup_at",
                          "followup_when_text", "followup_time_source"):
                    upd[k] = d[k]
            if d.get("name") and not (old or {}).get("name_manual"):   # an admin-corrected name is never overwritten
                upd["name"] = d["name"]
            if not d["summary_auto"] or (old or {}).get("summary_auto", True):
                upd["summary"] = d["summary"]
                upd["summary_auto"] = d["summary_auto"]
            if d.get("remark") and not (old or {}).get("remark"):
                upd["remark"] = d["remark"]
            await db.ai_call_logs.update_one({"call_key": d["call_key"]}, {"$set": upd})
            updated += 1
            continue
        d["imported_at"] = ts
        fresh.append(d)
    if fresh:
        await db.ai_call_logs.insert_many(fresh)

    await db.ai_call_logs.create_index("call_key", unique=False)
    await db.ai_call_logs.create_index("started_at")
    await _run_backfills(force=True)
    return {
        "added": len(fresh),
        "updated": updated,
        "duplicates": updated,
        "skipped": skipped,
        "interested_found": sum(1 for d in fresh if d["category"] in INTERESTED_SET),
    }


@router.get("/{log_id}")
async def get_log(log_id: str):
    if not ObjectId.is_valid(log_id):
        raise HTTPException(404, "Call not found")
    d = await db.ai_call_logs.find_one({"_id": ObjectId(log_id)})
    if not d:
        raise HTTPException(404, "Call not found")
    return _out(d, with_conversation=True)


class LogPatch(BaseModel):
    remark: Optional[str] = None
    category: Optional[str] = None
    followup_at: Optional[str] = None       # ISO datetime; empty string clears the follow-up
    followup_note: Optional[str] = None
    followup_done: Optional[bool] = None


@router.patch("/{log_id}")
async def patch_log(log_id: str, payload: LogPatch):
    if not ObjectId.is_valid(log_id):
        raise HTTPException(404, "Call not found")
    updates: dict = {}
    if payload.remark is not None:
        updates["remark"] = payload.remark.strip()[:2000]
    if payload.category is not None:
        if payload.category not in CATEGORIES:
            raise HTTPException(400, "Unknown category")
        updates["category"] = payload.category
        updates["category_manual"] = True
    if payload.followup_at is not None:
        if payload.followup_at.strip() == "":
            updates.update({"followup_needed": False, "followup_at": None, "followup_when_text": "",
                            "followup_time_source": None, "followup_manual": True})
        else:
            when = _parse_datetime(payload.followup_at)
            if when is None:
                raise HTTPException(400, "Could not read that follow-up date/time")
            updates.update({"followup_needed": True, "followup_at": when.astimezone(timezone.utc).isoformat(),
                            "followup_time_source": "manual", "followup_manual": True, "followup_done": False})
    if payload.followup_note is not None:
        updates["followup_note"] = payload.followup_note.strip()[:500]
    if payload.followup_done is not None:
        updates["followup_done"] = bool(payload.followup_done)
    if not updates:
        raise HTTPException(400, "Nothing to update")
    if "category" in updates:
        cur = await db.ai_call_logs.find_one({"_id": ObjectId(log_id)})
        if not cur:
            raise HTTPException(404, "Call not found")
        if cur.get("score_source") != "manual":   # keep a hand-entered score as it is
            updates["ai_score"], updates["temperature"] = rate_call(
                cur.get("conversation") or [], updates["category"], cur.get("signals") or [],
                cur.get("duration_seconds") or 0, bool(cur.get("answered")), cur.get("summary") or "")
            updates["score_source"] = "rules"
    res = await db.ai_call_logs.find_one_and_update(
        {"_id": ObjectId(log_id)}, {"$set": updates}, return_document=True
    )
    if not res:
        raise HTTPException(404, "Call not found")
    return _out(res, with_conversation=True)


@router.post("/{log_id}/ai-score")
async def ai_score_log(log_id: str):
    """Ask the AI model to read the WHOLE conversation and give the lead a
    0-100 score. Replaces the automatic rule-based score for this call."""
    if not ObjectId.is_valid(log_id):
        raise HTTPException(404, "Call not found")
    doc = await db.ai_call_logs.find_one({"_id": ObjectId(log_id)})
    if not doc:
        raise HTTPException(404, "Call not found")
    convo = doc.get("conversation") or []
    if not doc.get("answered") or not convo:
        raise HTTPException(400, "There is no conversation to score for this call.")
    if not EMERGENT_LLM_KEY:
        raise HTTPException(503, "AI scoring is not set up on the server (EMERGENT_LLM_KEY is missing).")
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:  # noqa: BLE001
        raise HTTPException(503, "AI scoring library is not installed on the server.")

    text = "\n".join(
        f"{'AGENT' if t.get('speaker') == 'agent' else 'CUSTOMER'}: {t.get('text', '')}" for t in convo)[:12000]
    system = (
        "You score real-estate sales leads for a Gurgaon property consultancy. Read the whole phone "
        "conversation between the AI AGENT and the CUSTOMER (Hindi / Hinglish / English) and rate how "
        "likely the CUSTOMER is to buy. Judge what the customer said, not the agent's pitch. "
        "0 = not interested / wrong number, 30 = mild interest, 60 = strong interest, 90+ = ready to visit or buy. "
        'Reply with STRICT JSON only: {"score": <integer 0-100>, "reason": "<one short English sentence>"}'
    )
    try:
        import uuid
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"calllog-score-{uuid.uuid4()}",
                       system_message=system).with_model(*LLM_MODEL)
        resp = await chat.send_message(UserMessage(text=text))
        raw = (resp if isinstance(resp, str) else str(resp)).strip()
        a, b = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[a:b + 1])
        score = max(0, min(100, int(round(float(data.get("score"))))))
        reason = str(data.get("reason") or "")[:300]
    except Exception as e:  # noqa: BLE001
        logger.warning("AI call scoring failed: %s", e)
        raise HTTPException(502, "The AI could not score this call right now. Please try again.")

    temp = "lost" if score < 10 else ("hot" if score >= HOT_FROM else "warm" if score >= WARM_FROM else "cold")
    res = await db.ai_call_logs.find_one_and_update(
        {"_id": doc["_id"]},
        {"$set": {"ai_score": score, "temperature": temp, "score_source": "ai", "ai_reason": reason}},
        return_document=True)
    return _out(res, with_conversation=True)


class ManualScoreIn(BaseModel):
    details: Dict[str, int]          # points for each detail, e.g. {"budget": 15, "visit": 25}
    note: Optional[str] = None


@router.post("/{log_id}/manual-score")
async def manual_score_log(log_id: str, payload: ManualScoreIn):
    """Team enters the points for each detail by hand. The total (0-100) becomes
    the call's score and stays until someone re-scores it with AI."""
    if not ObjectId.is_valid(log_id):
        raise HTTPException(404, "Call not found")
    bad = [k for k in payload.details if k not in SCORE_DETAILS]
    if bad:
        raise HTTPException(400, f"Unknown score detail: {bad[0]}")
    details = {k: max(0, min(100, int(payload.details.get(k, 0) or 0))) for k in SCORE_DETAILS}
    score = max(0, min(100, sum(details.values())))
    temp = "lost" if score == 0 else ("hot" if score >= HOT_FROM else "warm" if score >= WARM_FROM else "cold")
    res = await db.ai_call_logs.find_one_and_update(
        {"_id": ObjectId(log_id)},
        {"$set": {"ai_score": score, "temperature": temp, "score_source": "manual",
                  "manual_score_details": details,
                  "ai_reason": (payload.note or "").strip()[:300]}},
        return_document=True)
    if not res:
        raise HTTPException(404, "Call not found")
    return _out(res, with_conversation=True)


class AssignIn(BaseModel):
    user_id: Optional[str] = None  # null = unassign


class BulkAssignIn(AssignIn):
    ids: List[str]


async def _apply_assignment(log: dict, assignee: Optional[dict], actor: dict) -> None:
    """Set the assignee on the call log AND mirror it onto the CRM lead
    (created if this phone number isn't in the CRM yet)."""
    upd = {
        "assigned_to": assignee["id"] if assignee else None,
        "assigned_to_name": assignee["name"] if assignee else None,
        "assigned_at": now_iso() if assignee else None,
    }
    await db.ai_call_logs.update_one({"_id": log["_id"]}, {"$set": upd})
    if not assignee:
        return

    digits = log.get("phone", "")[-10:]
    lead = await db.leads.find_one({"phone": {"$regex": re.escape(digits) + "$"}}) if digits else None
    temp = log.get("temperature")
    tag = temp if temp in ("hot", "warm", "cold") else {"qualified": "hot", "interested": "warm"}.get(log.get("category"))
    if lead:
        lead_set = {"assigned_to": assignee["id"], "assigned_to_name": assignee["name"],
                    "assigned_at": now_iso(), "updated_at": now_iso(),
                    "ai_agent": True}   # the green AI Agent tag stays on whoever holds the lead
        if not lead.get("ai_agent_at"):
            lead_set["ai_agent_at"] = now_iso()
        if tag and not lead.get("tag"):
            lead_set["tag"] = tag
        if temp and not lead.get("ai_temperature"):
            lead_set["ai_temperature"] = temp
        await db.leads.update_one({"_id": lead["_id"]}, {"$set": lead_set})
        lead_id = str(lead["_id"])
    else:
        note = (log.get("summary") or "").strip()
        new_lead = Lead(
            name=log.get("name") or f"AI lead {digits[-4:]}", phone=log.get("phone"), source="AI Calling",
            status="qualified" if log.get("category") == "qualified" else "new", tag=tag,
            ai_temperature=temp, ai_agent=True, ai_agent_at=now_iso(),
            notes=note or None, remark=log.get("remark") or None,
            assigned_to=assignee["id"], assigned_to_name=assignee["name"], assigned_at=now_iso(),
            created_at=now_iso(), updated_at=now_iso(),
        ).to_mongo()
        res = await db.leads.insert_one(new_lead)
        lead_id = str(res.inserted_id)
    await db.ai_call_logs.update_one({"_id": log["_id"]}, {"$set": {"lead_id": lead_id}})
    try:
        await _log_activity(lead_id, actor, "assigned",
                            f"AI call lead assigned to {assignee['name']} by {actor.get('name')}")
    except Exception:  # noqa: BLE001 — activity log must never block assignment
        logger.exception("activity log failed")


async def _resolve_assignee(user_id: Optional[str]) -> Optional[dict]:
    if not user_id:
        return None
    for a in await _assignees():
        if a["id"] == user_id:
            return a
    raise HTTPException(403, "That person can't receive leads (must be an active sales person or team lead).")


class NameIn(BaseModel):
    name: str


@router.post("/{log_id}/name")
async def rename_person(log_id: str, payload: NameIn, user: dict = Depends(require_admin)):
    """Admins only: correct the person's name. Applies to every AI call from the
    same phone number and to the matching CRM lead(s), so the name is the same everywhere."""
    new_name = re.sub(r"\s+", " ", payload.name or "").strip()[:120]
    if not new_name:
        raise HTTPException(400, "Name can't be empty.")
    if not ObjectId.is_valid(log_id):
        raise HTTPException(404, "Call not found")
    log = await db.ai_call_logs.find_one({"_id": ObjectId(log_id)}, {"phone": 1, "name": 1})
    if not log:
        raise HTTPException(404, "Call not found")
    digits = _phone10(log.get("phone"))
    rx = {"$regex": re.escape(digits) + "$"} if digits else None
    if rx:
        await db.ai_call_logs.update_many({"phone": rx}, {"$set": {"name": new_name, "name_manual": True}})
        await db.leads.update_many({"phone": rx}, {"$set": {"name": new_name, "updated_at": now_iso()}})
    else:
        await db.ai_call_logs.update_one({"_id": log["_id"]}, {"$set": {"name": new_name, "name_manual": True}})
    return {"ok": True, "name": new_name, "previous": log.get("name")}


@router.post("/bulk-assign")
async def bulk_assign(payload: BulkAssignIn, user: dict = Depends(require_ai_logs_access)):
    assignee = await _resolve_assignee(payload.user_id)
    oids = [ObjectId(i) for i in payload.ids if ObjectId.is_valid(i)][:500]
    logs = await db.ai_call_logs.find({"_id": {"$in": oids}}).to_list(500)
    for lg in logs:
        await _apply_assignment(lg, assignee, user)
    return {"updated": len(logs), "assigned_to_name": assignee["name"] if assignee else None}


@router.post("/{log_id}/assign")
async def assign_log(log_id: str, payload: AssignIn, user: dict = Depends(require_ai_logs_access)):
    if not ObjectId.is_valid(log_id):
        raise HTTPException(404, "Call not found")
    log = await db.ai_call_logs.find_one({"_id": ObjectId(log_id)})
    if not log:
        raise HTTPException(404, "Call not found")
    assignee = await _resolve_assignee(payload.user_id)
    await _apply_assignment(log, assignee, user)
    return _out(await db.ai_call_logs.find_one({"_id": log["_id"]}), with_conversation=True)
