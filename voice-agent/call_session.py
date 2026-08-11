"""
Manages ONE live phone call: buffers incoming caller audio, detects when
the customer has finished speaking (VAD-based turn-taking), runs
STT -> LLM -> TTS, and streams the reply audio back to Plivo over the
same WebSocket.
"""
import asyncio
import json
import logging
import time

import webrtcvad

import config
import stt
import tts
import llm
from audio import mulaw_b64_to_pcm16, pcm16_8k_to_16k, pcm16_to_mulaw_b64, chunk_bytes

logger = logging.getLogger("voice-agent.session")

FRAME_MS = 20
FRAME_BYTES_PCM16_8K = 320  # 20ms * 8000Hz * 2 bytes
SILENCE_FRAMES_TO_END_TURN = max(1, config.SILENCE_MS_TO_END_TURN // FRAME_MS)
MIN_SPEECH_FRAMES = 4  # ignore tiny blips (<80ms) so we don't transcribe noise


class CallSession:
    def __init__(self, stream_id: str, call_context: dict):
        self.stream_id = stream_id
        self.lead = call_context.get("lead", {})
        self.agent = call_context.get("agent", {})
        self.inventory = call_context.get("inventory", [])
        self.prior_summary = call_context.get("prior_summary")
        self.on_finished_callback = call_context.get("on_finished")

        self.vad = webrtcvad.Vad(2)  # 0-3, higher = more aggressive filtering
        self._speech_buf = bytearray()
        self._in_speech = False
        self._silence_run = 0
        self._speech_frame_count = 0

        self.history: list[dict] = []
        self.turn_count = 0
        self.started_at = time.time()
        self.agent_speaking = False
        self.ended = False

    # ---------------- Turn-taking on incoming audio ----------------
    async def handle_inbound_frame(self, ws, mulaw_payload_b64: str):
        if self.agent_speaking or self.ended:
            return  # simple half-duplex: ignore caller audio while we're talking
        if time.time() - self.started_at > config.MAX_CALL_SECONDS:
            await self.end_call(ws, reason="max_duration")
            return

        pcm16_8k = mulaw_b64_to_pcm16(mulaw_payload_b64)
        # webrtcvad needs exact 10/20/30ms frames; pad/trim defensively
        if len(pcm16_8k) != FRAME_BYTES_PCM16_8K:
            return

        is_speech = self.vad.is_speech(pcm16_8k, sample_rate=8000)

        if is_speech:
            self._speech_buf.extend(pcm16_8k)
            self._in_speech = True
            self._silence_run = 0
            self._speech_frame_count += 1
        elif self._in_speech:
            self._silence_run += 1
            self._speech_buf.extend(pcm16_8k)  # keep a little trailing audio, sounds natural
            if self._silence_run >= SILENCE_FRAMES_TO_END_TURN:
                await self._finalize_turn(ws)

    async def _finalize_turn(self, ws):
        buf = bytes(self._speech_buf)
        had_enough_speech = self._speech_frame_count >= MIN_SPEECH_FRAMES
        self._speech_buf = bytearray()
        self._in_speech = False
        self._silence_run = 0
        self._speech_frame_count = 0

        if not had_enough_speech:
            return

        pcm16_16k = pcm16_8k_to_16k(buf)
        text = await asyncio.get_event_loop().run_in_executor(
            None, stt.transcribe_pcm16, pcm16_16k, 16000
        )
        if not text:
            return

        self.history.append({"speaker": "customer", "text": text})
        logger.info(f"[{self.stream_id}] customer: {text}")
        await self._respond(ws, text)

    # ---------------- Agent speaking ----------------
    async def speak_opening_line(self, ws):
        line = await llm.opening_line(self.agent)
        self.history.append({"speaker": "agent", "text": line})
        logger.info(f"[{self.stream_id}] agent (opening): {line}")
        await self._send_tts(ws, line)

    async def _respond(self, ws, customer_text: str):
        self.turn_count += 1
        reply = await llm.live_turn(self.agent, self.lead, self.inventory,
                                    self.history[:-1], customer_text, self.prior_summary)
        self.history.append({"speaker": "agent", "text": reply})
        logger.info(f"[{self.stream_id}] agent: {reply}")
        await self._send_tts(ws, reply)

        ended_call = any(w in reply.lower() for w in
                         ["dhanyavaad", "thank you for your time", "have a good day",
                          "shubh din", "aapka din shubh"])
        if self.turn_count >= config.MAX_TURNS or ended_call:
            await self.end_call(ws, reason="natural_end")

    async def _send_tts(self, ws, text: str):
        self.agent_speaking = True
        try:
            pcm16, rate = await tts.synthesize_to_pcm16(text)
            for chunk in chunk_bytes(pcm16, FRAME_BYTES_PCM16_8K if rate == 8000 else FRAME_BYTES_PCM16_8K * (rate // 8000)):
                payload_b64 = pcm16_to_mulaw_b64(chunk, src_rate=rate)
                await ws.send_text(json.dumps({
                    "event": "playAudio",
                    "media": {"contentType": "audio/x-mulaw", "sampleRate": 8000, "payload": payload_b64},
                }))
                await asyncio.sleep(FRAME_MS / 1000 * 0.9)  # pace playback ~real-time
        except Exception as e:
            logger.error(f"[{self.stream_id}] TTS/send failed: {e}")
        finally:
            self.agent_speaking = False

    # ---------------- End of call ----------------
    async def end_call(self, ws, reason: str = "unknown"):
        if self.ended:
            return
        self.ended = True
        logger.info(f"[{self.stream_id}] call ending ({reason}), {len(self.history)} turns")
        try:
            await ws.send_text(json.dumps({"event": "clearAudio"}))
        except Exception:
            pass
        if self.on_finished_callback:
            await self.on_finished_callback(self)
