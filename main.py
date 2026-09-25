import asyncio
import json
import uuid
import os
import queue
import shutil
import sys
import tempfile
import threading
import time

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
from typing import List, Set
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import numpy as np
from pydantic import BaseModel
import uvicorn

from pipeline.corrector_translator import CorrectorTranslator
from pipeline.media_normalizer import MediaNormalizer
from pipeline.stt import SpeechToTextTranscriber
from pipeline.vad import VADAudioStreamer
from pipeline.recording import recording_events
from starlette.background import BackgroundTask

# Initialize FastAPI App
app = FastAPI(
    title="Live Bilingual Classroom Translation",
    description="100% Local Real-time Transcription, Correction & Translation Pipeline",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RevalidatingStaticFiles(StaticFiles):
    """Always validate local UI assets after a page reload."""
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


# Mount Static Assets
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", RevalidatingStaticFiles(directory=static_dir), name="static")

# Pipeline Global Singletons
vad_streamer: VADAudioStreamer = None
stt_engine: SpeechToTextTranscriber = None
llm_engine: CorrectorTranslator = None

active_language = "Chinese"
session_started_at = None
active_device_index = None
connected_websockets: Set[WebSocket] = set()
event_loop = None

stt_thread = None
llm_thread = None
is_pipeline_active = False
# Text-only backlog: a slow translator must never block speech recognition.
stt_results_queue: queue.Queue = queue.Queue()


class LanguagePayload(BaseModel):
    language: str


class DevicePayload(BaseModel):
    device_index: int


async def broadcast_ws(message: dict):
    """Sends JSON message to all currently connected WebSocket clients."""
    disconnected = set()
    for ws in list(connected_websockets):
        try:
            await ws.send_json(message)
        except Exception:
            disconnected.add(ws)
    for ws in disconnected:
        connected_websockets.discard(ws)


def _on_audio_level(rms: float, is_speech: bool):
    """Called from VAD thread; schedules a WebSocket audio_level broadcast on the async event loop."""
    if event_loop and event_loop.is_running():
        asyncio.run_coroutine_threadsafe(
            broadcast_ws({"type": "audio_level", "level": rms, "is_speech": is_speech}),
            event_loop,
        )


def live_status(stage, active, error=None):
    if event_loop and event_loop.is_running():
        asyncio.run_coroutine_threadsafe(broadcast_ws({
            "type": "live_status", "stage": stage, "active": active, "error": error
        }), event_loop)


def send_live(message):
    if event_loop and event_loop.is_running():
        asyncio.run_coroutine_threadsafe(broadcast_ws(message), event_loop)


def _stt_worker():
    """Thread 1: Retrieves VAD speech chunks, runs Whisper, and pushes text to stt_results_queue.

    Decoupled from LLM so transcription of the next chunk begins while Ollama
    is still processing the previous one (pipeline parallelism).
    """
    global is_pipeline_active
    print("[STT Worker] Speech-to-text thread started.")

    while is_pipeline_active:
        if vad_streamer is None or not vad_streamer._is_running:
            time.sleep(0.1)
            continue

        chunk = vad_streamer.get_speech_chunk(timeout=0.2)
        if chunk is None or len(chunk) == 0:
            continue

        try:
            elapsed = max(0, time.time() - session_started_at) if session_started_at else 0
            live_status("Transcribing", True)
            stt_result = stt_engine.transcribe(chunk)
            stt_result["elapsed_s"] = round(elapsed, 2)
            raw_text = stt_result["text"].strip()
            if raw_text and len(raw_text) >= 2:
                stt_result["segment_id"] = uuid.uuid4().hex
                stt_result["language"] = active_language
                send_live({
                    "type": "live_transcript", "source": "live",
                    "segment_id": stt_result["segment_id"],
                    "language": stt_result["language"], "original": raw_text,
                    "elapsed_s": stt_result["elapsed_s"],
                    "stt_latency_ms": stt_result["latency_ms"],
                })
                stt_results_queue.put((raw_text, stt_result))
        except Exception as e:
            print(f"[STT Worker Error] {e}")
            live_status("Transcribing", False, "Speech transcription failed. Please try again.")
        finally:
            live_status("Transcribing", False)


def _llm_worker():
    """Thread 2: Takes STT text from stt_results_queue, runs Ollama correction/translation,

    and broadcasts the final result via WebSocket. Runs concurrently with _stt_worker.
    """
    global is_pipeline_active
    print("[LLM Worker] Correction and translation thread started.")

    while is_pipeline_active:
        try:
            raw_text, stt_result = stt_results_queue.get(timeout=0.2)
        except queue.Empty:
            continue

        try:
            # Joint correction and translation via Ollama Qwen 2.5
            # Snapshot the target before inference so a UI language switch cannot mislabel this result.
            result_language = stt_result["language"]
            live_status("Translating", True)
            llm_result = llm_engine.process(raw_text, target_language=result_language)
            if llm_result.get("error"):
                live_status("Translating", True, llm_result["error"])

            total_latency = round(
                stt_result["latency_ms"] + llm_result["latency_ms"] + 10.0, 1
            )

            payload = {
                "type": "result",
                "source": "live",
                "segment_id": stt_result["segment_id"],
                "translationState": "failed" if llm_result.get("error") else "complete",
                "error": llm_result.get("error"),
                "elapsed_s": stt_result.get("elapsed_s", 0),
                "language": result_language,
                "original": llm_result["original"],
                "corrected": llm_result["corrected"],
                "translated": llm_result["translated"],
                "errors_corrected": llm_result.get("errors_corrected", []),
                "duration_s": stt_result["duration_s"],
                "stt_latency_ms": stt_result["latency_ms"],
                "llm_latency_ms": llm_result["latency_ms"],
                "vad_latency_ms": 10.0,
                "total_latency_ms": total_latency,
            }

            print(
                f"[Pipeline] Processed in {total_latency}ms | '{raw_text}' -> '{llm_result['corrected']}'"
            )

            if event_loop and event_loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    broadcast_ws(payload), event_loop
                )
        except Exception as e:
            print(f"[LLM Worker Error] {e}")
            send_live({"type": "result", "source": "live",
                       "segment_id": stt_result["segment_id"],
                       "original": raw_text, "language": stt_result["language"],
                       "elapsed_s": stt_result.get("elapsed_s", 0),
                       "translationState": "failed", "error": "Translation failed"})
            live_status("Translating", False, "Translation failed. Please try again.")
        finally:
            live_status("Translating", False)


