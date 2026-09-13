"""Exercise live worker control flow without loading microphone/model dependencies."""
import ast
from pathlib import Path
import queue
import time
import unittest
import uuid
from types import SimpleNamespace


def worker_namespace():
    tree = ast.parse((Path(__file__).resolve().parents[1] / 'main.py').read_text(encoding='utf-8'))
    nodes = [node for node in tree.body if
             isinstance(node, ast.FunctionDef) and node.name in {'_stt_worker', '_llm_worker'} or
             isinstance(node, ast.AnnAssign) and getattr(node.target, 'id', '') == 'stt_results_queue']
    ns = dict(queue=queue, time=time, uuid=uuid, is_pipeline_active=True,
              session_started_at=None, active_language='Chinese', event_loop=None,
              live_status=lambda *args: None)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'main.py', 'exec'), ns)
    return ns


class LiveWorkerTests(unittest.TestCase):
    def test_english_published_before_queue_and_continues_past_five_chunks(self):
        ns = worker_namespace()
        events = []
        def chunk(**kwargs):
            if len(events) == 8:
                ns['is_pipeline_active'] = False
                return None
            return b'audio'
        ns['vad_streamer'] = SimpleNamespace(_is_running=True, get_speech_chunk=chunk)
        ns['stt_engine'] = SimpleNamespace(transcribe=lambda _: dict(text='Hello', latency_ms=10, duration_s=1))
        def publish(event):
            self.assertEqual(ns['stt_results_queue'].qsize(), len(events))
            events.append(event)
        ns['send_live'] = publish
        # A bounded queue would block this worker once it fills.
        self.assertEqual(ns['stt_results_queue'].maxsize, 0)
        ns['_stt_worker']()
        self.assertEqual(len(events), 8)
        self.assertEqual(len({event['segment_id'] for event in events}), 8)
        self.assertTrue(all(e['type'] == 'live_transcript' for e in events))

    def test_failure_uses_segment_language_and_preserves_english(self):
        ns = worker_namespace()
        events, languages = [], []
        ns['stt_results_queue'].put(('Hello', dict(segment_id='a', language='Vietnamese', elapsed_s=2)))
        def translate(text, target_language):
            languages.append(target_language)
            ns['is_pipeline_active'] = False
            raise RuntimeError('Model unavailable')
        ns['llm_engine'] = SimpleNamespace(process=translate)
        ns['send_live'] = events.append
        ns['_llm_worker']()
        self.assertEqual(languages, ['Vietnamese'])
        self.assertEqual(events[0]['segment_id'], 'a')
        self.assertEqual(events[0]['original'], 'Hello')
        self.assertEqual(events[0]['translationState'], 'failed')


if __name__ == '__main__':
    unittest.main()
