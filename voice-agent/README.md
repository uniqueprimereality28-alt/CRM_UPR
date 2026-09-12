# Unique Prime Reality - AI Outbound Calling Agent

Real-time AI telecalling service for Unique Prime Reality CRM (`CRM_UPR`).
Powered by **LiveKit Cloud**, **Vobiz SIP Trunk**, **Deepgram STT**, **Grok (xAI) LLM**, and **Sarvam AI TTS**.

---

## Architecture Highlights

1. **Telephony**: Outbound calls dialed via your **Vobiz SIP trunk** managed by LiveKit Cloud.
2. **STT**: **Deepgram Nova-3** for ultra-low latency transcription of Indian speech (Hindi & English).
3. **LLM Brain**: **Grok (xAI)** for natural, intelligent Gurgaon real estate conversations.
4. **TTS Voice**: **Sarvam AI** with natural Indian accents (*Meera*, *Arvind*, etc.).
5. **Zero VPS Needed**: The worker connects outbound over WebSockets to LiveKit Cloud. It requires **no static IP, no open ports, and no Linux VPS**.

---

## Step 1: Set Up Telephony (Vobiz + LiveKit Cloud)

1. **Sign up for LiveKit Cloud**:
   - Go to [cloud.livekit.io](https://cloud.livekit.io) and create a free project.
   - Note your `LIVEKIT_URL` (`wss://...`), `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` from **Settings → Keys**.

2. **Configure Vobiz Outbound SIP Trunk in LiveKit**:
   - In LiveKit Cloud console, navigate to **SIP → Outbound Trunks**.
   - Click **Create Outbound Trunk**.
   - Enter your **Vobiz SIP credentials**:
     - **Address / Domain**: Your Vobiz SIP server address (e.g. `sip.vobiz.ai` or your carrier domain).
     - **Transport**: UDP or TLS.
     - **Username & Password**: Your Vobiz SIP trunk credentials.
     - **Caller ID**: Your registered Vobiz caller phone number.
   - Save the trunk. LiveKit will give you an **Outbound Trunk ID** starting with `ST_...` (e.g. `ST_abc123xyz`).
   - Add this as `VOBIZ_SIP_TRUNK_ID` in your `.env`.

---

## Step 2: Get Your AI API Keys

- **Deepgram** (STT): Get a key at [console.deepgram.com](https://console.deepgram.com)
- **Grok / xAI** (LLM): Get a key at [console.x.ai](https://console.x.ai)
- **Sarvam AI** (TTS): Get an API subscription key at [sarvam.ai](https://www.sarvam.ai)

---

## Step 3: Deployment (Zero VPS Required!)

### Option A: Deploy on Railway (Recommended — Already hosts your CRM!)

Since your CRM (`backend/` and `frontend/`) is already running on Railway:

1. Open your existing **Railway Project**.
2. Click **+ New** → **GitHub Repo** → select `CRM_UPR`.
3. In the new service settings:
   - Go to **Settings** → **Root Directory** → set to `/voice-agent`.
   - Railway will automatically detect the `Dockerfile` and build it.
4. Go to the **Variables** tab and set:
   ```env
   LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_API_KEY=your-livekit-api-key
   LIVEKIT_API_SECRET=your-livekit-api-secret
   LIVEKIT_AGENT_NAME=upr-calling-agent
   VOBIZ_SIP_TRUNK_ID=ST_your_trunk_id
   DEEPGRAM_API_KEY=your-deepgram-key
   GROK_API_KEY=your-grok-key
   SARVAM_API_KEY=your-sarvam-key
   CRM_BACKEND_URL=https://your-crm-backend.up.railway.app
   VOICE_AGENT_SHARED_SECRET=your-secure-secret
   ```
5. Deploy! The worker is now running 24/7 in the cloud without needing a VPS.

---

### Option B: Run Locally on your Windows PC (Free, Zero Setup!)

You can also run the calling worker right on your computer during office hours:

```powershell
cd voice-agent
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Edit .env with your keys
python agent.py start
```

Whenever you click **Initiate Call** in the CRM, LiveKit Cloud routes the call through your running agent instantly.

---

## CRM Integration & Scoring Sync

When the call concludes:
1. The agent uses Grok to extract customer requirement signals:
   - Budget, BHK, location preference, timeline
   - High-intent signals: `wants_site_visit`, `whatsapp_details`, `urgent_30_days`, `investor_intent`
   - Negative signals: `not_interested`, `wrong_number`
2. The agent POSTs the call data back to `CRM_BACKEND_URL/api/ai/calls/ingest`.
3. The CRM's scoring engine calculates the intent score, marks the lead as `Hot`, `Warm`, or `Cold`, and creates follow-ups/transfers for your sales team.
