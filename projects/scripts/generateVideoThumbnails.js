// Creates the grid thumbnail for videos stored before thumbnails existed (see utils/videoThumbnail.js).
// New uploads and videos produced by trim/subtitle tasks already get one.
//
//   node scripts/generateVideoThumbnails.js           # dry run: lists the videos without thumbnail
//   node scripts/generateVideoThumbnails.js --apply   # creates and stores the thumbnails
const fs = require("fs");
const os = require("os");
const path = require("path");
const axios = require("axios");
const mongoose = require("mongoose");
const { pipeline } = require("stream/promises");
const { get_image_internal_url } = require("../utils/imageStorage");
const { isSupportedVideoName } = require("../utils/video");
const { createVideoThumbnail } = require("../utils/videoThumbnail");

const mongoUrl = process.env.MONGO_URL || "mongodb://projects_mongoDB:27018/project";
const apply = process.argv.includes("--apply");

async function main() {
  await mongoose.connect(mongoUrl);
  const projects = mongoose.connection.db.collection("projects");
  let pending = 0;
  let created = 0;

  for await (const project of projects.find({}, { projection: { user_id: 1, imgs: 1 } })) {
    for (const img of project.imgs || []) {
      if (img.thumb_img_key || !isSupportedVideoName(img.og_uri)) continue;
      pending += 1;
      const name = path.basename(img.og_uri);
      if (!apply) {
        console.log(`[would create] ${project._id} ${name}`);
        continue;
      }
      const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "picturas-backfill-"));
      const videoPath = path.join(workDir, `source${path.extname(name)}`);
      try {
        const internal = await get_image_internal_url(project.user_id, project._id, "src", img.og_img_key);
        const video = await axios.get(internal.data.url, { responseType: "stream" });
        await pipeline(video.data, fs.createWriteStream(videoPath));
        const thumbKey = await createVideoThumbnail({
          userId: project.user_id, projectId: project._id, videoPath, duration: img.mediaMetadata?.duration, videoName: name,
        });
        if (!thumbKey) continue;
        await projects.updateOne({ _id: project._id, "imgs._id": img._id }, { $set: { "imgs.$.thumb_img_key": thumbKey } });
        created += 1;
        console.log(`[created] ${project._id} ${name}`);
      } catch (error) {
        console.error(`[failed] ${project._id} ${name}: ${error.message}`);
      } finally {
        await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  console.log(apply ? `Created ${created} of ${pending} missing thumbnail(s).` : `${pending} video(s) without thumbnail. Run with --apply to create them.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
