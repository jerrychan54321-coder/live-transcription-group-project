"""Exercise the browser audio protocol without a microphone or downloaded models."""
import unittest
from unittest.mock import patch
from types import SimpleNamespace

import numpy as np
import main
from fastapi.testclient import TestClient
from pipeline.vad import VADAudioStreamer


class BrowserAudioTests(unittest.TestCase):
    def setUp(self):
        self.received = []
        self.vad = SimpleNamespace(_is_running=False)
        self.vad.start = lambda: setattr(self.vad, "_is_running", True)
        self.vad.stop = lambda: setattr(self.vad, "_is_running", False)
        self.vad.feed_audio = self.received.append
        self.client = TestClient(main.app)
        for name, value in {
            "audio_source": "browser", "audio_owner": None,
            "vad_streamer": self.vad,
            "engine_status": {"ready": True, "stage": "Ready", "error": None},
            "connected_websockets": set(),
        }.items():
            patcher = patch.object(main, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def start_audio(self, socket):
        socket.send_json({"sample_rate": 16000, "format": "f32le", "language": "Chinese"})
        self.assertEqual(socket.receive_json(), {"type": "ready"})

    def test_audio_reaches_pipeline_and_disconnect_releases_owner(self):
        with self.client.websocket_connect("/ws/audio") as socket:
            self.start_audio(socket)
            socket.send_bytes(np.array([0.25, -0.5], dtype="<f4").tobytes())
            socket.send_json({"type": "stop"})
            self.assertEqual(socket.receive()["type"], "websocket.close")
        np.testing.assert_array_equal(self.received[0], [0.25, -0.5])
        self.assertFalse(self.vad._is_running)
        self.assertIsNone(main.audio_owner)

    def test_second_tab_cannot_take_microphone(self):
        with self.client.websocket_connect("/ws/audio") as first:
            self.start_audio(first)
            with self.client.websocket_connect("/ws/audio") as second:
                self.assertIn("Another tab", second.receive_json()["error"])
            self.assertTrue(self.vad._is_running)

    def test_setup_not_ready_and_host_routes_rejected(self):
        main.engine_status["ready"] = False
        main.engine_status["stage"] = "Downloading model"
        with self.client.websocket_connect("/ws/audio") as socket:
            self.assertEqual(socket.receive_json()["error"], "Downloading model")
        self.assertEqual(self.client.post("/api/start").status_code, 409)
        self.assertEqual(self.client.post("/api/stop").status_code, 409)
        self.assertEqual(self.client.get("/api/devices").json()["audio_source"], "browser")

    def test_malformed_audio_stops_session(self):
        with self.client.websocket_connect("/ws/audio") as socket:
            self.start_audio(socket)
            socket.send_bytes(b"bad")
            self.assertEqual(socket.receive_json()["error"], "Invalid audio frame")
        self.assertFalse(self.vad._is_running)

    def test_vad_rejects_nonfinite_audio_without_loading_sounddevice(self):
        with patch.object(VADAudioStreamer, "_init_vad_model"):
            vad = VADAudioStreamer(audio_source="browser")
        vad._is_running = True
        with self.assertRaises(ValueError):
            vad.feed_audio(np.array([float("nan")], dtype=np.float32))
        vad.feed_audio(np.array([-2, 0, 2], dtype=np.float32))
        np.testing.assert_array_equal(vad._audio_queue.get_nowait(), [-1, 0, 1])

    def test_stop_flushes_last_phrase(self):
        with patch.object(VADAudioStreamer, "_init_vad_model"):
            vad = VADAudioStreamer(audio_source="browser")
        # Drain queued speech even after capture has stopped; no model is required.
        vad._audio_queue.put(np.full(16000, 0.1, dtype=np.float32))
        vad._vad_processing_loop()
        self.assertGreater(len(vad.get_speech_chunk(timeout=0.1)), 15000)


if __name__ == "__main__":
    unittest.main()
