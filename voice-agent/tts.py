"""
Text-to-speech. Two providers, same public function signature so
call_session.py never needs to know which one is active:

  synthesize_to_pcm16(text, voice=None) -> (PCM16 mono bytes, sample_rate)

- "sarvam"  -> Sarvam Bulbul v3. Best quality for natural Hinglish delivery
               (code-mixed Hindi/English in one sentence, no accent-switch
               glitch). Paid per character, but very cheap and new accounts
               get free credits — see config.SARVAM_API_KEY.
- "edge"    -> edge-tts. Free, no key, used as a fallback/dev option.

Switch providers via config.TTS_PROVIDER (env var TTS_PROVIDER=sarvam|edge).
"""
import base64
import io
import logging

import edge_tts
import httpx

import config
from audio import mp3_bytes_to_pcm16, wav_bytes_to_pcm16

logger = logging.getLogger("voice-agent.tts")

SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"


async def _synthesize_sarvam(text: str, speaker: str | None = None) -> tuple[bytes, int]:
    if not config.SARVAM_API_KEY:
        raise RuntimeError("SARVAM_API_KEY is not set — see .env.example")
    body = {
        "text": text,
        "target_language_code": config.SARVAM_LANGUAGE,
        "model": config.SARVAM_MODEL,
        "speaker": speaker or config.SARVAM_SPEAKER,
        "speech_sample_rate": config.SARVAM_SAMPLE_RATE,
        "enable_preprocessing": True,  # better handling of numbers like "2 BHK", "90 lakh"
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            SARVAM_TTS_URL,
            json=body,
            headers={
                "api-subscription-key": config.SARVAM_API_KEY,
                "Content-Type": "application/json",
            },
        )
        resp.raise_for_status()
        data = resp.json()
    audios = data.get("audios") or []
    if not audios:
        raise RuntimeError(f"Sarvam TTS returned no audio: {data}")
    wav_bytes = base64.b64decode(audios[0])
    return wav_bytes_to_pcm16(wav_bytes)


async def _synthesize_edge(text: str, voice: str | None = None) -> tuple[bytes, int]:
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


async def synthesize_to_pcm16(text: str, voice: str | None = None) -> tuple[bytes, int]:
    """Text -> (PCM16 mono bytes, sample_rate). Raises on empty text."""
    if not text.strip():
        raise ValueError("Cannot synthesize empty text")

    if config.TTS_PROVIDER == "sarvam":
        try:
            return await _synthesize_sarvam(text, speaker=voice)
        except Exception as e:
            logger.warning(f"Sarvam TTS failed ({e}), falling back to edge-tts for this line")
            return await _synthesize_edge(text)

    return await _synthesize_edge(text, voice=voice)
