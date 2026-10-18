const { getCallerId } = require("../utils/caller");

// Video routes are available to the project owner or to whoever holds a valid share link (RN19).
function requireVideoAccess(req, res, next) {
  const callerId = getCallerId(req);
  if (!callerId) return res.status(401).jsonp("Authentication required");
  if (String(callerId) !== String(req.params.user) && !req.sharedPermission) {
    return res.status(403).jsonp("Not allowed");
  }
  next();
}

module.exports = { requireVideoAccess };