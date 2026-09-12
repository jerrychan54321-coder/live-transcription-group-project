Run the recording event tests from the project root:

```text
python -m unittest discover -s tests -v
```

Run the browser regression checks with Node.js, Playwright, and Microsoft Edge available:

```text
node tests/ui.cjs
```

If Playwright is installed outside this project, set NODE_PATH to its node_modules directory first. The browser test starts an ephemeral local HTTP server and simulates streamed recording responses and live WebSocket messages. It checks result and language isolation, progress, timestamps and exports, failure/retry, empty audio, persistent stop controls, mobile overflow, keyboard navigation, and safe text rendering. Desktop and mobile screenshots are written here and ignored by Git.

These checks do not exercise real microphone capture, Whisper, FFmpeg, or Ollama. For an end-to-end check, start the application in its configured Python environment, begin live listening, and upload a recording with a different language in the recording tab. Verify independent results and exports, recording time ranges, progress stages, and stopping the microphone from the recording tab.

The upload endpoint now accepts a request-local `language` form field and returns newline-delimited JSON (`application/x-ndjson`): `status`, `segment`, then `complete` or `error` events. Upload processing runs outside the live event loop. Restart an existing server and reload the browser to use the matching backend and frontend.

Recording controls: select a file, choose Auto/30/60/120/custom (15–300 seconds), then Start transcription. Translation passages merge speech segments near sentence boundaries and include neighboring context. Auto targets 60 seconds. A long sentence can be split after 1.5 times the target to bound passage size.

The frontend creates a job with POST /api/recording_jobs before uploading. The upload includes job_id and segment_seconds. POST /api/recording_jobs/{job_id}/stop signals the worker; it emits stopped after acknowledging cancellation. Cancellation is cooperative: normalization or a model operation already running must return before acknowledgment. No later passage starts, and completed results remain exportable. Discard is separate from Stop.

The API cancellation tests run in the configured application Python environment with fake inference engines. They verify cancellation before upload, cancellation during translation, completed-result retention, and job cleanup without starting real speech models.
