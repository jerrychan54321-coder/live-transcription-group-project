import unittest
from types import SimpleNamespace
from pipeline.recording import recording_events, group_segments


class RecordingEventsTests(unittest.TestCase):
    def events(self, segments, translator=None):
        stt = SimpleNamespace(transcribe=lambda audio, **kwargs: {"segments": segments})
        translator = translator or SimpleNamespace(process=lambda text, target_language, **kwargs: {
            "original": text, "corrected": text, "translated": target_language,
        })
        return recording_events("test.wav", "Vietnamese", lambda path: b"audio", stt, translator, target_seconds=1)

    def test_segment_positions_language_order_and_progress(self):
        events = list(self.events([
            {"text": "first", "start": 2.35, "end": 4.8},
            {"text": " ", "start": 5, "end": 6},
            {"text": "second", "start": 12, "end": 14},
        ]))
        self.assertEqual([e["stage"] for e in events if e["type"] == "status"],
                         ["Preparing audio", "Transcribing", "Translating"])
        segments = [e for e in events if e["type"] == "segment"]
        self.assertEqual([(s["start"], s["end"]) for s in segments], [(2.35, 4.8), (12, 14)])
        self.assertEqual([s["completed"] for s in segments], [1, 2])
        self.assertTrue(all(s["language"] == s["translated"] == "Vietnamese" for s in segments))
        self.assertTrue(all(s["source"] == "recording" and s["total"] == 2 for s in segments))
        self.assertEqual(events[-1], {"type": "complete", "total": 2})

    def test_empty_recording_does_not_call_translator(self):
        def unexpected(*args, **kwargs):
            self.fail("Empty audio must not be translated")
        events = list(self.events([], SimpleNamespace(process=unexpected)))
        self.assertEqual(events[-1], {"type": "complete", "total": 0})

    def test_model_failure_keeps_original_and_never_claims_complete(self):
        translator = SimpleNamespace(process=lambda *args, **kwargs: {
            "original": "hello", "error": "Model unavailable"
        })
        events = list(self.events([{"text": "hello", "start": 0, "end": 1}], translator))
        self.assertEqual(events[-2]["original"], "hello")
        self.assertEqual(events[-1], {"type": "error", "message": "Model unavailable"})
        self.assertNotIn("complete", [e["type"] for e in events])

    def test_grouping_waits_for_sentence_end_and_preserves_positions(self):
        groups = group_segments([
            {"text": "The first part", "start": 2, "end": 35},
            {"text": "continues", "start": 35, "end": 65},
            {"text": "and finishes.", "start": 65, "end": 72},
            {"text": "Next topic.", "start": 80, "end": 95},
        ], 60)
        self.assertEqual(len(groups), 2)
        self.assertEqual(groups[0], {"start": 2, "end": 72, "text": "The first part continues and finishes."})

    def test_stop_during_translation_does_not_publish_or_start_next_passage(self):
        state = {"cancelled": False, "calls": 0}
        def translate(text, **kwargs):
            state["calls"] += 1
            self.assertIn("Following passage:", kwargs["context"])
            self.assertGreaterEqual(kwargs["max_tokens"], 1024)
            state["cancelled"] = True
            return {"original": text}
        stt = SimpleNamespace(transcribe=lambda audio, **kwargs: {"segments": [
            {"text": "First.", "start": 0, "end": 30}, {"text": "Second.", "start": 31, "end": 62}]})
        events = list(recording_events("file", "Chinese", lambda p: b"audio", stt,
            SimpleNamespace(process=translate), target_seconds=30, cancelled=lambda: state["cancelled"]))
        self.assertEqual(state["calls"], 1)
        self.assertEqual(events[-1], {"type": "stopped", "completed": 0})
        self.assertNotIn("segment", [e["type"] for e in events])

    def test_stop_before_normalization(self):
        def unexpected(*args):
            self.fail("Cancelled job must not start normalization")
        events = list(recording_events("file", "Chinese", unexpected, None, None, cancelled=lambda: True))
        self.assertEqual(events, [{"type": "stopped", "completed": 0}])

    def test_processing_is_incremental(self):
        calls = []
        translator = SimpleNamespace(process=lambda text, **kwargs: calls.append(text) or {"original": text})
        stream = self.events([{"text": "one", "start": 0, "end": 1.5},
                              {"text": "two", "start": 2, "end": 3}], translator)
        for _ in range(3):
            next(stream)
        self.assertEqual(calls, [])
        self.assertEqual(next(stream)["original"], "one")
        self.assertEqual(calls, ["one"])
        self.assertEqual(next(stream)["original"], "two")


if __name__ == "__main__":
    unittest.main()
