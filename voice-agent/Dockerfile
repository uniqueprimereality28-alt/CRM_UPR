FROM python:3.11-slim

WORKDIR /app

# Install ffmpeg and audio dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1
ENV PORT=10000
ENV MALLOC_ARENA_MAX=2
ENV PYTHONMALLOC=malloc
ENV OMP_NUM_THREADS=1
ENV MKL_NUM_THREADS=1
ENV NUMEXPR_NUM_THREADS=1
ENV LIVEKIT_NUM_IDLE_PROCESSES=0

CMD ["python", "run.py"]
