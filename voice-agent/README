# voice-agent

A **real** outbound AI voice-calling microservice for the Unique Prime Reality
CRM. This replaces the "simulated" call feature (which just asked an LLM to
invent a fake transcript) with an actual phone call: Plivo dials the lead,
faster-whisper transcribes what they say, an LLM decides the reply, edge-tts
speaks it back, live, in real time.

It is a **separate service** from the CRM backend on purpose — real-time audio
needs a persistent WebSocket + tight processing loop that doesn't belong
bolted onto your request/response API.

**Access control:** the entire feature (every AI endpoint, the Settings
panel, the "Call now (real)" button) is restricted to the CRM account
`vranda.aggarwal` specifically — not just "admin" or "superadmin" generally.
This is enforced on the backend (a single router-level dependency covers
every AI route) and mirrored on the frontend (the whole AI card and nav
entry are hidden for everyone else). No one else in the CRM can see or
trigger this, even by URL.

## Where this goes in your repo

```
your-crm-repo/
├── backend/            <- existing CRM backend (unchanged except ai_calling.py + a 6-line addition to server.py)
│   ├── server.py       <- REPLACE with the one provided (adds a router import, nothing else touched)
│   ├── ai_calling.py   <- REPLACE with the one provided
│   └── requirements.txt<- REPLACE with the one provided (adds httpx)
├── frontend/
│   └── src/
│       ├── context/AuthContext.jsx <- REPLACE (adds an isVranda flag, nothing else touched)
│       └── pages/
│           ├── LeadDetail.jsx      <- REPLACE (adds the Vranda-only "Call now (real)" button)
│           └── Settings.jsx        <- REPLACE (adds a Vranda-only panel to paste the voice-agent API link)
└── voice-agent/         <- NEW folder, add everything from this package here, deployed as its own Render service
    ├── main.py
    ├── config.py
    ├── audio.py
    ├── stt.py
    ├── tts.py
    ├── llm.py
    ├── call_session.py
    ├── requirements.txt
    ├── Dockerfile
    ├── .dockerignore
    └── .env.example
```

## What each free service does

| Piece | Provider | Cost |
|---|---|---|
| Telephony (actual dialing) | Plivo | pay-per-minute, ~₹0.6–1.2/min — no free tier for real PSTN calls, this is unavoidable |
| Speech-to-text | faster-whisper, self-hosted | **free** |
| Text-to-speech | edge-tts, self-hosted | **free** |
| LLM brain | Groq free tier (or your existing key) | **free** within rate limits |
| Orchestration | this FastAPI service | free (just server hosting, ~₹400–500/mo VPS) |

## Setup steps

### 1. Get a Plivo account
- Sign up at [plivo.com](https://console.plivo.com), buy/rent a number (or use trial credit to test)
- Grab your **Auth ID** and **Auth Token** from the console
- For production calling in India you'll need DLT registration — Plivo's
  support can guide this; for testing, trial credit works without it.

### 2. Get a free Groq API key (the LLM brain)
- [console.groq.com/keys](https://console.groq.com/keys) — free, no card required
- Alternatively, reuse your existing `EMERGENT_LLM_KEY` by pointing
  `LLM_API_BASE`/`LLM_API_KEY` at an OpenAI-compatible proxy if you have one;
  Groq is simplest to start free.

### 3. Deploy this folder as its own Render web service
This folder deploys as a **Docker** web service on Render (not Railway —
Docker is used deliberately here because `ffmpeg` needs to be installed at
the OS level for TTS audio decoding, and Render's native Python buildpack
doesn't give you apt-get access; Docker does).

On Render:
1. **New → Web Service** → connect this repo → set **Root Directory** to `voice-agent`
2. **Runtime**: Docker (Render will detect the `Dockerfile` automatically)
3. **Instance type**: at least 1GB RAM recommended (faster-whisper's `small`
   model needs headroom); start on Render's Starter tier and scale if calls
   feel slow
4. Add the env vars below in the Render dashboard's **Environment** tab
5. Deploy once to get your `https://<name>.onrender.com` URL, then **add
   `PUBLIC_BASE_URL=https://<that-url>` and redeploy** — Plivo needs to know
   this service's own public address to open the audio WebSocket back to it

Env vars to set on this Render service (see `.env.example` for the full list):
```
PLIVO_AUTH_ID=...
PLIVO_AUTH_TOKEN=...
PLIVO_FROM_NUMBER=...
VOICE_AGENT_SHARED_SECRET=<make up a long random string>
CRM_BACKEND_URL=https://your-existing-crm-backend.onrender.com
LLM_API_KEY=<your Groq key>
PUBLIC_BASE_URL=  <- fill in AFTER first deploy, then redeploy
```

> Render free/starter instances can spin down when idle, which adds a cold-start
> delay before the first call connects. If you're doing this for real, a paid
> "always-on" instance avoids that delay — worth it once you're past testing.

### 4. Connect it to your CRM — no backend code edits needed
This is the part you asked for: log into the CRM as **vranda.aggarwal**, go
to **Settings → AI Voice Calling Agent** (a new panel, visible only on her
account), and paste in:
- **Voice-agent URL**: `https://<your-voice-agent-name>.onrender.com`
- **Shared secret**: the same random string you set as `VOICE_AGENT_SHARED_SECRET`
  on the voice-agent service above

Click **Save connection**. That's it — stored in the database, no redeploy,
no `.env` editing on the CRM backend side. (An env var fallback still exists
on the backend too, `VOICE_AGENT_URL`/`VOICE_AGENT_SHARED_SECRET`, in case
you'd rather set it at deploy time instead — whichever is set in the
database always takes priority over the env var.)

### 5. Replace the three files
- `backend/ai_calling.py` → replace with the version provided (adds
  `/api/ai/calls/real/trigger` and `/api/ai/calls/ingest`, everything else
  — scoring, campaigns, WhatsApp, transfers — is untouched)
- `backend/requirements.txt` → replace (adds `httpx`)
- `frontend/src/pages/LeadDetail.jsx` → replace (adds the green
  **"Call now (real)"** button next to your existing simulated one)

### 6. Test it
Open a lead in the CRM → click **"Call now (real)"**. Your phone (or the
lead's) should actually ring within a few seconds. Talk to it. When the call
ends, the CRM lead updates with a real transcript, real score, and real
temperature — same as the simulated flow, just backed by an actual
conversation this time.

## Honest limitations of this first version

- **Half-duplex** — the agent doesn't listen while it's talking (no true
  barge-in/interruption handling yet). Customers need to wait for it to
  finish a sentence before replying. This is normal for a v1 and can be
  upgraded later.
- **Latency** — expect ~1.5–2.5s between the customer finishing a sentence
  and hearing the reply, since STT runs on CPU. Faster with a GPU, or by
  switching `WHISPER_MODEL_SIZE` down to `base`/`tiny` (less accurate but
  quicker).
- **No call recording upload wired up yet** — Plivo can record calls, but
  saving the recording file/URL back onto the lead isn't implemented in this
  version (there's a `recording_url` field ready for it in `/calls/ingest`).
- **I could not place a live test call from here** — this code is built
  against Plivo's and edge-tts's documented, current APIs and every module
  imports and runs correctly, but you'll be the first to actually test it
  against a real phone call. Watch the service logs (`/health` endpoint,
  plus your platform's log viewer) the first few times.

## Changing the agent's voice

`TTS_VOICE` in `.env` — try `hi-IN-MadhurNeural` (male) or
`en-IN-NeerjaNeural` (English-first Indian accent). Full list:
```
edge-tts --list-voices | grep -i "hi-IN\|en-IN"
```
