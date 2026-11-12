const fs = require("fs");
const { createHash } = require("crypto");

async function hashFile(filePath, signal) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath, { signal })) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

module.exports = { hashFile };
