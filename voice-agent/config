"""
Central config for the voice-agent microservice.
Everything is read from environment variables — see .env.example.
"""
import os

# --- Public URL of THIS service (must be reachable from the internet so
# Plivo can call it). Set this after you deploy, e.g. your Render URL. ---
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")

# --- Plivo (telephony) ---
PLIVO_AUTH_ID = os.environ.get("PLIVO_AUTH_ID", "")
PLIVO_AUTH_TOKEN = os.environ.get("PLIVO_AUTH_TOKEN", "")
PLIVO_FROM_NUMBER = os.environ.get("PLIVO_FROM_NUMBER", "")  # your Plivo caller-ID number

# --- Shared secret with the CRM backend (must match VOICE_AGENT_SHARED_SECRET there) ---
VOICE_AGENT_SHARED_SECRET = os.environ.get("VOICE_AGENT_SHARED_SECRET", "")

# --- CRM backend base URL (where /api/ai/calls/ingest lives) ---
CRM_BACKEND_URL = os.environ.get("CRM_BACKEND_URL", "").rstrip("/")

# --- LLM (conversation brain). Any OpenAI-compatible endpoint works. ---
# Groq's free tier (fast, generous limits) is the default recommendation.
LLM_API_BASE = os.environ.get("LLM_API_BASE", "https://api.groq.com/openai/v1")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "llama-3.3-70b-versatile")

# --- STT (faster-whisper, fully local/free — no API key needed) ---
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "small")  # tiny|base|small|medium
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

# --- TTS (edge-tts — free, no API key, good Hindi/Hinglish neural voices) ---
TTS_VOICE = os.environ.get("TTS_VOICE", "hi-IN-SwaraNeural")  # try hi-IN-MadhurNeural for male

# --- Conversation tuning ---
MAX_TURNS = int(os.environ.get("MAX_TURNS", "14"))
SILENCE_MS_TO_END_TURN = int(os.environ.get("SILENCE_MS_TO_END_TURN", "700"))
MAX_CALL_SECONDS = int(os.environ.get("MAX_CALL_SECONDS", "300"))

# --- Human transfer target (for logging/consistency with the CRM side) ---
TRANSFER_TARGET_NAME = os.environ.get("TRANSFER_TARGET_NAME", "Vranda Aggarwal")
TRANSFER_TARGET_NUMBER = os.environ.get("TRANSFER_TARGET_NUMBER", "7351735035")
