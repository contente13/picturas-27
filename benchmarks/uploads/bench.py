"""Upload measurement harness. Python standard library; Docker Linux required."""
import argparse
import concurrent.futures
import hashlib
import http.client
import json
import mimetypes
import os
import platform
import secrets
import ssl
import statistics
import subprocess
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent.parent
PROTOCOL = json.loads((ROOT / "protocol.json").read_text(encoding="utf-8"))


def command(args, timeout=30):
    return subprocess.check_output(args, cwd=REPO, text=True, encoding="utf-8", timeout=timeout).strip()


def save(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def sha(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


class API:
    def __init__(self, base):
        self.base = base.rstrip("/")
        url = urlsplit(self.base)
        # Self-signed certificates are allowed only for this local test instance.
        if url.scheme != "https" or url.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("Use an HTTPS localhost URL for the isolated test instance")
        self.url = url

    def connection(self):
        return http.client.HTTPSConnection(self.url.hostname, self.url.port or 443,
            timeout=PROTOCOL["http_timeout_seconds"], context=ssl._create_unverified_context())

    def request(self, method, path, client=None, data=None, version=None):
        connection = self.connection()
        headers = {"Content-Type": "application/json"}
        if client:
            headers["Authorization"] = "Bearer " + client["token"]
        if version is not None:
            headers["X-Project-Version"] = str(version)
        try:
            connection.request(method, self.url.path + path, json.dumps(data) if data is not None else None, headers)
            response = connection.getresponse()
            body = response.read()
            if response.status not in (200, 201, 204):
                raise RuntimeError(f"{method} failed with HTTP {response.status}")
            return json.loads(body) if body and response.status != 204 else None
        finally:
            connection.close()

    def upload(self, client, project, file, kind, barrier):
        boundary = "p4-" + uuid.uuid4().hex
        field = "video" if kind == "video" else "image"
        endpoint = "video" if kind == "video" else "img"
        preamble = (f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; '
                    f'filename="{file.name}"\r\nContent-Type: {mimetypes.guess_type(file.name)[0]}\r\n\r\n').encode()
        trailer = f"\r\n--{boundary}--\r\n".encode()
        connection = self.connection()
        result = {"project_id": project["_id"], "file": file.name}
        started = None
        try:
            # Connect TLS and open the input before the shared start barrier.
            connection.connect()
            with file.open("rb") as source:
                barrier.wait(timeout=30)
                started = time.perf_counter()
                result["start_ms"] = time.time_ns() / 1e6
                connection.putrequest("POST", self.url.path + f'/projects/{client["user_id"]}/{project["_id"]}/{endpoint}')
                connection.putheader("Authorization", "Bearer " + client["token"])
                connection.putheader("X-Project-Version", str(project["version"]))
                connection.putheader("Content-Type", "multipart/form-data; boundary=" + boundary)
                connection.putheader("Content-Length", str(len(preamble) + file.stat().st_size + len(trailer)))
                connection.endheaders()
                connection.send(preamble)
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    connection.send(chunk)
                connection.send(trailer)
                # This is local socket submission, not proof of server receipt.
                result["socket_send_seconds"] = time.perf_counter() - started
                response = connection.getresponse()
                response.read()
                result.update(status=response.status, version=response.getheader("X-Project-Version"))
        except Exception as error:
            barrier.abort()
            result["error"] = type(error).__name__
        finally:
            result["end_ms"] = time.time_ns() / 1e6
            result["seconds"] = time.perf_counter() - started if started is not None else None
            connection.close()
        return result

    def verify(self, client, project, fixture):
        data = self.request("GET", f'/projects/{client["user_id"]}/{project["_id"]}', client)
        items = data["imgs"]
        if len(items) != 1 or items[0]["name"] != fixture["file"]:
            raise RuntimeError("Expected exactly one media association with the original filename")
        media = items[0]
        expected_type = "video" if fixture["file"].endswith(".mp4") else "image"
        if media["media_type"] != expected_type:
            raise RuntimeError("Media type mismatch")
        if expected_type == "video":
            actual = media["video"]
            original = fixture["probe"]
            video = next(s for s in original["streams"] if s["codec_type"] == "video")
            audio = next((s for s in original["streams"] if s["codec_type"] == "audio"), None)
            numerator, denominator = video["avg_frame_rate"].split("/")
            checks = [actual["size_bytes"] == fixture["bytes"],
                      actual["width"] == video["width"], actual["height"] == video["height"],
                      actual["video_codec"] == video["codec_name"],
                      actual["audio_codec"] == (audio["codec_name"] if audio else None),
                      actual["format_name"] == original["format"]["format_name"],
                      abs(actual["duration"] - float(original["format"]["duration"])) < .05,
                      abs(actual["fps"] - float(numerator) / float(denominator)) < .02]
            if not all(checks):
                raise RuntimeError("Stored video metadata differs from the corpus")
        # Never save signed URLs or tokens in measurement evidence.
        url = urlsplit(media["url"])
        if url.scheme != "https" or url.netloc != self.url.netloc:
            raise RuntimeError("Storage download URL does not point to the local test instance")
        connection = self.connection()
        try:
            connection.request("GET", url.path + ("?" + url.query if url.query else ""))
            response = connection.getresponse()
            if response.status != 200:
                raise RuntimeError("Stored object download failed")
            h = hashlib.sha256()
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                h.update(chunk)
            if h.hexdigest() != fixture["sha256"]:
                raise RuntimeError("Stored object SHA-256 differs from the original")
        finally:
            connection.close()
        return {"sha256_matches": True, "metadata_matches": True, "associations": len(items)}

    def cleanup(self, client, project):
        prefix = f'/projects/{client["user_id"]}/{project["_id"]}'
        data = self.request("GET", prefix, client)
        for media in data["imgs"]:
            self.request("DELETE", prefix + "/img/" + media["_id"], client, version=data["version"])
            data = self.request("GET", prefix, client)
        self.request("DELETE", prefix, client, version=data["version"])


def inventory(project):
    if not project.startswith("picturas-p4-"):
        raise ValueError("Use an isolated Compose project named picturas-p4-<name>, not the normal installation")
    ids = command(["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=" + project]).splitlines()
    if not ids:
        raise RuntimeError("Isolated stack is not running")
    containers = json.loads(command(["docker", "inspect", *ids]))
    found = {}
    for container in containers:
        labels = container["Config"]["Labels"]
        service = labels.get("com.docker.compose.service")
        if service in found:
            raise RuntimeError("Replicated services need an explicitly extended measurement protocol")
        found[service] = container
    for name in PROTOCOL["services"]:
        if name not in found:
            raise RuntimeError("Missing measured service: " + name)
    return found


def safe_inventory(containers):
    # Deliberately omit Config.Env, command lines, mounts and credentials.
    return {service: {"id": c["Id"], "image_id": c["Image"],
        "started_at": c["State"]["StartedAt"], "oom_killed": c["State"]["OOMKilled"],
        "restarts": c["RestartCount"], "memory_limit": c["HostConfig"]["Memory"],
        "nano_cpus": c["HostConfig"]["NanoCpus"]} for service, c in containers.items()}


def start_observers(containers, folder):
    workers = []
    source = (ROOT / "observer.cjs").read_text(encoding="utf-8")
    try:
        for service in PROTOCOL["services"]:
            target = containers[service]
            name = "p4-observer-" + uuid.uuid4().hex[:12]
            output = (folder / (service + ".jsonl")).open("w", encoding="utf-8")
            error = (folder / (service + ".stderr")).open("w", encoding="utf-8")
            process = subprocess.Popen(["docker", "run", "--rm", "--name", name,
                "--pid=container:" + target["Id"], "--network", "none", "--read-only",
                "--cap-drop=ALL", "--cap-add=SYS_PTRACE", "--entrypoint", "node", target["Image"],
                "-e", source, "--", str(PROTOCOL["interval_ms"]), service],
                stdout=output, stderr=error, cwd=REPO)
            workers.append((name, process, output, error))
        time.sleep(3)
        if any(p.poll() is not None for _, p, _, _ in workers):
            raise RuntimeError("Observer failed to start; inspect sanitized observer stderr files")
        return workers
    except BaseException:
        stop_observers(workers)
        raise


def stop_observers(workers):
    for name, process, output, error in workers:
        try:
            subprocess.run(["docker", "stop", "--time", "1", name], capture_output=True, timeout=15)
        finally:
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            output.close()
            error.close()


def summarize(folder, start, end):
    # Common 100 ms buckets; missing observations are invalid, never zero.
    interval = PROTOCOL["interval_ms"]
    rows = {}
    stats = {}
    for service in PROTOCOL["services"]:
        data = [json.loads(line) for line in (folder / (service + ".jsonl")).read_text().splitlines()]
        rows[service] = {}
        for row in data:
            bucket = int(row["timestamp_ms"] // interval)
            if row["complete"] and row["processes"]:
                rows[service][bucket] = row
        gaps = [b["timestamp_ms"] - a["timestamp_ms"] for a, b in zip(data, data[1:])]
        stats[service] = {"max_gap_ms": max(gaps, default=None),
            "median_read_ms": statistics.median([r["read_ms"] for r in data]) if data else None,
            "cgroup_available": bool(data) and all("cgroup_bytes" in r for r in data)}
    totals, before, after = [], [], []
    missing = 0
    for bucket in range(int(start // interval), int(end // interval)):
        samples = [rows[s].get(bucket) for s in PROTOCOL["services"]]
        if any(r is None for r in samples):
            missing += 1
            continue
        times = [r["timestamp_ms"] for r in samples]
        if max(times) - min(times) > PROTOCOL["max_sample_skew_ms"]:
            missing += 1
            continue
        total = sum(r["rss_bytes"] for r in samples)
        totals.append(total)
        if max(times) < start + PROTOCOL["before_seconds"] * 1000:
            before.append(total)
        if min(times) >= end - PROTOCOL["after_seconds"] * 1000:
            after.append(total)
    if not before or not after:
        raise RuntimeError("No synchronized resting or post-response observations")
    idle = statistics.median(before)
    return {"rest_rss_bytes": idle, "peak_rss_bytes": max(totals),
        "additional_peak_rss_bytes": max(totals) - idle,
        "post_response_median_rss_bytes": statistics.median(after),
        "missing_buckets": missing, "complete_buckets": len(totals), "sampling": stats,
        "sampling_valid": missing == 0 and all(s["max_gap_ms"] is not None and s["max_gap_ms"] <= 250 for s in stats.values())}


def check_corpus():
    manifest = json.loads((ROOT / "corpus/manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["files"]:
        file = ROOT / "corpus" / entry["file"]
        if file.stat().st_size != entry["bytes"] or sha(file) != entry["sha256"]:
            raise RuntimeError("Corpus changed: " + entry["file"])
    return {entry["file"]: entry for entry in manifest["files"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["preflight", "corpus", "setup", "run"])
    parser.add_argument("--project", required=True, help="Isolated Compose project: picturas-p4-<name>")
    parser.add_argument("--base-url", default="https://localhost:8080/api-gateway")
    parser.add_argument("--clients", type=Path, default=ROOT / "clients.local.json")
    parser.add_argument("--scenario", choices=["all", *PROTOCOL["scenarios"]], default="all")
    parser.add_argument("--phase", choices=["pilot", "baseline", "final"], default="pilot")
    parser.add_argument("--generator-image", help="Optional existing Python+FFmpeg image for corpus generation without a running stack")
    args = parser.parse_args()
    api = API(args.base_url)
    if args.action == "corpus" and args.generator_image:
        subprocess.run(["docker", "run", "--rm", "--network", "none", "--entrypoint", "python3",
            "--mount", f"type=bind,source={ROOT},target=/bench", args.generator_image,
            "/bench/corpus.py"], check=True, cwd=REPO)
        save(ROOT / "corpus/generator-image.json", {"image_id": command([
            "docker", "image", "inspect", args.generator_image, "--format", "{{.Id}}"]),
            "purpose": "corpus generation only; not the application baseline"})
        return
    containers = inventory(args.project)
    if args.action == "preflight":
        print(json.dumps({"host": platform.platform(), "python": platform.python_version(),
            "docker": json.loads(command(["docker", "info", "--format", '{{json .}}']))["ServerVersion"],
            "containers": safe_inventory(containers)}, indent=2))
        return
    if args.action == "corpus":
        if "video_tool" not in containers:
            raise RuntimeError("Start/build the existing video_tool image to generate the corpus")
        subprocess.run(["docker", "run", "--rm", "--network", "none", "--entrypoint", "python",
            "--mount", f"type=bind,source={ROOT},target=/bench", containers["video_tool"]["Image"],
            "/bench/corpus.py"], check=True, cwd=REPO)
        return
    if args.action == "setup":
        if args.clients.exists():
            raise RuntimeError("Client file already exists; do not silently replace test identities")
        clients = []
        for index in range(3):
            email = f'p4-{uuid.uuid4().hex}@example.invalid'
            result = api.request("POST", "/users/", data={"name": "P4 benchmark", "email": email,
                "password": secrets.token_urlsafe(24), "type": "premium"})
            if result["user"]["type"] != "premium":
                raise RuntimeError("Test user is not premium")
            clients.append({"user_id": str(result["user"]["_id"]), "token": result["jwt"]})
        save(args.clients, {"compose_project": args.project, "base_url": args.base_url, "clients": clients})
        print("Created 3 isolated premium clients. Tokens saved only in ignored local file.")
        return

    corpus = check_corpus()
    credentials = json.loads(args.clients.read_text(encoding="utf-8"))
    if credentials["compose_project"] != args.project or credentials["base_url"] != args.base_url:
        raise RuntimeError("Client identities belong to another test instance")
    clients = credentials["clients"]
    if len(clients) != 3 or len({c["user_id"] for c in clients}) != 3:
        raise RuntimeError("Three distinct premium test users are required")
    commit = command(["git", "rev-parse", "HEAD"])
    if args.phase == "baseline" and commit != PROTOCOL["baseline_commit"]:
        raise RuntimeError("Baseline HEAD does not match the approved source commit")
    tracked_changes = command(["git", "diff", "HEAD", "--name-only"]).splitlines()
    if any(not p.startswith("benchmarks/uploads/") for p in tracked_changes):
        raise RuntimeError("Commit application changes before measurement; source identity must be reproducible")
    scenarios = PROTOCOL["scenarios"] if args.scenario == "all" else {args.scenario: PROTOCOL["scenarios"][args.scenario]}
    run = ROOT / "runs" / (time.strftime("%Y%m%d-%H%M%S") + "-" + args.phase + "-" + uuid.uuid4().hex[:6])
    run.mkdir(parents=True)
    save(run / "environment.json", {"commit": commit, "protocol": PROTOCOL,
        "protocol_sha256": sha(ROOT / "protocol.json"), "harness_sha256": sha(Path(__file__)),
        "observer_sha256": sha(ROOT / "observer.cjs"), "corpus_sha256": sha(ROOT / "corpus/manifest.json"),
        "host": platform.platform(), "python": platform.python_version(), "phase": args.phase,
        "docker": json.loads(command(["docker", "info", "--format", '{{json .}}']))["ServerVersion"],
        "initial_containers": safe_inventory(containers)})
    repetitions = 1 if args.phase == "pilot" else PROTOCOL["repetitions"]
    for scenario, specification in scenarios.items():
        for repetition in range(1, repetitions + 1):
            folder = run / f"{scenario}-{repetition:02d}"
            folder.mkdir()
            print(f"{scenario}: {repetition}/{repetitions}", flush=True)
            # Restart only the three observed services in the isolated stack.
            before = inventory(args.project)
            command(["docker", "restart", *[before[s]["Id"] for s in PROTOCOL["services"]]], timeout=120)
            selected = clients[:specification["clients"]]
            deadline = time.monotonic() + 120
            while True:
                try:
                    for client in selected:
                        validated = api.request("GET", "/users/validate/" + client["user_id"], client)
                        if validated["user"]["type"] != "premium":
                            raise RuntimeError("Client no longer premium")
                    break
                except Exception:
                    if time.monotonic() >= deadline:
                        raise RuntimeError("Readiness/authentication failed after restart") from None
                    time.sleep(2)
            # Fixed lightweight warm-up; no measured upload or editing jobs.
            time.sleep(5)
            projects = [api.request("POST", "/projects/" + c["user_id"], c,
                {"name": f"p4-{scenario}-{repetition}-{uuid.uuid4().hex[:8]}"}) for c in selected]
            projects = [api.request("GET", f'/projects/{c["user_id"]}/{p["_id"]}', c) for c, p in zip(selected, projects)]
            containers = inventory(args.project)
            save(folder / "containers-before.json", safe_inventory(containers))
            observers = start_observers(containers, folder)
            result = {"scenario": scenario, "repetition": repetition, "phase": args.phase}
            try:
                observed_start = time.time_ns() / 1e6
                time.sleep(PROTOCOL["before_seconds"])
                barrier = threading.Barrier(len(selected))
                file = ROOT / "corpus" / specification["file"]
                with concurrent.futures.ThreadPoolExecutor(max_workers=len(selected)) as pool:
                    futures = [pool.submit(api.upload, c, p, file, specification["kind"], barrier)
                               for c, p in zip(selected, projects)]
                    uploads = [f.result() for f in futures]
                responses_end = time.time_ns() / 1e6
                time.sleep(PROTOCOL["after_seconds"])
                observed_end = time.time_ns() / 1e6
                result.update(uploads=uploads, observed_start_ms=observed_start,
                    responses_end_ms=responses_end, observed_end_ms=observed_end)
            finally:
                stop_observers(observers)
            try:
                result["memory"] = summarize(folder, observed_start, observed_end)
                result["containers_after"] = safe_inventory(inventory(args.project))
                result["services_stable"] = all(
                    result["containers_after"][s]["id"] == containers[s]["Id"]
                    and result["containers_after"][s]["started_at"] == containers[s]["State"]["StartedAt"]
                    and result["containers_after"][s]["restarts"] == containers[s]["RestartCount"]
                    and not result["containers_after"][s]["oom_killed"] for s in PROTOCOL["services"])
                result["uploads_successful"] = all(u.get("status") == 204 and u.get("version") is not None for u in uploads)
                if result["uploads_successful"]:
                    # Hash download and metadata checks happen AFTER the memory window.
                    result["integrity"] = [api.verify(c, p, corpus[file.name]) for c, p in zip(selected, projects)]
                starts = [u["start_ms"] for u in uploads if "start_ms" in u]
                result["start_skew_ms"] = max(starts) - min(starts) if len(starts) == len(selected) else None
                result["all_uploads_seconds"] = (max(u["end_ms"] for u in uploads) - min(starts)) / 1000 if starts else None
                for client, project in zip(selected, projects):
                    api.cleanup(client, project)
            except Exception as error:
                result["evaluation_error"] = type(error).__name__ + ": " + str(error)
            finally:
                save(folder / "result.json", result)
            if result.get("evaluation_error") or not result.get("uploads_successful") or not result.get("services_stable") or not result.get("memory", {}).get("sampling_valid"):
                print("Trial needs review; raw evidence retained. Stopping to avoid contaminating subsequent trials.")
                return
    print("Measurements saved under", run)


if __name__ == "__main__":
    main()
