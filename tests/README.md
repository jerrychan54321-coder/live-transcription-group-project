Run the recording event tests from the project root:

```text
python -m unittest discover -s tests -v
```

The suite also checks browser-audio protocol validation, single-microphone ownership,
disconnect cleanup, and final-phrase flushing without loading speech models.
Run `node tests/audio-worklet.cjs` to check streaming resampling at 16, 44.1, and 48 kHz.

With a running Docker container, Playwright, and Edge installed, set TEST_AUDIO_FILE
to a short English speech WAV and run `node tests/container-browser.cjs`.
It uses a simulated browser microphone to exercise real VAD, Whisper and Chinese
translation, then uploads the same recording for Vietnamese translation. It checks
microphone cleanup and saves a screenshot under tmp/. It does not test the physical
microphone permission dialog; that still needs a human check.

Run the browser regression checks with Node.js, Playwright, and Microsoft Edge available:

```text
node tests/ui.cjs
```

If Playwright is installed outside this project, set NODE_PATH to its node_modules directory first. The browser test starts an ephemeral local HTTP server and simulates streamed recording responses and live WebSocket messages. It checks result and language isolation, progress, timestamps and exports, failure/retry, empty audio, persistent stop controls, mobile overflow, keyboard navigation, and safe text rendering. Desktop and mobile screenshots are written here and ignored by Git.

These checks do not exercise real microphone capture, Whisper, FFmpeg, or Ollama. For an end-to-end check, start the application in its configured Python environment, begin live listening, and upload a recording with a different language in the recording tab. Verify independent results and exports, recording time ranges, progress stages, and stopping the microphone from the recording tab.

The upload endpoint accepts a request-local `language` form field and returns newline-delimited JSON (`application/x-ndjson`). After preparation and transcription `status` events, a `transcript` event contains all draft English paragraphs, timestamps, and stable `segment_id` values. Each `translating` event marks the active paragraph before its model call; the corresponding `segment` event updates that paragraph with corrected English and translation. The stream ends with `complete`, `error`, or `stopped`. Upload processing runs outside the live event loop. Restart an existing server and reload the browser to use the matching backend and frontend.

Draft English is explicitly marked uncorrected. Translation failure or cancellation retains the entire draft transcript and completed translations, including in exports. Browser checks hold back the first translation to verify that draft paragraphs are already visible, then verify that results update the same DOM elements without duplication. They also check draft retention and terminal translation labels after failure and cancellation.

Recording mode defaults to Transcription + translation (`mode=translate`). Transcription only (`mode=transcribe`) skips Ollama entirely, hides translation settings and output, and exports English marked transcribed with automatic correction not applied. Retry preserves the original job's mode. In both modes, `transcript_segment` events stream growing paragraphs during recognition, updating stable paragraph IDs and time ranges; `processed_s` and `duration_s` describe audio position rather than estimated time remaining. Empty recognized segments emit `transcription_progress`. Speech segments are consumed lazily, so each update is sent before the next segment is requested. Preparation still finishes before recognition begins, and recognition updates can arrive in bursts. Translation starts after the entire transcription, retaining neighboring passage context. Stop or recognition failure preserves already displayed English.

Recording controls: select a file, choose Auto/30/60/120/custom (15–300 seconds), then Start transcription. Translation passages merge speech segments near sentence boundaries and include neighboring context. Auto targets 60 seconds. A long sentence can be split after 1.5 times the target to bound passage size.

The frontend creates a job with POST /api/recording_jobs before uploading. The upload includes job_id and segment_seconds. POST /api/recording_jobs/{job_id}/stop signals the worker; it emits stopped after acknowledging cancellation. Cancellation is cooperative: normalization or a model operation already running must return before acknowledgment. No later passage starts, and completed results remain exportable. Discard is separate from Stop.

The API cancellation tests run in the configured application Python environment with fake inference engines. They verify cancellation before upload, cancellation during translation, completed-result retention, and job cleanup without starting real speech models.
