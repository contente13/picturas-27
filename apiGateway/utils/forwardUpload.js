const axios = require("axios");
const FormData = require("form-data");

function forwardUpload(projectsURL, httpsAgent, forwardError, field, endpoint) {
  return async (req, res) => {
    const context = req.uploadContext;
    let input;
    try {
      if (!req.file) throw new Error("No file found");
      const ownerId = req.query.owner || req.params.user;
      const callerId = req.authUserId || req.params.user;
      const data = new FormData();
      input = context.openStream();
      data.append(field, input, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        knownLength: req.file.size,
      });
      const response = await axios.post(
        `${projectsURL}${ownerId}/${req.params.project}/${endpoint}`,
        data,
        {
          headers: {
            ...data.getHeaders(),
            Authorization: req.headers.authorization,
            "X-Project-Version": req.headers["x-project-version"],
            "X-Caller-Id": callerId,
          },
          httpsAgent,
          params: req.query.share ? { share: req.query.share } : undefined,
          signal: context.signal,
          // Redirect replay retains uploaded chunks in memory. Internal endpoints do not redirect.
          maxRedirects: 0,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        },
      );
      if (!context.signal.aborted && !res.destroyed) {
        const version = response.headers["x-project-version"];
        if (version) res.set("X-Project-Version", version);
        res.sendStatus(204);
      }
    } catch (error) {
      if (!context.signal.aborted && !res.destroyed) forwardError(res, error, "Error uploading media");
    } finally {
      if (input) input.destroy();
      await context.cleanup();
    }
  };
}

module.exports = { forwardUpload };
