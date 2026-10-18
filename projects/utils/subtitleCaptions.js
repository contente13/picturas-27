// UC-VID-001: turns the Whisper transcription (segments with per-word timestamps) into
// captions that satisfy RN3, grouping the words by their real timing.

// UC-VID-001 RN3 limits for each caption.
const MAX_LINE_CHARS = 42;
const MAX_LINES = 2;
const MIN_CAPTION_SECONDS = 0.5;
const MAX_CAPTION_SECONDS = 10;
// 1 ms of slack so rounding to milliseconds never pushes a caption outside the RN3 limits.
const SAFE_MIN_SECONDS = MIN_CAPTION_SECONDS + 0.001;
const SAFE_MAX_SECONDS = MAX_CAPTION_SECONDS - 0.001;
// Readability targets used when grouping words (stricter than RN3 so captions stay short).
const TARGET_CAPTION_SECONDS = 6;
const PAUSE_SPLIT_SECONDS = 0.7;
const COMFORT_CAPTION_SECONDS = 1.2;
// Margin before the end so the last caption also fits the duration reported by the browser.
const END_MARGIN_SECONDS = 0.05;

// Greedy wrap into lines of at most MAX_LINE_CHARS; returns null if a word does not fit a line.
function wrapLines(words) {
  const lines = [];
  let line = "";
  for (const word of words) {
    if (word.length > MAX_LINE_CHARS) return null;
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > MAX_LINE_CHARS) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function fitsCaption(words) {
  const lines = wrapLines(words);
  return Boolean(lines) && lines.length <= MAX_LINES;
}

// Very long tokens (URLs, numbers without spaces) are split so every piece fits one line.
function splitLongWord(word) {
  if (word.text.length <= MAX_LINE_CHARS) return [word];
  const pieces = [];
  for (let i = 0; i < word.text.length; i += MAX_LINE_CHARS) pieces.push(word.text.slice(i, i + MAX_LINE_CHARS));
  const step = (word.end - word.start) / pieces.length;
  return pieces.map((text, index) => ({ text, start: word.start + step * index, end: word.start + step * (index + 1) }));
}

// Uses the word timestamps returned by Whisper. Segments without them (older service
// versions) get word times proportional to each word's length inside the segment.
function extractWords(rawSegments) {
  const words = [];
  for (const raw of rawSegments) {
    const segStart = Number(raw?.start);
    const segEnd = Number(raw?.end);
    const timed = Array.isArray(raw?.words)
      ? raw.words
        .map((word) => ({ text: String(word?.word ?? "").trim(), start: Number(word?.start), end: Number(word?.end) }))
        .filter((word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end))
      : [];
    if (timed.length) {
      words.push(...timed);
      continue;
    }
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (!text || !Number.isFinite(segStart) || !Number.isFinite(segEnd) || segEnd <= segStart) continue;
    const tokens = text.split(/\s+/);
    const totalChars = tokens.reduce((sum, token) => sum + token.length + 1, 0);
    let cursor = segStart;
    for (const token of tokens) {
      const span = (segEnd - segStart) * (token.length + 1) / totalChars;
      words.push({ text: token, start: cursor, end: cursor + span });
      cursor += span;
    }
  }
  return words;
}

function normalizeTranscriptSegments(rawSegments, duration) {
  if (!Array.isArray(rawSegments) || !Number.isFinite(duration) || duration <= 0) return [];
  const limit = Math.floor((duration - END_MARGIN_SECONDS) * 1000) / 1000;
  if (limit < MIN_CAPTION_SECONDS) return [];

  // 1. Words in chronological order, clamped to the video and never overlapping.
  const words = [];
  let previousEnd = 0;
  for (const word of extractWords(rawSegments).flatMap(splitLongWord)) {
    const start = Math.min(limit, Math.max(previousEnd, word.start, 0));
    const end = Math.min(limit, Math.max(start, word.end));
    words.push({ text: word.text, start, end });
    previousEnd = end;
  }

  // 2. Group consecutive words into captions; a caption is closed on a pause, on sentence
  // punctuation, or when the next word would break the line/duration limits.
  const groups = [];
  let current = null;
  for (const word of words) {
    if (current) {
      const tooLong = word.end - current.start > TARGET_CAPTION_SECONDS;
      const paused = word.start - current.end > PAUSE_SPLIT_SECONDS;
      const overflow = !fitsCaption([...current.words, word.text]);
      if (tooLong || paused || overflow) {
        groups.push(current);
        current = null;
      }
    }
    if (!current) current = { start: word.start, end: word.end, words: [] };
    current.words.push(word.text);
    current.end = word.end;
    if (/[.!?…]["»”']?$/.test(word.text) && current.end - current.start >= COMFORT_CAPTION_SECONDS) {
      groups.push(current);
      current = null;
    }
  }
  if (current) groups.push(current);

  // 3. Forward pass: no overlaps, at least 0.5 s, ideally 1.2 s when there is room before
  // the next caption, and at most 10 s (RN3).
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const previous = groups[i - 1];
    const next = groups[i + 1];
    if (previous && group.start < previous.end) group.start = previous.end;
    if (group.end - group.start < COMFORT_CAPTION_SECONDS) {
      const room = next ? next.start : limit;
      group.end = Math.max(group.end, Math.min(group.start + COMFORT_CAPTION_SECONDS, room));
    }
    group.end = Math.max(group.end, group.start + SAFE_MIN_SECONDS);
    group.end = Math.min(group.end, group.start + SAFE_MAX_SECONDS);
  }

  // 4. Backward pass: keep every caption before the next one and inside the video. A
  // caption that no longer fits is moved earlier, which can cascade to the previous ones.
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    const group = groups[i];
    const ceiling = i === groups.length - 1 ? limit : groups[i + 1].start;
    if (group.end > ceiling) group.end = ceiling;
    if (group.end - group.start < SAFE_MIN_SECONDS) group.start = group.end - SAFE_MIN_SECONDS;
    if (group.start < 0) {
      // Only possible with more speech than the video can show: merge it into the next caption.
      const next = groups[i + 1];
      if (next && fitsCaption([...group.words, ...next.words])) {
        next.words = [...group.words, ...next.words];
        next.start = 0;
      }
      groups.splice(i, 1);
    }
  }

  return groups
    .slice(0, 2000)
    .map((group) => ({
      start: Math.round(group.start * 1000) / 1000,
      end: Math.round(group.end * 1000) / 1000,
      text: wrapLines(group.words).join("\n"),
    }));
}

module.exports = { normalizeTranscriptSegments };
