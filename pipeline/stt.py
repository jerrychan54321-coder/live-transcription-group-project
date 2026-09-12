import time
from typing import Any, Dict, List, Optional
from faster_whisper import WhisperModel
import numpy as np


class SpeechToTextTranscriber:
    """Local Speech-to-Text engine powered by faster-whisper (CTranslate2).

    Runs int8 quantized Whisper models optimized for Zen 4 AVX-512 CPU execution.
    """

    def __init__(
        self,
        model_size: str = "base.en",
        device: str = "cpu",
        compute_type: str = "int8",
        cpu_threads: int = 6,
    ):
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.cpu_threads = cpu_threads

        print(
            f"[STT] Loading faster-whisper model '{model_size}' on {device} ({compute_type})..."
        )
        self.model = WhisperModel(
            model_size_or_path=model_size,
            device=device,
            compute_type=compute_type,
            cpu_threads=cpu_threads,
            num_workers=2,
            download_root=None,
        )
        print(f"[STT] Model '{model_size}' loaded successfully.")

    def transcribe(
        self, audio_data: np.ndarray, beam_size: int = 3, should_cancel=None
    ) -> Dict[str, Any]:
        """Transcribes 16kHz mono float32 audio chunk into text.

        Uses beam_size=3 for improved accuracy on classroom speech (Ryzen 9 8945HS, Zen 4 AVX-512).
        """
        if len(audio_data) == 0:
            return {"text": "", "latency_ms": 0.0, "segments": []}

        start_time = time.perf_counter()

        # faster-whisper expects 16kHz float32 audio
        segments, info = self.model.transcribe(
            audio_data,
            beam_size=beam_size,
            language="en",
            condition_on_previous_text=False,
            vad_filter=False,  # Audio is already pre-filtered by our Silero VAD module
        )

        segment_list: List[Dict[str, Any]] = []
        full_text = []

        for seg in segments:
            if should_cancel and should_cancel():
                from pipeline.recording import RecordingCancelled
                raise RecordingCancelled()
            full_text.append(seg.text.strip())
            segment_list.append(
                {
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "text": seg.text.strip(),
                }
            )

        elapsed_ms = round((time.perf_counter() - start_time) * 1000, 1)
        joined_text = " ".join(full_text).strip()

        return {
            "text": joined_text,
            "latency_ms": elapsed_ms,
            "duration_s": round(len(audio_data) / 16000.0, 2),
            "segments": segment_list,
        }
