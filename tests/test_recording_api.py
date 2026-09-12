import json
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

try:
    import main
    from fastapi.testclient import TestClient
except ModuleNotFoundError:
    main = None


@unittest.skipIf(main is None, 'Run in the application Python environment for API tests')
class RecordingAPITests(unittest.TestCase):
    def test_stop_acknowledged_preserves_first_result_and_skips_rest(self):
        client = TestClient(main.app)
        entered, release = threading.Event(), threading.Event()
        calls = []
        def translate(text, **kwargs):
            calls.append(text)
            if len(calls) == 2:
                entered.set()
                if not release.wait(5):
                    raise RuntimeError('Test release timed out')
            return {'original': text, 'corrected': text, 'translated': 'translated'}
        stt = SimpleNamespace(transcribe_segments=lambda *args, **kwargs: iter([
            {'text': 'First.', 'start': 0, 'end': 30},
            {'text': 'Second.', 'start': 31, 'end': 62},
            {'text': 'Third.', 'start': 63, 'end': 94}]))
        response = []
        with patch.object(main, 'stt_engine', stt), patch.object(main, 'llm_engine', SimpleNamespace(process=translate)), patch.object(main.MediaNormalizer, 'load_normalized_audio', return_value=b'audio'):
            job = client.post('/api/recording_jobs').json()['job_id']
            def upload():
                response.append(client.post('/api/upload_media', data={'job_id': job, 'segment_seconds': 30}, files={'file': ('test.wav', b'test', 'audio/wav')}))
            worker = threading.Thread(target=upload)
            worker.start()
            try:
                self.assertTrue(entered.wait(5))
                stop = client.post(f'/api/recording_jobs/{job}/stop')
                self.assertEqual(stop.json()['status'], 'stopping')
            finally:
                release.set()
                worker.join(5)
            self.assertFalse(worker.is_alive())
            events = [json.loads(line) for line in response[0].text.splitlines()]
            self.assertEqual([e['original'] for e in events if e['type'] == 'segment'], ['First.'])
            self.assertEqual(events[-1], {'type': 'stopped', 'completed': 1})
            self.assertEqual(calls, ['First.', 'Second.'])
            self.assertNotIn(job, main.recording_jobs)

    def test_cancel_before_upload_never_starts_engine(self):
        client = TestClient(main.app)
        with patch.object(main, 'stt_engine', object()), patch.object(main, 'llm_engine', object()), patch.object(main.MediaNormalizer, 'load_normalized_audio') as normalize:
            job = client.post('/api/recording_jobs').json()['job_id']
            client.post(f'/api/recording_jobs/{job}/stop')
            response = client.post('/api/upload_media', data={'job_id': job}, files={'file': ('test.wav', b'test')})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {'type': 'stopped', 'completed': 0})
            normalize.assert_not_called()

    def test_transcription_only_without_language_model_and_invalid_mode(self):
        client = TestClient(main.app)
        stt = SimpleNamespace(transcribe_segments=lambda *args, **kwargs: iter([
            {'text': 'English only.', 'start': 0, 'end': 3}]))
        with patch.object(main, 'stt_engine', stt), patch.object(main, 'llm_engine', None), patch.object(main.MediaNormalizer, 'load_normalized_audio', return_value=bytes(16000 * 5)):
            job = client.post('/api/recording_jobs').json()['job_id']
            response = client.post('/api/upload_media', data={'job_id': job, 'mode': 'invalid'}, files={'file': ('test.wav', b'test')})
            self.assertEqual(response.status_code, 400)
            response = client.post('/api/upload_media', data={'job_id': job, 'mode': 'transcribe', 'language': 'English'}, files={'file': ('test.wav', b'test')})
            self.assertEqual(response.status_code, 200)
            events = [json.loads(line) for line in response.text.splitlines()]
            self.assertEqual([e['original'] for e in events if e['type'] == 'transcript_segment'], ['English only.'])
            self.assertFalse(any(e['type'] in {'translating', 'segment'} for e in events))
            self.assertEqual(events[-1], {'type': 'complete', 'total': 1})
            self.assertNotIn(job, main.recording_jobs)
