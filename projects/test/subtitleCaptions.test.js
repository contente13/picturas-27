// UC-VID-001: conversion of the Whisper transcription into captions that satisfy RN3.
// Run with `npm test` inside the projects service (node:test, no extra dependencies).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { normalizeTranscriptSegments } = require("../utils/subtitleCaptions");
const { validateSubtitleSegments } = require("../utils/subtitles");

const words = (captions) => captions.flatMap((caption) => caption.text.split(/\s+/));
const inputWords = (segments) => segments.flatMap((segment) =>
  segment.words?.length ? segment.words.map((word) => word.word.trim()) : segment.text.trim().split(/\s+/));

// Builds a Whisper-like segment whose words are spoken back to back from `start`.
function spoken(text, start, secondsPerWord = 0.35) {
  const list = text.split(" ").map((word, index) => ({
    word, start: start + index * secondsPerWord, end: start + (index + 1) * secondsPerWord - 0.05,
  }));
  return { start, end: list[list.length - 1].end, text, words: list };
}

function assertValid(captions, duration) {
  assert.ok(captions.length > 0, "should produce captions");
  assert.equal(validateSubtitleSegments(captions, duration), null);
}

test("a long segment with few words is not duplicated", () => {
  const captions = normalizeTranscriptSegments([{ start: 0, end: 25, text: "Olá pessoal" }], 30);
  assertValid(captions, 30);
  assert.deepEqual(words(captions), ["Olá", "pessoal"]);
});

test("every word appears exactly once and in order", () => {
  const text = "Bem-vindos ao canal. Hoje vamos falar sobre requisitos e arquiteturas de software, "
    + "com exemplos práticos do projeto PictuRAS e das funcionalidades de vídeo que implementámos nesta fase.";
  const segments = [spoken(text, 1)];
  const captions = normalizeTranscriptSegments(segments, 60);
  assertValid(captions, 60);
  assert.deepEqual(words(captions), inputWords(segments));
});

test("captions follow the word timestamps instead of splitting time evenly", () => {
  // Speech at 0–2 s, then silence, then speech again at 25 s inside the same Whisper segment.
  const first = spoken("um gol do Palmeiras", 0);
  const second = spoken("um golaço do Dudu", 25);
  const segment = { start: 0, end: second.end, text: `${first.text} ${second.text}`, words: [...first.words, ...second.words] };
  const captions = normalizeTranscriptSegments([segment], 59.2);
  assertValid(captions, 59.2);
  const golaco = captions.find((caption) => caption.text.includes("golaço"));
  assert.ok(Math.abs(golaco.start - 25) < 0.01, `caption should start at 25 s, got ${golaco.start}`);
  const firstCaption = captions.find((caption) => caption.text.includes("Palmeiras"));
  assert.ok(firstCaption.end <= 3, "the first caption must not stretch across the silence");
});

test("a pause starts a new caption", () => {
  const captions = normalizeTranscriptSegments([spoken("primeira frase curta", 0), spoken("segunda frase curta", 5)], 20);
  assertValid(captions, 20);
  assert.equal(captions.length, 2);
});

test("fast speech never exceeds two lines of 42 characters and keeps all the text", () => {
  const text = "isto é uma frase muito longa dita muito depressa que ocupa bastante mais do que duas linhas "
    + "de quarenta e dois caracteres cada uma no ecrã";
  const segments = [spoken(text, 5, 0.05)];
  const captions = normalizeTranscriptSegments(segments, 30);
  assertValid(captions, 30);
  assert.deepEqual(words(captions), inputWords(segments));
});

test("segments without word timestamps still produce valid captions with all the text", () => {
  const text = "O serviço antigo não devolvia palavras, por isso o tempo é distribuído pelo comprimento de cada palavra.";
  const captions = normalizeTranscriptSegments([{ start: 2, end: 14, text }], 20);
  assertValid(captions, 20);
  assert.deepEqual(words(captions), text.split(" "));
});

test("speech running past the end of the video stays inside the video", () => {
  const captions = normalizeTranscriptSegments([spoken("sai na frente o Palmeiras", 58.6, 0.3)], 59.234104);
  assertValid(captions, 59.234104);
  assert.ok(captions.at(-1).end <= 59.234104 - 0.05 + 1e-9);
});

test("a stretched word longer than 10 s is capped", () => {
  const captions = normalizeTranscriptSegments([{ start: 10, end: 30, text: "gooooool", words: [{ word: "gooooool", start: 10, end: 30 }] }], 40);
  assertValid(captions, 40);
});

test("random transcriptions always satisfy RN3 and keep every word", () => {
  let seed = 42;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  const vocabulary = ["a", "bola", "Palmeiras", "golaço", "extraordinariamente", "do", "Dudu", "marcação.", "veja", "aí!"];
  for (let run = 0; run < 1000; run += 1) {
    const duration = 5 + random() * 120;
    const segments = [];
    let cursor = random() * 2;
    while (cursor < duration + 1) {
      const list = [];
      const count = 1 + Math.floor(random() * 25);
      for (let i = 0; i < count; i += 1) {
        const start = cursor + random() * (random() < 0.1 ? 3 : 0.2);
        const end = start + 0.02 + random() * (random() < 0.05 ? 12 : 0.6);
        list.push({ word: vocabulary[Math.floor(random() * vocabulary.length)], start, end });
        cursor = end;
      }
      segments.push({ start: list[0].start, end: cursor, text: list.map((word) => word.word).join(" "), words: list });
      cursor += random() * 4;
    }
    const captions = normalizeTranscriptSegments(segments, duration);
    assert.equal(validateSubtitleSegments(captions, duration), null, `run ${run} produced invalid captions`);
    // Words spoken after the end of the video can only be shown if they fit, so compare as a prefix.
    const produced = words(captions);
    assert.deepEqual(produced, inputWords(segments).slice(0, produced.length), `run ${run} lost or reordered words`);
  }
});

const fixture = path.join(__dirname, "fixtures", "palmeiras-whisper-small.json");
test("real Whisper output for the 59 s Palmeiras clip covers the whole video", { skip: !fs.existsSync(fixture) }, () => {
  const raw = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const duration = 59.234104;
  const captions = normalizeTranscriptSegments(raw.segments, duration);
  assertValid(captions, duration);
  assert.deepEqual(words(captions), inputWords(raw.segments));
  assert.ok(captions.at(-1).end > 55, "captions must reach the end of the clip");
  assert.ok(captions.some((caption) => /golaço do Dudu/.test(caption.text.replace(/\n/g, " "))));
});

const turboFixture = path.join(__dirname, "fixtures", "palmeiras-whisper-turbo.json");
test("large-v3-turbo output: correct opening line and the goal shout is captioned while it happens", { skip: !fs.existsSync(turboFixture) }, () => {
  const raw = JSON.parse(fs.readFileSync(turboFixture, "utf8"));
  const duration = 59.234104;
  const captions = normalizeTranscriptSegments(raw.segments, duration);
  assertValid(captions, duration);
  assert.deepEqual(words(captions), inputWords(raw.segments));
  assert.match(captions[0].text, /^O juiz está dizendo/);
  // The narrator shouts "Goooool" from ~16 s to ~24.5 s (measured from the audio loudness).
  const goal = captions.find((caption) => /^Gol\b/.test(caption.text));
  assert.ok(goal, "the shout must have a caption");
  assert.ok(goal.start >= 15.5 && goal.start <= 17, `goal caption should start at ~16 s, got ${goal.start}`);
  assert.ok(goal.end >= 23, `goal caption should stay visible during the shout, got ${goal.end}`);
});
