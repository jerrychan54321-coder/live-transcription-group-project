import unittest
from types import SimpleNamespace

try:
    from pipeline.stt import SpeechToTextTranscriber
except ModuleNotFoundError:
    SpeechToTextTranscriber = None


@unittest.skipIf(SpeechToTextTranscriber is None, 'Run in the application Python environment')
class SpeechStreamingTests(unittest.TestCase):
    def engine(self, consumed):
        def recognize(*args, **kwargs):
            def segments():
                for text, start, end in [(' Hello ', 0, 1), (' world. ', 1, 2)]:
                    consumed.append(text)
                    yield SimpleNamespace(text=text, start=start, end=end)
            return segments(), None
        engine = SpeechToTextTranscriber.__new__(SpeechToTextTranscriber)
        engine.model = SimpleNamespace(transcribe=recognize)
        return engine

    def test_iterator_is_lazy_and_live_result_still_joins_segments(self):
        consumed = []
        engine = self.engine(consumed)
        stream = engine.transcribe_segments(bytes(32000))
        self.assertEqual(consumed, [])
        self.assertEqual(next(stream)['text'], 'Hello')
        self.assertEqual(len(consumed), 1)
        self.assertEqual(next(stream)['text'], 'world.')
        self.assertEqual(list(stream), [])
        result = engine.transcribe(bytes(32000))
        self.assertEqual(result['text'], 'Hello world.')
        self.assertEqual(result['duration_s'], 2)
        self.assertEqual(len(result['segments']), 2)

    def test_cancel_prevents_decoding_next_segment(self):
        from pipeline.recording import RecordingCancelled
        consumed = []
        state = {'cancelled': False}
        stream = self.engine(consumed).transcribe_segments(bytes(32000), should_cancel=lambda: state['cancelled'])
        next(stream)
        state['cancelled'] = True
        with self.assertRaises(RecordingCancelled):
            next(stream)
        self.assertEqual(len(consumed), 1)
