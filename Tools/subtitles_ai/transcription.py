"""Speech-to-text with a local Whisper model: returns segments with per-word timestamps."""
import os
import re

from faster_whisper import WhisperModel

import word_timing

# large-v3-turbo transcribes ~1 min of audio in ~15 s on CPU; longer audio uses the faster
# model so a 60-minute Premium video still finishes within the 900 s limit (RN12).
MODEL_NAME = os.environ.get("SUBTITLE_MODEL", "large-v3-turbo")
FAST_MODEL_NAME = os.environ.get("SUBTITLE_FAST_MODEL", "small")
LONG_AUDIO_SECONDS = float(os.environ.get("SUBTITLE_LONG_AUDIO_SECONDS", "1800"))
CPU_THREADS = int(os.environ.get("SUBTITLE_CPU_THREADS", "8"))
MODEL_DIR = os.environ.get("HF_HOME", "/models")
# Empty means automatic detection (RN12: transcribe in the spoken language, never translate).
DEFAULT_LANGUAGE = os.environ.get("SUBTITLE_LANGUAGE", "").strip() or None
os.makedirs(MODEL_DIR, exist_ok=True)

# Whisper hallucinations commonly produced over music or silence in Portuguese audio.
HALLUCINATION_PATTERNS = re.compile(r"amara\.org|legendas pela comunidade", re.IGNORECASE)


def _load_model(name):
    return WhisperModel(name, device="cpu", compute_type="int8", download_root=MODEL_DIR, cpu_threads=CPU_THREADS)


# The main model is loaded once per container; the fast one only when a long audio needs it.
_models = {MODEL_NAME: _load_model(MODEL_NAME)}


def _model_for(duration):
    name = FAST_MODEL_NAME if duration and duration > LONG_AUDIO_SECONDS else MODEL_NAME
    if name not in _models:
        _models[name] = _load_model(name)
    return _models[name]


def _is_noise(segment, text):
    # Whisper's own rule for "this is not speech", plus known phrases it invents over music.
    return not text or HALLUCINATION_PATTERNS.search(text) or (segment.no_speech_prob > 0.6 and segment.avg_logprob < -1.0)


def transcribe_file(audio_path, language=None, duration=0):
    """Returns (segments, detected_language); each segment has start, end, text and words."""
    word_timing.reset()
    try:
        # The VAD filter is disabled on purpose: Silero classifies speech over music, crowd
        # noise or shouting as silence and discarded most of the audio. For the same reason
        # hallucination_silence_threshold is not used (it dropped a long, stretched shout).
        segments, info = _model_for(duration).transcribe(
            audio_path,
            language=language or DEFAULT_LANGUAGE,
            beam_size=5,
            vad_filter=False,
            word_timestamps=True,
            condition_on_previous_text=False,
            language_detection_segments=4,
        )
        result = []
        for segment in segments:
            text = segment.text.strip()
            if _is_noise(segment, text):
                continue
            words = word_timing.restore_stretched_words(segment, [
                {"start": float(word.start), "end": float(word.end), "word": word.word.strip()}
                for word in (segment.words or [])
                if word.word.strip()
            ])
            start = words[0]["start"] if words else float(segment.start)
            end = words[-1]["end"] if words else float(segment.end)
            result.append({"start": start, "end": end, "text": text, "words": words})
        return result, info.language
    finally:
        word_timing.reset()
