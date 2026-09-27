# Run Classroom Live with Docker Desktop

## Before you start

- Install and open Docker Desktop; wait until its engine is running (Linux containers).
- Have internet access for pulling the image and downloading models on first launch.
- Use a microphone and a current Chrome or Edge browser.
- Start with at least 8 GB available to Docker and 12 GB of free disk space;
  actual resource use and translation speed must be checked on your laptop.
- You do not need Python, FFmpeg, Ollama, API keys, or an edited .env file.

## Install using the GUI

**Docker Hub:** https://hub.docker.com/r/jchan314/classroom-live

**Exact release image:** `jchan314/classroom-live:1.0.0`

The default `latest` tag currently points to the same release. Use `1.0.0` for
consistent peer trial results.

This release is built for Linux AMD64 (Intel/AMD x86-64 computers running Docker
Desktop's Linux containers). Apple Silicon/ARM has not been verified.

1. Open Docker Desktop's Search bar and search for
   **jchan314/classroom-live**.
2. Select tag **1.0.0** and click **Pull**. Wait for the download to finish.
3. Go to **Images**, find the downloaded image, and click **Run**.
4. Expand **Optional settings**. Name the container `classroom-live`.
5. In **Ports**, enter host port **8000** next to container port **8000/tcp**.
   If 8000 is already used, use host port **8001** and open that port instead.
6. No environment variables are required. Click **Run**.
7. Open **http://localhost:8000**. The page shows model preparation progress.
   The first run can take several minutes or longer depending on your connection.
8. When ready, select a language and click **Start listening**. Allow browser
   microphone access. Stop listening to finish; use Export to save your text.

Docker creates storage for /models automatically. Stop and restart the same container
to keep its downloaded models. Deleting the container and its volume can require new downloads.

## If something does not work

- **Preparing models:** keep the container running and internet connected. Inspect its
  **Logs** tab. A failed setup can be retried by restarting the container.
- **No microphone:** allow the browser in Windows/macOS microphone privacy settings,
  then allow the site permission and reload. Use localhost, not an ordinary HTTP LAN address.
- **Another tab is listening:** stop the microphone in that tab before starting another.
- **Slow translation:** close other intensive applications and increase Docker's available
  resources if possible. English and translated text arrive separately; speed varies by CPU.
- **Cannot open the page:** confirm the container is running and the host port is mapped.
- **Out of memory / container exits:** inspect Docker Logs and increase its memory allocation.

## Optional settings (Docker Desktop Run dialog)

| Environment variable | Default | Purpose |
|---|---|---|
| CPU_THREADS | 4 | CPU threads used for speech recognition |
| WHISPER_MODEL | base.en | Speech recognition model; changing it downloads that model |
| OLLAMA_MODEL | qwen2.5:3b | Correction/translation model; changing it downloads that model |

Use the defaults for the assessed peer test. Keep container port 8000 unchanged.

## Privacy and assignment scope

Each peer runs their own container; speech processing happens on that laptop. Model
downloads need internet. An ngrok URL is an optional hosted demo and does not replace
installing the image on each peer's own laptop. The app has a shared live session within
each container, so do not use one container for independent simultaneous users.
