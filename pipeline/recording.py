"""Paragraph grouping and cooperative cancellation for recording-only work."""
import re


class RecordingCancelled(Exception):
    pass


def group_segments(segments, target_seconds=60):
    groups, current = [], []
    for segment in segments:
        if not segment["text"].strip():
            continue
        current.append(segment)
        duration = segment["end"] - current[0]["start"]
        sentence_end = re.search(r'[.!?][\"\'”’]*$', segment["text"].strip())
        if (duration >= target_seconds and sentence_end) or duration >= target_seconds * 1.5:
            groups.append({"start": current[0]["start"], "end": segment["end"],
                           "text": " ".join(s["text"].strip() for s in current)})
            current = []
    if current:
        groups.append({"start": current[0]["start"], "end": current[-1]["end"],
                       "text": " ".join(s["text"].strip() for s in current)})
    return groups


def recording_events(path, language, normalize, stt, translator, target_seconds=60, cancelled=lambda: False):
    def checkpoint():
        if cancelled():
            raise RecordingCancelled()
    completed = 0
    try:
        checkpoint()
        yield {"type": "status", "stage": "Preparing audio"}
        audio = normalize(path)
        checkpoint()
        yield {"type": "status", "stage": "Transcribing"}
        transcription = stt.transcribe(audio, should_cancel=cancelled)
        checkpoint()
        segments = group_segments(transcription["segments"], target_seconds)
        total = len(segments)
        yield {"type": "status", "stage": "Translating", "completed": 0, "total": total}
        for index, segment in enumerate(segments):
            checkpoint()
            previous = segments[index - 1]["text"][-1000:] if index else ""
            following = segments[index + 1]["text"][:1000] if index + 1 < total else ""
            result = translator.process(segment["text"], target_language=language,
                context=f"Previous passage: {previous}\nFollowing passage: {following}",
                max_tokens=min(8192, max(1024, len(segment["text"]) * 2)), timeout=120)
            checkpoint()
            completed = index + 1
            yield {**result, "type": "segment", "source": "recording", "language": language,
                   "start": segment["start"], "end": segment["end"],
                   "completed": completed, "total": total}
            if result.get("error"):
                yield {"type": "error", "message": result["error"]}
                return
        yield {"type": "complete", "total": total}
    except RecordingCancelled:
        yield {"type": "stopped", "completed": completed}
