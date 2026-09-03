import json
import time
from typing import Any, Dict, List, Optional
import requests


class CorrectorTranslator:
    """Uses local Ollama (qwen2.5:3b) to jointly correct transcription errors

    and produce high quality Chinese or Vietnamese translations in a single fast pass.
    """

    def __init__(
        self,
        model_name: str = "qwen2.5:3b",
        ollama_url: str = "http://localhost:11434",
    ):
        self.model_name = model_name
        self.ollama_url = ollama_url.rstrip("/")
        self.generate_endpoint = f"{self.ollama_url}/api/generate"

    def is_service_ready(self) -> bool:
        try:
            res = requests.get(f"{self.ollama_url}/api/tags", timeout=2.0)
            return res.status_code == 200
        except Exception:
            return False

    def process(
        self, raw_transcript: str, target_language: str = "Chinese"
    ) -> Dict[str, Any]:
        """Performs joint correction and translation in a single model call.

        Returns a dictionary with:
        - original: raw transcript string
        - corrected: corrected English sentence
        - translated: translated sentence in target language
        - errors_corrected: list of notes on what was fixed
        - latency_ms: execution time in milliseconds
        """
        raw_clean = raw_transcript.strip()
        if not raw_clean:
            return {
                "original": "",
                "corrected": "",
                "translated": "",
                "errors_corrected": [],
                "latency_ms": 0.0,
            }

        target_lang_display = (
            "Vietnamese"
            if target_language.lower().startswith("viet")
            else "Simplified Chinese"
        )

        prompt = f"""Respond with ONLY a JSON object, no explanation.
Input: "{raw_clean}"
1. "c": Correct English spelling/grammar (keep in English).
2. "t": Translate the corrected sentence into {target_lang_display}.
Output ONLY: {{"c": "corrected sentence here", "t": "translation here"}}"""

        start_time = time.perf_counter()

        payload = {
            "model": self.model_name,
            "prompt": prompt,
            "stream": False,
            "keep_alive": "60m",  # Keep model resident in RAM throughout the lecture
            "options": {
                "temperature": 0.1,  # Low temperature for deterministic corrections
                "top_p": 0.9,
                "num_predict": 120,  # Enough for full JSON: ~10 structure + ~30 English + ~50 CJK/Viet chars
            },
        }

        try:
            response = requests.post(
                self.generate_endpoint, json=payload, timeout=10.0
            )
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 1)

            if response.status_code == 200:
                result_data = response.json()
                raw_response_text = result_data.get("response", "")
                parsed = self.parse_llm_json(raw_response_text)

                corrected = parsed.get("c") or parsed.get("corrected") or raw_clean
                translated = parsed.get("t") or parsed.get("translated") or ""

                # Compute word-level corrections instantly in Python (0.1ms vs 3000ms in LLM)
                errors_detected = self.detect_word_changes(raw_clean, corrected)

                return {
                    "original": raw_clean,
                    "corrected": corrected,
                    "translated": translated,
                    "errors_corrected": errors_detected,
                    "latency_ms": elapsed_ms,
                }
            else:
                return {
                    "original": raw_clean,
                    "corrected": raw_clean,
                    "translated": f"Ollama HTTP {response.status_code}",
                    "errors_corrected": ["API error"],
                    "latency_ms": elapsed_ms,
                }
        except Exception as e:
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 1)
            return {
                "original": raw_clean,
                "corrected": raw_clean,
                "translated": f"Offline ({target_lang_display})",
                "errors_corrected": [f"Correction error: {str(e)[:50]}"],
                "latency_ms": elapsed_ms,
            }

    @staticmethod
    def parse_llm_json(raw_text: str) -> Dict[str, Any]:
        """Robustly extracts and parses the last JSON object in the response.

        Handles verbose model preambles, markdown fences, and missing commas.
        Uses rfind to locate the last complete {…} block rather than the first brace,
        so verbose explanations before the JSON are safely ignored.
        """
        import re
        clean = raw_text.strip()
        if clean.startswith("```json"):
            clean = clean[7:]
        elif clean.startswith("```"):
            clean = clean[3:]
        if clean.endswith("```"):
            clean = clean[:-3]
        clean = clean.strip()

        # Locate the last complete JSON object in the response
        # (model may emit a verbose explanation before the actual JSON)
        end_idx = clean.rfind("}")
        if end_idx == -1:
            return {}
        start_idx = clean.rfind("{", 0, end_idx)
        if start_idx == -1:
            return {}

        candidate = clean[start_idx : end_idx + 1]

        # Fix possible missing comma between adjacent quoted values on separate lines
        candidate = re.sub(r'("[\s]*)\n([\s]*")', r'\1,\n\2', candidate)

        try:
            return json.loads(candidate)
        except Exception:
            pass

        # Last resort: try parsing the whole stripped text
        try:
            return json.loads(clean)
        except Exception:
            return {}

    @staticmethod
    def detect_word_changes(original: str, corrected: str) -> List[str]:
        """Calculates changed/corrected words in sub-millisecond time without LLM overhead."""
        import re
        import difflib

        orig_words = re.findall(r"\b\w+\b", original.lower())
        corr_words = re.findall(r"\b\w+\b", corrected.lower())

        changes = []
        matcher = difflib.SequenceMatcher(None, orig_words, corr_words)
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "replace":
                from_w = " ".join(orig_words[i1:i2])
                to_w = " ".join(corr_words[j1:j2])
                changes.append(f"{from_w} -> {to_w}")
            elif tag == "delete":
                del_w = " ".join(orig_words[i1:i2])
                changes.append(f"removed '{del_w}'")
            elif tag == "insert":
                ins_w = " ".join(corr_words[j1:j2])
                changes.append(f"added '{ins_w}'")
        return changes[:3]

