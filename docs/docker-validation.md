# Docker implementation validation — September 25, 2026

Implemented browser microphone streaming into the existing VAD/Whisper/Ollama pipeline.
The desktop Python path still supports host microphone capture. Docker uses browser audio.

Local validation environment: Docker Desktop, Linux amd64 container, CPU inference,
16 available virtual CPUs and approximately 15 GB Docker memory. The image is
`classroom-live:dev`; the container is `classroom-live`; models persist in the
`classroom-models` volume. The local development image is now published as
`jchan314/classroom-live:1.0.0` (also tagged `latest`).

## Docker Hub publication

- Repository: https://hub.docker.com/r/jchan314/classroom-live
- Visibility: public, verified through Docker Hub's unauthenticated API.
- Platform: Linux AMD64.
- Release digest: `sha256:0185ce924b78da566d41fdc2ee69ef241ce346ad9c5410def97046998d2f773c`.
- Both `1.0.0` and `latest` resolve to this digest.
- A pull with an empty Docker sign-in configuration succeeded. This verifies public
  access; it used the existing local layer cache and is not a clean-machine install test.

Passed:

- 22 Python tests, including browser audio ownership, invalid frames, cleanup, final
  phrase retention, live worker behavior, and recording streaming/cancellation.
- Audio resampling checks for 16 kHz, 44.1 kHz, and 48 kHz input.
- Existing Playwright desktop/mobile UI regression checks.
- Real container model initialization and browser-based speech input using a simulated
  microphone with a 12-second excerpt from the project's existing sample.wav.
- Real English transcription and Chinese translation through the live browser path.
- Real Vietnamese translation through the recording-upload path and FFmpeg.

The browser test releases its microphone tracks after stopping. It uses test media;
it does not record the user's physical microphone. Screenshot: tmp/container-browser.png
(local, ignored by Git). The observed live result reported approximately 4.9 seconds
of processing; this is not an end-to-end latency guarantee or a 3-second pass.

Follow-up status (September 27): the public GitHub repository and GitHub Pages
article are available, with embedded demo clips. Three written comments have
been supplied, but Peer 3 describes observing a demo rather than installing the
app independently. The required GUI-only installation evidence and final source
ZIP remain outstanding. See [peer feedback](peer-feedback.md) and the current
[requirements check](submission-checklist.md). A hosted ngrok demo does not
replace peer installations. The test results above are historical; this
documentation update did not rerun application tests or change application behavior.
