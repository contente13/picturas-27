// RNF-FIAB-01 harness helper, executed INSIDE the projects container:
//   podman exec -i picturas-fiab-projects-1 node - <user> <project> < inspect_objects.js
// Reads a JSON list [{stage, key}] from the RNF_FIAB_01_OBJECTS env var and prints, per
// object, the SHA-256 of the stored bytes and of the decoded RGBA pixels (same definition
// as corpus.py: sha256("<w>x<h>:" + raw RGBA)). Uses the internal img_storage URL, so the
// harness never handles storage credentials.
const crypto = require("crypto");
const axios = require("axios");
const sharp = require("sharp");

const [user, project] = process.argv.slice(2);
const objects = JSON.parse(process.env.RNF_FIAB_01_OBJECTS || "[]");

(async () => {
  const out = [];
  for (const { stage, key } of objects) {
    try {
      const { data } = await axios.get(`http://img_storage:11000/image/internal/${user}/${project}/${stage}/${key}`);
      const file = await axios.get(data.url, { responseType: "arraybuffer" });
      const bytes = Buffer.from(file.data);
      const entry = { stage, key, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
      try {
        const raw = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        entry.width = raw.info.width;
        entry.height = raw.info.height;
        entry.pixel_sha256 = crypto.createHash("sha256")
          .update(`${raw.info.width}x${raw.info.height}:`).update(raw.data).digest("hex");
      } catch (error) {
        entry.decode_error = error.message;
      }
      out.push(entry);
    } catch (error) {
      out.push({ stage, key, error: error.message });
    }
  }
  console.log(JSON.stringify(out));
})();
