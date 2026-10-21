// Run in the projects image (FFmpeg available). All media are synthetic and disposable.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const dir = path.resolve(process.env.VIDEO_FIXTURES_DIR || path.join(__dirname, ".generated"));
fs.mkdirSync(dir, { recursive: true });
const manifest = [];
function media(name, args) {
  const file = path.join(dir, name);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, file], { timeout: 120000 });
  const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]));
  manifest.push({ name, bytes: fs.statSync(file).size, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"), duration: Number(info.format.duration), streams: info.streams.map(s => ({ type: s.codec_type, codec: s.codec_name, width: s.width, height: s.height, fps: s.avg_frame_rate })) });
}
media("São Paulo — ação.mp4", ["-f", "lavfi", "-i", "testsrc2=s=640x360:r=24:d=12", "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]);
media("verde.webm", ["-f", "lavfi", "-i", "color=green:s=320x240:r=12:d=8", "-f", "lavfi", "-i", "sine=frequency=880:duration=8", "-c:v", "libvpx", "-c:a", "libvorbis", "-shortest"]);
media("silencioso.mp4", ["-f", "lavfi", "-i", "color=blue:s=240x320:r=15:d=6", "-c:v", "libx264", "-pix_fmt", "yuv420p"]);
media("codec-invalido.mp4", ["-f", "lavfi", "-i", "color=red:s=64x64:r=10:d=2", "-c:v", "mpeg4"]);
media("apenas-audio.mp4", ["-f", "lavfi", "-i", "sine=duration=2", "-c:a", "aac"]);
media("longo-601s.mp4", ["-f", "lavfi", "-i", "color=black:s=64x64:r=1:d=601", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]);
media("longo-3601s.mp4", ["-f", "lavfi", "-i", "color=black:s=16x16:r=1:d=3601", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]);
media("cancelar-hd.mp4", ["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=20", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]);
media("fala-ingles.mp4", ["-f", "lavfi", "-i", "color=navy:s=640x360:r=24:d=20", "-f", "lavfi", "-i", "flite=text='Hello. This is a video subtitle test. The system should recognize the spoken words. We are checking the text and the timing of the video.':voice=slt", "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]);
fs.writeFileSync(path.join(dir, "corrompido.mp4"), "Isto não é um ficheiro de vídeo.");
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest.map(({name,bytes,duration})=>({name,bytes,duration})), null, 2));
