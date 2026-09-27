# Docker development

Run these commands from the project root (the folder containing Dockerfile):

```powershell
docker build -t classroom-live:dev .
docker run -d --name classroom-live --stop-timeout 30 -p 127.0.0.1:8000:8000 -v classroom-models:/models classroom-live:dev
```

Open http://localhost:8000. Model preparation appears in the page and may take several
minutes on first launch. Docker Desktop's Logs tab contains diagnostic details.
The named volume saves downloads across container replacement. Stop/start the container
in Docker Desktop. A CPU-only runtime is the default; no GPU or host Ollama is needed.

Alternatively, `docker compose up --build -d` builds and starts the same single service.
Do not start both methods on the same host port simultaneously.

## Release

Docker Hub repository: https://hub.docker.com/r/jchan314/classroom-live

Peer installation image: `jchan314/classroom-live:1.0.0`.
The `latest` tag currently points to the same image. Public access was verified
with an anonymous pull; see [validation notes](../docs/docker-validation.md).
The local development image remains `classroom-live:dev`.
For future releases, choose a new version tag after testing and signing in:

```powershell
docker tag classroom-live:dev jchan314/classroom-live:NEW_VERSION
docker push jchan314/classroom-live:NEW_VERSION
```

Replace NEW_VERSION with the next release number and update SETUP.md to match.
This build targets the builder's CPU architecture. Test on the intended peer hardware;
do not claim Apple Silicon/ARM support from an x86-only build.

## Model and process design

The image contains both Ollama and FastAPI to support the assignment's one-image GUI flow.
Tini and the startup script forward shutdown and stop the container if either process exits.
Ollama is internal to the container; only the app's port is published.
Qwen and Whisper download automatically to /models. Internet is required for the first run.
Subsequent launches reuse that volume. The default model setup still checks the Ollama
registry, so fully offline startup is not claimed.

The UI polls /api/health while setup runs in the background. Model failures remain visible;
restart after fixing connectivity or storage problems to retry initialization.

## Optional ngrok demo

A tunnel is an additional hosted demonstration, not the assignment's peer installation test.
This application has one shared live transcript and one active microphone per instance.
It does not provide private multi-user sessions or authentication. Use a restricted,
supervised demo for one tester at a time, not an unrestricted public service.
No tunnel is started by the Docker files. Audio sent through a tunnel is processed on the
container host, unlike the peer-local installation.
