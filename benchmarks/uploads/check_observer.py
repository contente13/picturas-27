"""Docker-only instrument smoke test; never an application baseline.

Creates only named temporary test containers and removes them afterwards.
"""
import argparse
import json
import subprocess
import time
import uuid

import bench


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default="picturas-projects:latest")
    args = parser.parse_args()
    folder = bench.ROOT / "runs" / ("observer-check-" + uuid.uuid4().hex[:8])
    folder.mkdir(parents=True)
    name = "picturas-p4-observer-target-" + uuid.uuid4().hex[:8]
    source = "let held; process.on('SIGUSR2',()=>{held=Buffer.alloc(64*1024*1024,1)}); setInterval(()=>{},1000)"
    target = None
    observers = []
    try:
        target = bench.command(["docker", "run", "-d", "--rm", "--name", name,
            "--network", "none", "--entrypoint", "node", args.image, "-e", source])
        inspect = json.loads(bench.command(["docker", "inspect", target]))[0]
        bench.PROTOCOL["services"] = ["probe"]
        observers = bench.start_observers({"probe": inspect}, folder)
        time.sleep(2)
        injection = time.time_ns() / 1e6
        bench.command(["docker", "kill", "--signal", "USR2", target])
        time.sleep(3)
        bench.stop_observers(observers)
        observers = []
        rows = [json.loads(line) for line in (folder / "probe.jsonl").read_text().splitlines()]
        before = [r["rss_bytes"] for r in rows if r["timestamp_ms"] < injection - 500]
        after = [r["rss_bytes"] for r in rows if r["timestamp_ms"] > injection + 500]
        if not before or not after:
            raise RuntimeError("Observer did not capture both allocation states")
        increase = bench.statistics.median(after) - bench.statistics.median(before)
        result = {"kind": "synthetic_instrument_check_not_baseline", "image_id": inspect["Image"],
            "samples": len(rows), "rss_increase_bytes": increase,
            "cgroup_available": all("cgroup_bytes" in r for r in rows),
            "max_gap_ms": max(b["timestamp_ms"] - a["timestamp_ms"] for a, b in zip(rows, rows[1:])),
            "max_read_ms": max(r["read_ms"] for r in rows),
            "last_sample_age_at_analysis_ms": time.time_ns() / 1e6 - rows[-1]["timestamp_ms"],
            "tmp_disk_available": any(r.get("tmp_disk", {}).get("complete") for r in rows if r.get("tmp_disk"))}
        bench.save(folder / "check.json", result)
        print(json.dumps(result, indent=2))
        if increase < 48 * 1024 * 1024:
            raise RuntimeError("Observer did not detect the expected 64 MiB allocation")
    finally:
        bench.stop_observers(observers)
        if target:
            subprocess.run(["docker", "rm", "-f", target], capture_output=True, timeout=20)


if __name__ == "__main__":
    main()
