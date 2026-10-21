const test = require("node:test");
const assert = require("node:assert/strict");

// Direct requests to the Project Service must not bypass extension validation.
for (const [service, modulePath] of [
  ["Project Service", "../utils/filename"],
]) {
  const { projectMediaUploadFilter } = require(modulePath);

  test(`${service}: unsupported extensions are rejected regardless of MIME`, () => {
    for (const originalname of ["clip.avi", "clip.mov", "clip.AVI", "file.txt", "video", "clip.mp4.exe", "archive.zip"]) {
      for (const mimetype of ["video/mp4", "video/webm", "image/jpeg", "application/octet-stream", ""]) {
        let calls = 0;
        projectMediaUploadFilter({}, { originalname, mimetype }, (error, accepted) => {
          calls++;
          assert.equal(error?.status, 415, `${originalname}: ${mimetype}`);
          assert.equal(error.code, "UNSUPPORTED_MEDIA_EXTENSION");
          assert.notEqual(accepted, true);
        });
        assert.equal(calls, 1);
      }
    }
  });

  test(`${service}: supported images and videos remain accepted`, () => {
    for (const originalname of ["image.png", "photo.jpg", "photo.jpeg", "clip.mp4", "clip.webm", "clip.MP4", "image.JPG"]) {
      projectMediaUploadFilter({}, { originalname, mimetype: "application/octet-stream" }, (error, accepted) => {
        assert.equal(error, null);
        assert.equal(accepted, true);
      });
    }
  });

  test(`${service}: validation preserves UTF-8 upload names`, () => {
    const name = "São Paulo — ação.MP4";
    const file = { originalname: Buffer.from(name, "utf8").toString("latin1") };
    projectMediaUploadFilter({}, file, (error, accepted) => {
      assert.equal(error, null);
      assert.equal(accepted, true);
    });
    assert.equal(file.originalname, name);
  });
}
