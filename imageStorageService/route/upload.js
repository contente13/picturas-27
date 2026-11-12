const express = require("express");
const { temporaryUpload } = require("../utils/temporaryUpload");
const uploadImage = require("../services/uploadImage");
const deleteFile = require("../services/deleteFile");

const router = express.Router();
const upload = temporaryUpload();

router.post(
  "/:userId/:projectId/:stage",
  upload.single("file"),
  async (req, res) => {
    const { userId, projectId, stage } = req.params;
    const context = req.uploadContext;
    let saved;
    const discard = async () => {
      if (saved) {
        try {
          await deleteFile(userId, projectId, stage, saved.imageKey.split("/").pop());
        } catch (error) {
          console.error("Cancelled upload object cleanup failed:", error.message);
        }
      }
    };
    const cancel = () => { void discard(); };
    context.signal.addEventListener("abort", cancel, { once: true });

    const allowedStages = require("../utils/stages");

    try {
      if (!allowedStages.includes(stage)) {
        return res.status(400).json({
          error: "O estágio deve ser src, preview, preview_cache ou out.",
        });
      }
      saved = await uploadImage(userId, projectId, req.file, stage, { signal: context.signal });
      if (context.signal.aborted) {
        await discard();
        return;
      }
      res
        .status(201)
        .json({ message: "Imagem enviada com sucesso!", data: saved });
    } catch (error) {
      if (!context.signal.aborted && !res.destroyed) res.status(500).json({ error: error.message });
    } finally {
      context.signal.removeEventListener("abort", cancel);
      await context.cleanup();
    }
  },
);

module.exports = router;
