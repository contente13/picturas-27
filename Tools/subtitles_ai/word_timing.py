"""Restores the real timing of words stretched by the speaker, such as a long "Goooool".

faster-whisper clamps every word to at most twice the median word duration (<= 1.4 s), which is
meant to drop hallucinated words but also squeezes a long shout (8 s) into its last fraction of a
second, and then replaces the segment start with that late word start. The segment-level times
decoded from Whisper's timestamp tokens are still correct, so they are recorded here, keyed by the
segment tokens, before faster-whisper overwrites them.
"""
from faster_whisper import WhisperModel

# Minimum gap between the segment-level start (end) and the first (last) word before the word is
# considered squeezed by the duration clamp and is stretched back to the segment boundary.
STRETCHED_WORD_GAP_SECONDS = 1.0

_token_bounds = {}
_original_add_word_timestamps = WhisperModel.add_word_timestamps


def _add_word_timestamps_keeping_bounds(self, segments, *args, **kwargs):
    for segment in segments:
        for subsegment in segment:
            _token_bounds[tuple(subsegment["tokens"])] = (float(subsegment["start"]), float(subsegment["end"]))
    return _original_add_word_timestamps(self, segments, *args, **kwargs)


WhisperModel.add_word_timestamps = _add_word_timestamps_keeping_bounds


def reset():
    """Forgets the bounds of the previous transcription (one transcription at a time per worker)."""
    _token_bounds.clear()


def restore_stretched_words(segment, words):
    """Gives a squeezed first/last word back the time between it and the segment boundary."""
    bounds = _token_bounds.get(tuple(segment.tokens))
    if not bounds or not words:
        return words
    start, end = bounds
    if words[0]["start"] - start >= STRETCHED_WORD_GAP_SECONDS:
        words[0]["start"] = start
    if end - words[-1]["end"] >= STRETCHED_WORD_GAP_SECONDS:
        words[-1]["end"] = end
    return words