@app.on_event("startup")
async def startup_event():
    global vad_streamer, stt_engine, llm_engine, stt_thread, llm_thread, is_pipeline_active, event_loop
    event_loop = asyncio.get_running_loop()

    print("[Startup] Initializing models and engines...")
    stt_engine = SpeechToTextTranscriber(
        model_size="base.en", device="cpu", compute_type="int8", cpu_threads=6
    )
    llm_engine = CorrectorTranslator(
        model_name="qwen2.5:3b", ollama_url="http://localhost:11434"
    )
    vad_streamer = VADAudioStreamer(device_index=None, level_callback=_on_audio_level)

    is_pipeline_active = True
    stt_thread = threading.Thread(target=_stt_worker, daemon=True)
    llm_thread = threading.Thread(target=_llm_worker, daemon=True)
    stt_thread.start()
    llm_thread.start()
    print("[Startup] System ready on http://localhost:8000")


@app.get("/")
async def get_index():
    index_file = os.path.join(static_dir, "index.html")
    return FileResponse(index_file, headers={"Cache-Control": "no-cache"})


@app.get("/api/devices")
async def list_devices():
    devices = VADAudioStreamer.get_audio_devices()
    return {"devices": devices, "selected": active_device_index}


@app.post("/api/set_device")
async def set_audio_device(payload: DevicePayload):
    global active_device_index, vad_streamer
    active_device_index = payload.device_index
    was_running = vad_streamer._is_running if vad_streamer else False

    if vad_streamer:
        vad_streamer.stop()

    vad_streamer = VADAudioStreamer(device_index=active_device_index, level_callback=_on_audio_level)
    if was_running:
        vad_streamer.start()

    return {"status": "ok", "selected_device": active_device_index}


@app.post("/api/set_language")
async def set_language(payload: LanguagePayload):
    global active_language
    active_language = payload.language
    return {"status": "ok", "language": active_language}


