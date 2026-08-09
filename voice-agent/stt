"""
Speech-to-text using faster-whisper — runs locally, completely free,
no API key, decent accuracy on Hindi/English code-mixed speech at the
'small' model size on CPU.
"""
import io
import logging
import wave

from faster_whisper import WhisperModel

import config

logger = logging.getLogger("voice-agent.stt")

_model: WhisperModel | None = None


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        logger.info(f"Loading faster-whisper model '{config.WHISPER_MODEL_SIZE}' "
                    f"on {config.WHISPER_DEVICE} ({config.WHISPER_COMPUTE_TYPE})...")
        _model = WhisperModel(
            config.WHISPER_MODEL_SIZE,
            device=config.WHISPER_DEVICE,
            compute_type=config.WHISPER_COMPUTE_TYPE,
        )
        logger.info("faster-whisper model loaded.")
    return _model


def _pcm16_to_wav_bytes(pcm16_bytes: bytes, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16_bytes)
    return buf.getvalue()


def transcribe_pcm16(pcm16_bytes: bytes, sample_rate: int = 16000) -> str:
    """Transcribe raw PCM16 mono audio. Returns the recognized text (may be empty)."""
    if not pcm16_bytes or len(pcm16_bytes) < 3200:  # < ~0.1s of audio, not worth it
        return ""
    wav_bytes = _pcm16_to_wav_bytes(pcm16_bytes, sample_rate)
    model = get_model()
    segments, _info = model.transcribe(
        io.BytesIO(wav_bytes),
        language=None,  # auto-detect — handles Hindi/English code-mixing better than forcing "hi"
        vad_filter=True,
        beam_size=1,  # fast, good enough for phone-quality audio
    )
    text = " ".join(seg.text.strip() for seg in segments).strip()
    return text
