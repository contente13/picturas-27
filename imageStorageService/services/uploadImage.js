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

  // Accepted source uploads fit in one PUT. Keep bounded multipart support for
  // larger generated outputs without imposing a new limit on internal producers.
  let upload;
  const cancel = () => upload?.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    upload = file.size <= 1024 * 1024 * 1024
      ? s3.putObject(params)
      : s3.upload(params, { queueSize: 1, partSize: 8 * 1024 * 1024, leavePartsOnError: false });
    if (signal?.aborted) cancel();
    const data = await upload.promise();
    if (signal?.aborted) {
      await s3.deleteObject({ Bucket: BUCKET, Key: params.Key }).promise();
      signal.throwIfAborted();
    }
    const location = data.Location || `${upload.httpRequest.endpoint.protocol}//${upload.httpRequest.endpoint.host}${upload.httpRequest.path}`;
    return { imageKey, location };
  } catch (error) {
    console.error("Error uploading file:", error.message);
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    input.destroy();
  }
}

module.exports = uploadImage;
