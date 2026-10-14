const s3 = require("./s3Client");
const createBucket = require("./createBucket");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");

async function uploadImage(userId, projectId, file, stage) {
  const bucketName = `user-${userId}`;
  await createBucket(bucketName);

  const contentType = mime.lookup(file.originalname) || file.mimetype || "application/octet-stream";
  const extension = path.extname(file.originalname).slice(1) || contentType.split("/")[1] || "bin";
  const imageKey = `${projectId}/${stage}/${uuidv4()}.${extension}`;
  const params = {
    Bucket: bucketName,
    Key: imageKey,
    Body: file.path ? fs.createReadStream(file.path) : file.buffer,
    ContentType: contentType,
    ...(file.size ? { ContentLength: file.size } : {}),
  };

  try {
    const data = await s3.upload(params).promise();
    return { imageKey, location: data.Location };
  } catch (error) {
    console.error("Erro ao enviar imagem:", error.message);
    throw error;
  }
}

module.exports = uploadImage;
