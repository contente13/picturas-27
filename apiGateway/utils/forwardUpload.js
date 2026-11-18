const axios = require("axios");

function forwardUpload(projectsURL, httpsAgent, forwardError, endpoint) {
  return async (req, res) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const onClose = () => {
      if (!res.writableFinished) cancel();
    };
    req.once("aborted", cancel);
    res.once("close", onClose);
    if (req.aborted || res.destroyed) cancel();
    try {
      const ownerId = req.query.owner || req.params.user;
      const callerId = req.authUserId || req.params.user;
      const response = await axios.post(
        `${projectsURL}${ownerId}/${req.params.project}/${endpoint}`,
        req,
        {
          headers: {
            "Content-Type": req.headers["content-type"],
            ...(req.headers["content-length"] ? { "Content-Length": req.headers["content-length"] } : {}),
            Authorization: req.headers.authorization,
            "X-Project-Version": req.headers["x-project-version"],
            "X-Caller-Id": callerId,
          },
          httpsAgent,
          params: req.query.share ? { share: req.query.share } : undefined,
          signal: controller.signal,
          // Forward the original multipart stream with backpressure. Projects
          // performs parsing and validation; redirects must not retain the body.
          maxRedirects: 0,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        },
      );
      if (!controller.signal.aborted && !res.destroyed) {
        const version = response.headers["x-project-version"];
        if (version) res.set("X-Project-Version", version);
        res.sendStatus(204);
      }
    } catch (error) {
      if (!controller.signal.aborted && !res.destroyed) forwardError(res, error, "Error uploading media");
    } finally {
      req.removeListener("aborted", cancel);
      res.removeListener("close", onClose);
      // An early upstream rejection must not leave an unread client body.
      if (!req.complete && !req.destroyed) req.resume();
    }
  };
}

module.exports = { forwardUpload };
