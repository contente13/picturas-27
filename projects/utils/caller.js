const jwt = require("jsonwebtoken");

function getCallerId(req) {
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;

  // Forwarded headers are not credentials: direct requests must pass the same
  // signature and expiry checks as requests arriving through the API gateway.
  try {
    const payload = jwt.verify(auth.slice("Bearer ".length), process.env.JWT_SECRET_KEY, {
      algorithms: ["HS256"],
    });
    if (typeof payload.id === "string" && payload.id.trim() && Number.isFinite(payload.exp)) {
      return payload.id;
    }
  } catch {
    // Invalid, expired or unverifiable tokens never establish an identity.
  }

  return null;
}

module.exports = { getCallerId };