@app.post("/api/start")
async def start_recording():
    global session_started_at
    if vad_streamer and not vad_streamer._is_running:
        session_started_at = time.time()
        vad_streamer.start()
    await broadcast_ws({"type": "state", "is_recording": True, "session_started_at": session_started_at})
    return {"status": "started", "is_recording": True, "session_started_at": session_started_at}


@app.post("/api/stop")
async def stop_recording():
    if vad_streamer:
        vad_streamer.stop()
    await broadcast_ws({"type": "state", "is_recording": False})
    return {"status": "stopped", "is_recording": False}


recording_jobs = {}
recording_jobs_lock = threading.Lock()


@app.post("/api/recording_jobs")
def create_recording_job():
    with recording_jobs_lock:
        # Expire abandoned jobs which never reached processing.
        for key, job in list(recording_jobs.items()):
            if not job["claimed"] and time.monotonic() - job["created"] > 3600:
                del recording_jobs[key]
        job_id = uuid.uuid4().hex
        recording_jobs[job_id] = {"cancel": threading.Event(), "claimed": False, "created": time.monotonic()}
    return {"job_id": job_id}


@app.post("/api/recording_jobs/{job_id}/stop")
def stop_recording_job(job_id: str):
    with recording_jobs_lock:
        job = recording_jobs.get(job_id)
        if job:
            job["cancel"].set()
    return {"status": "stopping" if job else "finished"}


@app.post("/api/upload_media")
def upload_media(file: UploadFile = File(...), language: str = Form("Chinese"),
                 segment_seconds: int = Form(60), job_id: str = Form(...), mode: str = Form("translate")):
    """Stream recording progress on this request only, off the live event loop."""
    if mode not in {"translate", "transcribe"}:
        raise HTTPException(400, "Unsupported recording mode")
    if mode == "translate" and language not in {"Chinese", "Vietnamese"}:
        raise HTTPException(400, "Unsupported translation language")
    if stt_engine is None or (mode == "translate" and llm_engine is None):
        raise HTTPException(503, "The transcription engine is not ready")
    if not 15 <= segment_seconds <= 300:
        raise HTTPException(400, "Segment length must be between 15 and 300 seconds")
    with recording_jobs_lock:
        job = recording_jobs.get(job_id)
        if not job or job["claimed"]:
            raise HTTPException(409, "Recording job is missing or already started")
        job["claimed"] = True
    suffix = os.path.splitext(file.filename or "recording")[1]
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_file:
        tmp_path = tmp_file.name
    def cleanup():
        job["cancel"].set()
        with recording_jobs_lock:
            recording_jobs.pop(job_id, None)
        try:
            os.remove(tmp_path)
        except FileNotFoundError:
            pass
    try:
        with open(tmp_path, "wb") as target:
            shutil.copyfileobj(file.file, target)
    except Exception:
        cleanup()
        raise
    finally:
        file.file.close()

    def stream():
        try:
            for event in recording_events(tmp_path, language,
                    MediaNormalizer.load_normalized_audio, stt_engine, llm_engine,
                    target_seconds=segment_seconds if mode == "translate" else 60,
                    cancelled=job["cancel"].is_set, mode=mode):
                yield json.dumps(event, ensure_ascii=False) + "\n"
        except Exception as exc:
            print(f"[Recording Error] {exc}")
            yield json.dumps({"type": "error", "message": "Processing failed. Check the recording and local engine, then retry."}) + "\n"
        finally:
            cleanup()
    return StreamingResponse(stream(), media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        background=BackgroundTask(cleanup))


@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_websockets.add(websocket)

    # Send initial devices and status
    devices = VADAudioStreamer.get_audio_devices()
    is_rec = vad_streamer._is_running if vad_streamer else False

    await websocket.send_json(
        {"type": "devices", "devices": devices, "selected": active_device_index}
    )
    await websocket.send_json(
        {"type": "state", "is_recording": is_rec, "language": active_language, "session_started_at": session_started_at}
    )

    try:
        while True:
            # Keep-alive ping/pong
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        connected_websockets.discard(websocket)
    except Exception:
        connected_websockets.discard(websocket)


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
