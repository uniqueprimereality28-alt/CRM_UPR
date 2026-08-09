"""
Audio format helpers.

Plivo's Media Streams send/receive 8kHz mono mu-law (a telephony codec),
base64-encoded, in 20ms frames (160 bytes each).

faster-whisper wants 16-bit PCM, ideally 16kHz.
edge-tts produces MP3 (usually 24kHz).

This module converts between all of these using Python's stdlib `audioop`
(no external audio library needed) plus `pydub`/`ffmpeg` for MP3 decoding.
"""
import audioop
import base64
import io

from pydub import AudioSegment

MULAW_SAMPLE_RATE = 8000
WHISPER_SAMPLE_RATE = 16000


def mulaw_b64_to_pcm16(payload_b64: str) -> bytes:
    """Plivo media event payload (base64 mu-law 8kHz) -> raw PCM16 8kHz bytes."""
    mulaw_bytes = base64.b64decode(payload_b64)
    return audioop.ulaw2lin(mulaw_bytes, 2)  # 2 = 16-bit samples


def pcm16_8k_to_16k(pcm16_8k: bytes) -> bytes:
    """Upsample PCM16 8kHz -> PCM16 16kHz for faster-whisper."""
    converted, _ = audioop.ratecv(pcm16_8k, 2, 1, MULAW_SAMPLE_RATE, WHISPER_SAMPLE_RATE, None)
    return converted


def pcm16_to_mulaw_b64(pcm16_bytes: bytes, src_rate: int) -> str:
    """Any PCM16 mono bytes -> 8kHz mu-law, base64-encoded, ready to send to Plivo."""
    if src_rate != MULAW_SAMPLE_RATE:
        pcm16_bytes, _ = audioop.ratecv(pcm16_bytes, 2, 1, src_rate, MULAW_SAMPLE_RATE, None)
    mulaw_bytes = audioop.lin2ulaw(pcm16_bytes, 2)
    return base64.b64encode(mulaw_bytes).decode("ascii")


def mp3_bytes_to_pcm16(mp3_bytes: bytes) -> tuple[bytes, int]:
    """Decode MP3 (edge-tts output) -> (PCM16 mono bytes, sample_rate). Requires ffmpeg."""
    seg = AudioSegment.from_file(io.BytesIO(mp3_bytes), format="mp3")
    seg = seg.set_channels(1).set_sample_width(2)  # mono, 16-bit
    return seg.raw_data, seg.frame_rate


def chunk_bytes(data: bytes, chunk_size: int):
    for i in range(0, len(data), chunk_size):
        yield data[i:i + chunk_size]
