const jwt = require("jsonwebtoken");

// Only test processes use this default; production requires JWT_SECRET_KEY.
process.env.JWT_SECRET_KEY ||= "project-service-test-signing-key";

function tokenFor(id) {
  return jwt.sign({ id: String(id) }, process.env.JWT_SECRET_KEY, { expiresIn: "1h", algorithm: "HS256" });
}

module.exports = { tokenFor };
