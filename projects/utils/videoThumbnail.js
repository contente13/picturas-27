// Thumbnail shown for videos in the project grid: one small JPEG frame stored next to the video
// (stage "src") and referenced by thumb_img_key on the project item. Creating it is best effort:
// a failure never fails the upload or the video task, the grid then falls back to the video itself.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const FormData = require("form-data");
const { post_image, get_image_public_url, delete_image } = require("./imageStorage");

const execFileAsync = promisify(execFile);
const THUMBNAIL_WIDTH = 480;

// The very first frame is often black (fade-in), so the frame at 10% of the video, at most 1 s in, is used.
function thumbnailTime(duration) {
  const seconds = Number(duration);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(1, seconds * 0.1);
}

async function extractThumbnail(videoPath, outputPath, duration, timeoutMs = 30_000) {
  const args = (seek) => [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", String(seek), "-i", videoPath,
    "-frames:v", "1", "-vf", `scale='min(${THUMBNAIL_WIDTH},iw)':-2`, "-q:v", "4", outputPath,
  ];
  await execFileAsync("ffmpeg", args(thumbnailTime(duration)), { timeout: timeoutMs });
  // Seeking past the last keyframe of a very short clip can produce no frame: retry at the start.
  if (!(await fs.promises.stat(outputPath).catch(() => null))?.size) {
    await execFileAsync("ffmpeg", args(0), { timeout: timeoutMs });
  }
  if (!(await fs.promises.stat(outputPath).catch(() => null))?.size) throw new Error("ffmpeg did not produce a frame");
}

// Returns the storage key of the uploaded thumbnail, or null when it could not be created.
async function createVideoThumbnail({ userId, projectId, videoPath, duration, videoName, timeoutMs }) {
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picturas-thumb-"));
  const thumbPath = path.join(workDir, "thumb.jpg");
  try {
    await extractThumbnail(videoPath, thumbPath, duration, timeoutMs);
    const form = new FormData();
    form.append("file", fs.createReadStream(thumbPath), {
      filename: `${path.basename(videoName || "video", path.extname(videoName || ""))}.thumb.jpg`,
      contentType: "image/jpeg",
      knownLength: (await fs.promises.stat(thumbPath)).size,
    });
    const response = await post_image(userId, projectId, "src", form);
    return response.data.data.imageKey.split("/").pop();
  } catch (error) {
    console.error("Could not create the video thumbnail:", error.message);
    return null;
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function thumbnailUrl(userId, projectId, img) {
  if (!img?.thumb_img_key) return null;
  try {
    return (await get_image_public_url(userId, projectId, "src", img.thumb_img_key)).data.url;
  } catch {
    return null;
  }
}

function deleteThumbnail(userId, projectId, img) {
  if (!img?.thumb_img_key) return Promise.resolve();
  return delete_image(userId, projectId, "src", img.thumb_img_key).catch((error) => {
    console.error("Could not delete the video thumbnail:", error.message);
  });
}

module.exports = { createVideoThumbnail, deleteThumbnail, extractThumbnail, thumbnailTime, thumbnailUrl };
