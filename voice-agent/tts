"""
Text-to-speech using edge-tts — a free wrapper around Microsoft Edge's
neural TTS. No API key, no cost, good quality Hindi/Hinglish voices.

Good voice options for this use case (formal Hinglish, Indian female):
  hi-IN-SwaraNeural   -> female, warm, most natural for Hinglish
  hi-IN-MadhurNeural  -> male
  en-IN-NeerjaNeural  -> female, English-first Indian accent

Swap TTS_VOICE in config.py / .env to change the agent's voice.
"""
import io
import logging

import edge_tts

import config
from audio import mp3_bytes_to_pcm16

logger = logging.getLogger("voice-agent.tts")


async def synthesize_to_pcm16(text: str, voice: str | None = None) -> tuple[bytes, int]:
    """Text -> (PCM16 mono bytes, sample_rate). Raises on empty text."""
    if not text.strip():
        raise ValueError("Cannot synthesize empty text")
    voice = voice or config.TTS_VOICE
    communicate = edge_tts.Communicate(text, voice)
    mp3_buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            mp3_buf.write(chunk["data"])
    mp3_bytes = mp3_buf.getvalue()
    if not mp3_bytes:
        raise RuntimeError("edge-tts returned no audio — check network access / voice name")
    return mp3_bytes_to_pcm16(mp3_bytes)
