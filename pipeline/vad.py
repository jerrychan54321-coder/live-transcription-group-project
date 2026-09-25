import queue
import threading
import time
from typing import Callable, Generator, List, Optional
import numpy as np
import sounddevice as sd


class VADAudioStreamer:
    """Real-time microphone stream capturer and Voice Activity Detection (VAD) chunker.

    Segments continuous classroom speech on natural phrase pauses (~300-400ms) or
    maximum sentence limits (~4.5s) to guarantee sub-3-second end-to-end latency.
    """

    SAMPLE_RATE = 16000
    FRAME_SIZE = 512  # 32ms at 16kHz (Standard Silero VAD window size)

    def __init__(
        self,
        device_index: Optional[int] = None,
        vad_threshold: float = 0.5,
        min_speech_duration_ms: int = 600,
        min_silence_duration_ms: int = 600,
        max_speech_duration_s: float = 4.5,
        level_callback: Optional[Callable] = None,
    ):
        self.device_index = device_index
        self.vad_threshold = vad_threshold
        self.min_speech_frames = int(
            (min_speech_duration_ms / 1000.0)
            * (self.SAMPLE_RATE / self.FRAME_SIZE)
        )
        self.min_silence_frames = int(
            (min_silence_duration_ms / 1000.0)
            * (self.SAMPLE_RATE / self.FRAME_SIZE)
        )
        self.max_speech_frames = int(
            max_speech_duration_s * (self.SAMPLE_RATE / self.FRAME_SIZE)
        )

        self._audio_queue: queue.Queue = queue.Queue()
        self._speech_chunk_queue: queue.Queue = queue.Queue()
        self._is_running = False
        self._stream: Optional[sd.InputStream] = None
        self._vad_model = None
        self._vad_lock = threading.Lock()
        self._level_callback = level_callback
        self._last_level_broadcast: float = 0.0

        self._init_vad_model()

    def _init_vad_model(self):
        """Initializes Silero VAD model via silero_vad package or ONNX."""
        try:
            from silero_vad import load_silero_vad

            self._vad_model = load_silero_vad(onnx=True)
            print("[VAD] Silero VAD ONNX model initialized successfully.")
        except Exception as e:
            print(f"[VAD] Fallback or direct ONNX initialization: {e}")
            self._vad_model = None

    @staticmethod
    def get_audio_devices() -> List[dict]:
        """Lists all input audio devices."""
        devices = []
        for i, dev in enumerate(sd.query_devices()):
            if dev["max_input_channels"] > 0:
                devices.append(
                    {
                        "index": i,
                        "name": dev["name"],
                        "channels": dev["max_input_channels"],
                        "default_samplerate": dev["default_samplerate"],
                    }
                )
        return devices

    def _audio_callback(self, indata, frames, time_info, status):
        """Sounddevice non-blocking callback collecting raw 16kHz mono audio."""
        if status:
            pass  # Suppress overflow warnings in logs
        # Convert to 1D float32 mono array
        mono_audio = indata[:, 0].copy().astype(np.float32)
        self._audio_queue.put(mono_audio)

    def _vad_processing_loop(self):
        """Background worker thread evaluating frames against VAD and segmenting speech."""
        buffer = np.array([], dtype=np.float32)
        speech_buffer: List[np.ndarray] = []
        silence_frame_count = 0
        is_speech_active = False

        while self._is_running:
            try:
                chunk = self._audio_queue.get(timeout=0.1)
                buffer = np.concatenate((buffer, chunk))
            except queue.Empty:
                continue

            # Process in slices of 512 samples
            while len(buffer) >= self.FRAME_SIZE:
                frame = buffer[: self.FRAME_SIZE]
                buffer = buffer[self.FRAME_SIZE :]

                # Compute RMS energy unconditionally (used for audio level and fallback VAD)
                rms = np.sqrt(np.mean(frame**2))

                # Compute speech probability
                is_speech = False
                if self._vad_model is not None:
                    try:
                        import torch

                        tensor_frame = torch.from_numpy(frame)
                        prob = self._vad_model(
                            tensor_frame, self.SAMPLE_RATE
                        ).item()
                        is_speech = prob > self.vad_threshold
                    except Exception:
                        # Lightweight energy fallback: RMS energy
                        is_speech = rms > 0.015
                else:
                    is_speech = rms > 0.015

                # Broadcast audio level at ~10 Hz so the UI meter stays live (Bug 2 fix)
                now = time.monotonic()
                if self._level_callback and (now - self._last_level_broadcast) >= 0.1:
                    self._last_level_broadcast = now
                    try:
                        self._level_callback(float(rms), bool(is_speech))
                    except Exception:
                        pass

                if is_speech:
                    is_speech_active = True
                    silence_frame_count = 0
                    speech_buffer.append(frame)
                else:
                    if is_speech_active:
                        speech_buffer.append(frame)
                        silence_frame_count += 1

                # Condition 1: Natural pause after speech
                if (
                    is_speech_active
                    and silence_frame_count >= self.min_silence_frames
                ):
                    if len(speech_buffer) >= self.min_speech_frames:
                        complete_chunk = np.concatenate(speech_buffer)
                        self._speech_chunk_queue.put(complete_chunk)
                    speech_buffer = []
                    is_speech_active = False
                    silence_frame_count = 0

                # Condition 2: Max duration limit reached (prevent delayed display)
                elif (
                    is_speech_active
                    and len(speech_buffer) >= self.max_speech_frames
                ):
                    complete_chunk = np.concatenate(speech_buffer)
                    self._speech_chunk_queue.put(complete_chunk)
                    speech_buffer = []
                    is_speech_active = False
                    silence_frame_count = 0

    def start(self):
        """Starts capturing microphone audio."""
        if self._is_running:
            return

        self._is_running = True
        self._stream = sd.InputStream(
            samplerate=self.SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=self.FRAME_SIZE,
            device=self.device_index,
            callback=self._audio_callback,
        )
        self._stream.start()

        self._worker_thread = threading.Thread(
            target=self._vad_processing_loop, daemon=True
        )
        self._worker_thread.start()
        print(f"[VAD] Audio capture started on device index {self.device_index}")

    def stop(self):
        """Stops capturing audio."""
        self._is_running = False
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:
                pass
            self._stream = None
        print("[VAD] Audio capture stopped.")

    def get_speech_chunk(self, timeout: float = 0.5) -> Optional[np.ndarray]:
        """Retrieves next complete spoken speech segment (blocking with timeout)."""
        try:
            return self._speech_chunk_queue.get(timeout=timeout)
        except queue.Empty:
            return None
