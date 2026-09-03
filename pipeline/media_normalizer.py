import os
import subprocess
import tempfile
import numpy as np


class MediaNormalizer:
    """Normalizes any audio or video file into 16kHz mono float32 PCM numpy array

    using ffmpeg, satisfying Section 7 of the course specification.
    """

    @staticmethod
    def is_ffmpeg_available() -> bool:
        try:
            res = subprocess.run(
                ["ffmpeg", "-version"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            return res.returncode == 0
        except Exception:
            return False

    @classmethod
    def extract_audio_to_wav(cls, input_path: str, output_wav_path: str) -> bool:
        """Extracts and resamples audio track to 16,000 Hz, mono, 16-bit PCM WAV."""
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Media file not found: {input_path}")

        command = [
            "ffmpeg",
            "-y",  # Overwrite output if exists
            "-i",
            input_path,
            "-vn",  # Discard video
            "-acodec",
            "pcm_s16le",  # 16-bit PCM
            "-ar",
            "16000",  # 16 kHz sample rate
            "-ac",
            "1",  # Mono channel
            output_wav_path,
        ]

        result = subprocess.run(
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False
        )
        return result.returncode == 0

    @classmethod
    def load_normalized_audio(cls, input_path: str) -> np.ndarray:
        """Takes an audio/video file and returns float32 numpy array ready for Whisper."""
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
            tmp_wav_path = tmp_file.name

        try:
            success = cls.extract_audio_to_wav(input_path, tmp_wav_path)
            if not success:
                raise RuntimeError(
                    f"FFmpeg failed to extract and normalize audio from {input_path}"
                )

            # Read raw 16-bit PCM WAV using numpy directly
            with open(tmp_wav_path, "rb") as f:
                # WAV header is 44 bytes
                f.seek(44)
                raw_data = f.read()

            audio_int16 = np.frombuffer(raw_data, dtype=np.int16)
            audio_float32 = audio_int16.astype(np.float32) / 32768.0
            return audio_float32
        finally:
            if os.path.exists(tmp_wav_path):
                try:
                    os.remove(tmp_wav_path)
                except Exception:
                    pass
