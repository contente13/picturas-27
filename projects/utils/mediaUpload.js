const path = require("path");
const FormData = require("form-data");
const { isVideoFile, videoOutputName, probeVideoFile, validateVideo } = require("./video");
const { hashFile } = require("./fileHash");

function mediaUpload(kind, { Project, axios, usersURL, httpsAgent, getCallerId, post_image, delete_image }) {
  return async (req, res) => {
    const context = req.uploadContext;
    const signal = context.signal;
    let storedKey;
    let committed = false;
    let commitPending = false;
    let input;
    let failure = "Error acquiring user's project";
    const rollback = async () => {
      if (!storedKey || committed || commitPending) return;
      try {
        await delete_image(req.params.user, req.params.project, "src", storedKey);
        storedKey = null;
      } catch (error) {
        console.error("Upload object cleanup failed:", error.message);
      }
    };
    try {
      if (!req.file) return res.status(400).jsonp("No file found");
      const fileIsVideo = isVideoFile(req.file.originalname, req.file.mimetype);
      if (kind === "image" && fileIsVideo) {
        return res.status(400).jsonp("Videos must be uploaded through the /video endpoint.");
      }
      if (kind === "video" && !fileIsVideo) {
        return res.status(400).jsonp("Only video files (.mp4, .mov, .webm) can be uploaded here.");
      }
      const project = await Project.getOne(req.params.user, req.params.project);
      signal.throwIfAborted();
      if (project.imgs.some((image) => path.basename(image.og_uri) === req.file.originalname)) {
        return res.status(400).jsonp(`This project already has ${kind === "video" ? "a video" : "an image"} with that name.`);
      }
      const isVideo = kind === "video";
      let videoMeta;
      if (isVideo) {
        let userType = "anonymous";
        try {
          const response = await axios.get(`${usersURL}${getCallerId(req)}/type`, { httpsAgent, signal });
          userType = response.data.type;
        } catch (error) {
          signal.throwIfAborted();
        }
        try {
          videoMeta = await probeVideoFile(req.file.path, { signal });
        } catch (error) {
          signal.throwIfAborted();
          return res.status(400).jsonp(error.message);
        }
        const reason = validateVideo(videoMeta, req.file.originalname, req.file.mimetype, userType);
        if (reason) return res.status(400).jsonp(reason);
      }
      failure = "Error storing image";
      const sha = await hashFile(req.file.path, signal);
      signal.throwIfAborted();
      const data = new FormData();
      input = context.openStream();
      data.append("file", input, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
        knownLength: req.file.size,
      });
      const response = await post_image(req.params.user, req.params.project, "src", data, { signal });
      storedKey = response.data.data.imageKey.split("/").pop();
      signal.throwIfAborted();
      failure = "Updating project information";
      const outName = isVideo ? videoOutputName(req.file.originalname) : req.file.originalname;
      project.imgs.push({
        og_uri: `./images/users/${req.params.user}/projects/${req.params.project}/src/${req.file.originalname}`,
        new_uri: `./images/users/${req.params.user}/projects/${req.params.project}/out/${outName}`,
        og_img_key: storedKey,
        og_sha256: sha,
        media_type: isVideo ? "video" : "image",
        video: videoMeta,
      });
      signal.throwIfAborted();
      // Once submitted, a DB write can have an uncertain outcome on connection loss.
      // Do not delete an object that may already be referenced by that write.
      commitPending = true;
      const updated = await Project.updateIfVersion(req.params.user, req.params.project, project, req.expectedVersion);
      commitPending = false;
      if (!updated) {
        await rollback();
        const fresh = await Project.getOne(req.params.user, req.params.project);
        if (!signal.aborted && !res.destroyed) {
          return res.status(409).jsonp({ message: "Project version conflict", serverVersion: fresh?.version ?? null });
        }
        return;
      }
      committed = true;
      if (!signal.aborted && !res.destroyed) {
        res.set("X-Project-Version", String(updated.version));
        return res.sendStatus(204);
      }
    } catch (error) {
      await rollback();
      if (commitPending) console.error("Upload project update outcome unknown; retaining object:", storedKey);
      if (!signal.aborted && !res.destroyed) return res.status(501).jsonp(failure);
    } finally {
      if (input) input.destroy();
      await context.cleanup();
    }
  };
}

module.exports = { mediaUpload };
