// UC-VID-000: uploaded file names keep their accents (multer decodes them as latin1).
const test = require("node:test");
const assert = require("node:assert/strict");
const { decodeUploadFilename } = require("../utils/filename");

// What busboy produces when it reads UTF-8 bytes as latin1.
const asLatin1 = (name) => Buffer.from(name, "utf8").toString("latin1");

test("a UTF-8 name read as latin1 is recovered", () => {
  const name = "Palmeiras 3 x 0 São Paulo - Gol de Dudu (1080p).mp4";
  assert.equal(decodeUploadFilename(asLatin1(name)), name);
});

test("accents, cedillas and emoji survive the round trip", () => {
  for (const name of ["Férias em Óbidos — ação.mp4", "coração ❤️.webm", "über_naïve.png", "日本語.jpg"]) {
    assert.equal(decodeUploadFilename(asLatin1(name)), name);
  }
});

test("names that are already correct are left alone", () => {
  for (const name of ["video.mp4", "São Paulo.mp4", "日本語.jpg", "", "ação ❤️.mp4"]) {
    assert.equal(decodeUploadFilename(name), name);
  }
});

test("latin1 text that is not valid UTF-8 is kept as it is", () => {
  // "é" alone is the byte 0xE9, which is not a valid UTF-8 sequence.
  assert.equal(decodeUploadFilename("café.mp4"), "café.mp4");
});

test("the gateway → projects double decoding is undone by applying it at each hop", () => {
  const name = "São Paulo.mp4";
  const atGateway = decodeUploadFilename(asLatin1(name));
  const atProjects = decodeUploadFilename(asLatin1(atGateway));
  assert.equal(atProjects, name);
});
