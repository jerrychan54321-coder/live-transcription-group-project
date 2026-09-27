# syntax=docker/dockerfile:1
# One image is intentional: peers only need Docker Desktop's Pull and Run buttons.
FROM ollama/ollama:latest
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv ffmpeg ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    AUDIO_SOURCE=browser APP_HOST=0.0.0.0 PORT=8000 \
    OLLAMA_HOST=127.0.0.1:11434 OLLAMA_URL=http://127.0.0.1:11434 \
    OLLAMA_MODEL=qwen2.5:3b WHISPER_MODEL=base.en CPU_THREADS=4 \
    AUTO_PULL_MODELS=1 OLLAMA_MODELS=/models/ollama HF_HOME=/models/huggingface \
    OLLAMA_KEEP_ALIVE=10m
COPY requirements.txt /app/requirements.txt
# CPU wheels avoid installing unnecessary CUDA dependencies for Python inference.
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
COPY main.py /app/main.py
COPY pipeline /app/pipeline
COPY static /app/static
COPY docker /app/docker
RUN sed -i 's/\r$//' /app/docker/start.sh && chmod +x /app/docker/start.sh \
    && mkdir -p /models
VOLUME ["/models"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30m --retries=3 \
    CMD python -c "import json,urllib.request; s=json.load(urllib.request.urlopen('http://127.0.0.1:8000/api/health')); exit(0 if s['ready'] else 1)"
ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/start.sh"]
