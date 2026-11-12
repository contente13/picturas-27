const s3 = require("./s3Client");
const { BUCKET, objectKey, ensureBucket } = require("./storage");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");

async function uploadImage(userId, projectId, file, stage, { signal } = {}) {
  await ensureBucket();
  signal?.throwIfAborted();

  // imageKey is what callers store and send back (<projectId>/<stage>/<file>);
  // the user prefix is added only for the object's key in the shared bucket.
  const fileName = `${uuidv4()}.${file.mimetype.split("/")[1]}`;
  const imageKey = `${projectId}/${stage}/${fileName}`;
  const input = fs.createReadStream(file.path);
  input.on("error", () => {});
  const params = {
    Bucket: BUCKET,
    Key: objectKey(userId, projectId, stage, fileName),
    Body: input,
    ContentLength: file.size,
    ContentType: file.mimetype,
  };

  // RNF-EFIC-01: bound the SDK's part buffering to 8 MiB per active upload.
  let upload;
  const cancel = () => upload?.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    upload = s3.upload(params, { queueSize: 1, partSize: 8 * 1024 * 1024, leavePartsOnError: false });
    if (signal?.aborted) cancel();
    const data = await upload.promise();
    if (signal?.aborted) {
      await s3.deleteObject({ Bucket: BUCKET, Key: params.Key }).promise();
      signal.throwIfAborted();
    }
    return { imageKey, location: data.Location };
  } catch (error) {
    console.error("Error uploading file:", error.message);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    input.destroy();
  }
}

module.exports = uploadImage;
