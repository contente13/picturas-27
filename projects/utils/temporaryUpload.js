
const fs = require("fs");
const os = require("os");
const path = require("path");
const { randomUUID } = require("crypto");
const { pipeline } = require("stream/promises");
const multer = require("multer");

function temporaryUpload(root = path.join(os.tmpdir(), "picturas-uploads")) {
  const storage = {
    _handleFile(req, file, callback) {
      const context = req.uploadContext;
      const task = (async () => {
        context.signal.throwIfAborted();
        const destination = await context.directory();
        context.signal.throwIfAborted();
        const filename = randomUUID();
        const filePath = path.join(destination, filename);
        const output = context.track(fs.createWriteStream(filePath, { flags: "wx", mode: 0o600 }));
        await pipeline(file.stream, output, { signal: context.signal });
        return { destination, filename, path: filePath, size: output.bytesWritten };
      })();
      context.writes.add(task);
      task.then((info) => callback(null, info), callback);
    },
    _removeFile(req, file, callback) {
      fs.rm(file.path, { force: true }, callback);
    },
  };
  const upload = multer({ storage });

  return {
    single(field) {
      const receive = upload.single(field);
      return (req, res, next) => {
        const controller = new AbortController();
        let directoryPromise;
        let cleaning;
        const streams = new Set();
        const writes = new Set();
        const context = {
          signal: controller.signal,
          writes,
          directory() {
            if (!directoryPromise) {
              directoryPromise = fs.promises.mkdir(root, { recursive: true, mode: 0o700 })
                .then(() => fs.promises.mkdtemp(path.join(root, "request-")));
            }
            return directoryPromise;
          },
          track(stream) {
            streams.add(stream);
            // Consumers still receive errors; avoid an unhandled error before attachment.
            stream.on("error", () => {});
            stream.once("close", () => streams.delete(stream));
            return stream;
          },
          openStream() {
            controller.signal.throwIfAborted();
            return context.track(fs.createReadStream(req.file.path, { signal: controller.signal }));
          },
          cleanup() {
            if (!cleaning) {
              cleaning = (async () => {
                for (const stream of streams) stream.destroy();
                await Promise.allSettled(writes);
                if (directoryPromise) {
                  const directory = await directoryPromise.catch(() => null);
                  if (directory) await fs.promises.rm(directory, { recursive: true, force: true });
                }
              })().catch((error) => console.error("Upload temporary cleanup failed:", error.message));
            }
            return cleaning;
          },
        };
        req.uploadContext = context;
        const cancel = () => {
          controller.abort();
          void context.cleanup();
        };
        req.once("aborted", cancel);
        res.once("close", () => {
          if (!res.writableFinished) cancel();
        });
        res.once("finish", () => {
          req.removeListener("aborted", cancel);
          void context.cleanup();
        });
        receive(req, res, (error) => {
          if (error) void context.cleanup();
          if (!context.signal.aborted) next(error);
        });
      };
    },
  };
}

module.exports = { temporaryUpload };
