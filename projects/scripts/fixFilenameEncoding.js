// One-off repair of file names stored before uploads were decoded as UTF-8 (see utils/filename.js).
// Names went through two multer hops (API gateway and projects), so "São" was stored as "SÃ\u0083Â£o".
// Objects in storage are keyed by UUID, so only the names kept in MongoDB need fixing.
//
//   node scripts/fixFilenameEncoding.js           # dry run: lists what would change
//   node scripts/fixFilenameEncoding.js --apply   # writes the changes
const path = require("path");
const mongoose = require("mongoose");
const { decodeUploadFilename } = require("../utils/filename");

const mongoUrl = process.env.MONGO_URL || "mongodb://projects_mongoDB:27018/project";
const apply = process.argv.includes("--apply");

function repairName(name) {
  let current = name;
  for (let hop = 0; hop < 3; hop += 1) {
    const next = decodeUploadFilename(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

function repairUri(uri) {
  if (typeof uri !== "string") return uri;
  const base = path.posix.basename(uri);
  const fixed = repairName(base);
  return fixed === base ? uri : `${uri.slice(0, uri.length - base.length)}${fixed}`;
}

async function main() {
  await mongoose.connect(mongoUrl);
  const db = mongoose.connection.db;
  let projectChanges = 0;
  let taskChanges = 0;

  for await (const project of db.collection("projects").find({}, { projection: { imgs: 1, name: 1 } })) {
    const names = new Set((project.imgs || []).map((img) => path.posix.basename(img.og_uri || "")));
    const set = {};
    (project.imgs || []).forEach((img, index) => {
      const ogUri = repairUri(img.og_uri);
      if (ogUri === img.og_uri) return;
      const fixedName = path.posix.basename(ogUri);
      if (names.has(fixedName)) {
        console.warn(`[skip] ${project._id} "${fixedName}" already exists in the project`);
        return;
      }
      names.add(fixedName);
      set[`imgs.${index}.og_uri`] = ogUri;
      set[`imgs.${index}.new_uri`] = repairUri(img.new_uri);
      console.log(`[project ${project._id}] ${path.posix.basename(img.og_uri)}  ->  ${fixedName}`);
    });
    if (Object.keys(set).length) {
      projectChanges += Object.keys(set).length / 2;
      if (apply) await db.collection("projects").updateOne({ _id: project._id }, { $set: set, $inc: { version: 1 } });
    }
  }

  for await (const task of db.collection("video_tasks").find({}, { projection: { source_name: 1, resultName: 1 } })) {
    const set = {};
    const sourceName = repairName(task.source_name);
    const resultName = task.resultName ? repairName(task.resultName) : task.resultName;
    if (sourceName !== task.source_name) set.source_name = sourceName;
    if (resultName !== task.resultName) set.resultName = resultName;
    if (Object.keys(set).length) {
      taskChanges += 1;
      if (apply) await db.collection("video_tasks").updateOne({ _id: task._id }, { $set: set });
    }
  }

  console.log(`${apply ? "Fixed" : "Would fix"} ${projectChanges} project file name(s) and ${taskChanges} video task(s).`);
  if (!apply) console.log("Dry run only. Run again with --apply to write the changes.");
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
