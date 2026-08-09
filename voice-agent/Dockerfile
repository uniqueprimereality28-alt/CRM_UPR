# Render deploys this natively as a "Docker" web service.
# Docker (not Render's native Python buildpack) is used deliberately here
# because this service needs `ffmpeg` installed at the OS level (for
# decoding edge-tts's MP3 output) — Render's native Python environment
# doesn't give you apt-get access, Docker does.
FROM python:3.12-slim

# ffmpeg: required by pydub to decode TTS audio.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render sets $PORT itself; default to 8100 for local runs.
ENV PORT=8100
EXPOSE 8100

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
