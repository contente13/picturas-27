const express = require("express");
const multer = require("multer");
const uploadImage = require("../services/uploadImage");
const os = require("os");
const fs = require("fs");

const router = express.Router();
const upload = multer({
  storage: multer.diskStorage({ destination: os.tmpdir() }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

router.post(
  "/:userId/:projectId/:stage",
  upload.single("file"),
  async (req, res) => {
    const { userId, projectId, stage } = req.params;

    const allowedStages = require("../utils/stages");

    if (!allowedStages.includes(stage)) {
      if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({
        error: "O estágio deve ser src, preview, preview_cache ou out.",
      });
    }


    if (!req.file) return res.status(400).json({ error: "Nenhum ficheiro enviado." });

    try {
      const result = await uploadImage(userId, projectId, req.file, stage);
      res
        .status(201)
        .json({ message: "Imagem enviada com sucesso!", data: result });
    } catch (error) {
      res.status(500).json({ error: error.message });
    } finally {
      fs.promises.unlink(req.file.path).catch(() => {});
    }
  },
);

module.exports = router;
