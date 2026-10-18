// Multer 1.x (busboy) decodes the multipart `filename="..."` parameter as latin1, but browsers
// and form-data send it as UTF-8 bytes, so "São.mp4" arrived as "SÃ£o.mp4". Re-reading those
// characters as bytes recovers the UTF-8 name. A name that already contains characters outside
// latin1, or whose bytes are not valid UTF-8, was decoded correctly and is kept as it is.
function decodeUploadFilename(name) {
  if (typeof name !== "string" || !/[\u0080-ÿ]/.test(name) || /[^\u0000-ÿ]/.test(name)) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("�") ? name : decoded;
}

// Multer fileFilter that fixes file.originalname before storage and route handlers use it.
function utf8FilenameFilter(_req, file, callback) {
  file.originalname = decodeUploadFilename(file.originalname);
  callback(null, true);
}

module.exports = { decodeUploadFilename, utf8FilenameFilter };
