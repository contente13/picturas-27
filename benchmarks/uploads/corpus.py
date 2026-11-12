"""Generate real media, then archive exact sizes, hashes and ffprobe metadata.

Run with an existing PictuRAS image containing Python and FFmpeg, not during a trial.
No padding of containers and no application changes. Existing files are retained.
"""
import hashlib
import json
import random
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MIB = 1024 ** 2


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(MIB), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    target = ROOT / "corpus"
    target.mkdir(exist_ok=True)
    recipes = [("video-small.mp4", 50, 50), ("video-large.mp4", 900, 120)]
    entries = []
    for name, size_mib, seconds in recipes:
        path = target / name
        # CBR filler is part of a valid H.264 stream, not trailing file padding.
        rate = round(size_mib * MIB * 8 / seconds) - 128000
        command = ["ffmpeg", "-nostdin", "-v", "error", "-n",
                   "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25",
                   "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
                   "-t", str(seconds), "-c:v", "libx264", "-threads", "1",
                   "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                   "-b:v", str(rate), "-minrate", str(rate), "-maxrate", str(rate),
                   "-bufsize", str(rate * 2), "-x264-params", "nal-hrd=cbr:force-cfr=1",
                   "-c:a", "aac", "-b:a", "128k", "-map_metadata", "-1",
                   "-movflags", "+faststart", str(path)]
        if not path.exists():
            print("Generating", name, flush=True)
            subprocess.run(command, check=True)
        metadata = json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_format", "-show_streams",
            "-of", "json", str(path)], text=True))
        if abs(path.stat().st_size / (size_mib * MIB) - 1) > .05:
            raise RuntimeError(f"{name}: size outside +/-5%; inspect before freezing corpus")
        video = next(s for s in metadata["streams"] if s["codec_type"] == "video")
        assert video["codec_name"] == "h264" and float(metadata["format"]["duration"]) <= 600
        entries.append({"file": name, "target_mib": size_mib,
                        "bytes": path.stat().st_size, "sha256": digest(path),
                        "recipe": command, "probe": metadata})

    path = target / "image-control.jpg"
    quality = None
    if not path.exists():
        # Seeded noise gives a nontrivial JPEG without a downloaded dependency.
        pixels = random.Random(2712).randbytes(2560 * 2560 * 3)
        best = None
        for q in range(2, 21):
            data = subprocess.run(["ffmpeg", "-v", "error", "-f", "rawvideo",
                "-pixel_format", "rgb24", "-video_size", "2560x2560", "-i", "pipe:0",
                "-frames:v", "1", "-c:v", "mjpeg", "-threads", "1", "-pix_fmt", "yuvj444p",
                "-q:v", str(q), "-f", "image2pipe", "pipe:1"], input=pixels,
                stdout=subprocess.PIPE, check=True).stdout
            if best is None or abs(len(data) - 5 * MIB) < abs(len(best[1]) - 5 * MIB):
                best = (q, data)
        quality, data = best
        path.write_bytes(data)
    subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], check=True)
    if abs(path.stat().st_size / (5 * MIB) - 1) > .10:
        raise RuntimeError("JPEG outside +/-10% of 5 MiB")
    entries.append({"file": path.name, "target_mib": 5, "bytes": path.stat().st_size,
                    "sha256": digest(path), "seed": 2712, "quality": quality,
                    "dimensions": [2560, 2560]})
    manifest = {"ffmpeg": subprocess.check_output(["ffmpeg", "-version"], text=True).splitlines()[0],
                "python": __import__("sys").version, "files": entries}
    manifest_path = target / "manifest.json"
    # Preserve original provenance when rerunning against the same corpus.
    if manifest_path.exists():
        old = json.loads(manifest_path.read_text(encoding="utf-8"))
        if [(e["file"], e["sha256"]) for e in old["files"]] != [(e["file"], e["sha256"]) for e in entries]:
            raise RuntimeError("Corpus differs from saved manifest; do not overwrite baseline evidence")
    else:
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("Corpus validated:", manifest_path)


if __name__ == "__main__":
    main()
