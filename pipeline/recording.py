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


def recording_events(path, language, normalize, stt, translator, target_seconds=60, cancelled=lambda: False,
                     mode="translate"):
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
        segments, current = [], None
        duration_s = len(audio) / 16000.0
        for recognized in stt.transcribe_segments(audio, should_cancel=cancelled):
            checkpoint()
            text = recognized["text"].strip()
            if text:
                if current is None:
                    current = {"start": recognized["start"], "end": recognized["end"], "text": text}
                    segments.append(current)
                else:
                    current["text"] += " " + text
                    current["end"] = recognized["end"]
                yield {"type": "transcript_segment", "segment_id": len(segments) - 1,
                       "original": current["text"], "start": current["start"], "end": current["end"],
                       "language": language, "source": "recording", "mode": mode,
                       "processed_s": min(recognized["end"], duration_s), "duration_s": duration_s}
                elapsed = current["end"] - current["start"]
                if (elapsed >= target_seconds and re.search(r'[.!?][\"\'”’]*$', text)) or elapsed >= target_seconds * 1.5:
                    current = None
            else:
                yield {"type": "transcription_progress", "processed_s": min(recognized["end"], duration_s),
                       "duration_s": duration_s}
        checkpoint()
        total = len(segments)
        if mode == "transcribe":
            yield {"type": "complete", "total": total}
            return
        yield {"type": "transcript", "source": "recording", "language": language,
               "segments": [{"segment_id": index, "original": segment["text"],
                             "start": segment["start"], "end": segment["end"]}
                            for index, segment in enumerate(segments)], "total": total}
        yield {"type": "status", "stage": "Translating", "completed": 0, "total": total}
        for index, segment in enumerate(segments):
            checkpoint()
            yield {"type": "translating", "segment_id": index, "completed": completed, "total": total}
            previous = segments[index - 1]["text"][-1000:] if index else ""
            following = segments[index + 1]["text"][:1000] if index + 1 < total else ""
            result = translator.process(segment["text"], target_language=language,
                context=f"Previous passage: {previous}\nFollowing passage: {following}",
                max_tokens=min(8192, max(1024, len(segment["text"]) * 2)), timeout=120)
            checkpoint()
            completed = index + 1
            yield {**result, "type": "segment", "source": "recording", "language": language,
                   "segment_id": index,
                   "start": segment["start"], "end": segment["end"],
                   "completed": completed, "total": total}
            if result.get("error"):
                yield {"type": "error", "message": result["error"]}
                return
        yield {"type": "complete", "total": total}
    except RecordingCancelled:
        yield {"type": "stopped", "completed": completed}
