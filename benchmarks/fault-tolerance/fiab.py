#!/usr/bin/env python3
"""RNF-FIAB-01 fault-injection harness: image-processing recovery after worker failure.

Standard library only. Runs against an isolated Compose project ("picturas-fiab")
built from the source tree given with --source (the baseline checkout or the
refactored tree), with the test-only shims of compose.fiab.yaml. See README.md.
"""

import argparse
import datetime
import hashlib
import http.client
import json
import os
import shutil
import ssl
import struct
import subprocess
import sys
import time
import uuid
import zlib
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
PROTOCOL = json.loads((HERE / "protocol.json").read_text())
RUNS = HERE / "runs"
CTL = RUNS / "ctl"
CORPUS = RUNS / "corpus"


# ---------------------------------------------------------------- corpus

def png_bytes(width, height, pixel):
    """Encode an 8-bit RGB PNG deterministically (no external libraries)."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(pixel(x, y))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))


def png_size(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", data[16:24])


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def make_corpus():
    lot = PROTOCOL["lot"]
    CORPUS.mkdir(parents=True, exist_ok=True)
    manifest = []
    for index in range(lot["images"]):
        def pixel(x, y, i=index):
            # Non-uniform, non-symmetric content so rotations and repeats are visible.
            return ((x * (i + 3) + y) % 256, (y * (i + 5) + 2 * x) % 256, (x * y + 37 * i) % 256)
        data = png_bytes(lot["width"], lot["height"], pixel)
        name = f"fiab-{index:02d}.png"
        (CORPUS / name).write_bytes(data)
        manifest.append({"file": name, "bytes": len(data), "sha256": sha256(data),
                         "width": lot["width"], "height": lot["height"]})
    (CORPUS / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"corpus: {len(manifest)} images in {CORPUS}")


def load_corpus():
    manifest = json.loads((CORPUS / "manifest.json").read_text())
    for item in manifest:
        if sha256((CORPUS / item["file"]).read_bytes()) != item["sha256"]:
            raise SystemExit(f"corpus file changed: {item['file']} (do not regenerate between versions)")
    return manifest


# ---------------------------------------------------------------- docker

class Stack:
    def __init__(self, source):
        self.source = Path(source).resolve()
        self.project = PROTOCOL["compose_project"]
        self.env = dict(os.environ, FIAB_DIR=str(HERE), FIAB_CTL=str(CTL))

    def compose(self, *args, timeout=600, check=True):
        cmd = ["docker", "compose", "-p", self.project,
               "-f", str(self.source / "docker-compose.yaml"), "-f", str(HERE / "compose.fiab.yaml"), *args]
        result = subprocess.run(cmd, cwd=self.source, env=self.env, capture_output=True, text=True, timeout=timeout)
        if check and result.returncode != 0:
            raise RuntimeError(f"{' '.join(args[:2])} failed: {result.stderr.strip()[-800:]}")
        return result.stdout

    def services(self):
        return ["nginx", "projects", "users", "api_gateway", "img_storage", "frontend"] + [f"{s}_tool" for s in PROTOCOL["fault_services"]]

    def up(self, build):
        CTL.mkdir(parents=True, exist_ok=True)
        self.compose("up", "-d", *(["--build"] if build else ["--no-build"]), *self.services(), timeout=3600)

    def check_shims(self):
        """Docker Desktop can start containers with empty bind mounts (e.g. right after it
        starts); a worker then runs without its shim and an armed fault never fires."""
        files = {f"{s}_tool": "/fault/shim/sitecustomize.py" for s in PROTOCOL["fault_services"]}
        files["projects"] = "/fault/shim/node/fault-shim.js"
        missing = [svc for svc, path in files.items()
                   if self.compose("exec", "-T", svc, "sh", "-c", f"test -s {path} && echo mounted",
                                   timeout=60, check=False).strip() != "mounted"]
        if missing:
            raise SystemExit(f"fault shims not mounted in {', '.join(missing)}: recreate the containers "
                             "(docker compose ... up -d --force-recreate --no-build) and run preflight again")

    def mongo(self, script):
        out = self.compose("exec", "-T", "projects_mongoDB", "mongo", "--quiet", "--port", "27018", "project",
                           "--eval", script, timeout=60)
        return json.loads(out.strip().splitlines()[-1])

    def queues(self):
        out = self.compose("exec", "-T", "rabbitmq", "rabbitmqctl", "-q", "list_queues",
                           "name", "messages_ready", "messages_unacknowledged", "consumers", timeout=60)
        table = {}
        for line in out.splitlines():
            parts = line.split()
            if len(parts) == 4 and parts[1].isdigit():
                table[parts[0]] = {"ready": int(parts[1]), "unacked": int(parts[2]), "consumers": int(parts[3])}
        return table

    def purge(self, queue):
        self.compose("exec", "-T", "rabbitmq", "rabbitmqctl", "-q", "purge_queue", queue, timeout=60, check=False)

    def logs(self, since, services):
        return self.compose("logs", "--no-color", "--timestamps", "--since", since, *services, timeout=120, check=False)

    def inventory(self):
        info = {"source": str(self.source)}
        git = lambda *a: subprocess.run(["git", "-C", str(self.source), *a], capture_output=True, text=True).stdout.strip()
        info["commit"] = git("rev-parse", "HEAD")
        info["dirty_files"] = git("status", "--porcelain", "--untracked-files=no").splitlines()
        run = lambda *a: subprocess.run(a, capture_output=True, text=True).stdout.strip()
        info["docker_version"] = run("docker", "version", "--format", "{{.Server.Version}}")
        info["docker_info"] = run("docker", "info", "--format", "{{.NCPU}} CPUs, {{.MemTotal}} bytes, {{.OperatingSystem}}, {{.KernelVersion}}")
        info["compose_version"] = run("docker", "compose", "version", "--short")
        info["images"] = self.compose("images", "--format", "json", check=False)
        info["harness_sha256"] = {p.name: sha256(p.read_bytes()) for p in
                                  [HERE / "fiab.py", HERE / "protocol.json", HERE / "compose.fiab.yaml",
                                   HERE / "faultshim" / "sitecustomize.py", HERE / "faultshim" / "node" / "fault-shim.js"]}
        return info


# ---------------------------------------------------------------- HTTP API

class APIError(RuntimeError):
    def __init__(self, method, path, status, body):
        super().__init__(f"{method} {path} -> HTTP {status}: {body[:200]!r}")
        self.status = status


class API:
    def __init__(self, base):
        self.url = urlsplit(base.rstrip("/"))
        # Self-signed certificate: allowed only for this local isolated instance.
        if self.url.scheme != "https" or self.url.hostname not in ("localhost", "127.0.0.1"):
            raise SystemExit("use an https://localhost URL")

    def connection(self, timeout=60):
        return http.client.HTTPSConnection(self.url.hostname, self.url.port or 443, timeout=timeout,
                                           context=ssl._create_unverified_context())

    def request(self, method, path, token=None, data=None, version=None, raw_body=None, headers=None):
        conn = self.connection()
        hdrs = dict(headers or {})
        body = raw_body
        if raw_body is None and data is not None:
            body = json.dumps(data)
            hdrs["Content-Type"] = "application/json"
        if token:
            hdrs["Authorization"] = "Bearer " + token
        if version is not None:
            hdrs["X-Project-Version"] = str(version)
        try:
            conn.request(method, self.url.path + path, body, hdrs)
            response = conn.getresponse()
            payload = response.read()
            if response.status >= 300:
                raise APIError(method, path, response.status, payload)
            text = payload.decode(errors="replace")
            return json.loads(text) if text.strip().startswith(("{", "[", '"')) else None
        finally:
            conn.close()

    def download(self, url):
        parts = urlsplit(url)
        if parts.hostname not in ("localhost", "127.0.0.1"):
            raise RuntimeError("signed URL does not point to the local test instance")
        conn = self.connection()
        try:
            conn.request("GET", parts.path + ("?" + parts.query if parts.query else ""))
            response = conn.getresponse()
            data = response.read()
            if response.status != 200:
                raise RuntimeError(f"download failed with HTTP {response.status}")
            return data
        finally:
            conn.close()

    # -- application calls

    def register(self, label):
        email = f"fiab-{label}-{uuid.uuid4().hex[:8]}@test.invalid"
        data = self.request("POST", "/users", data={"name": "fiab", "email": email,
                                                   "password": uuid.uuid4().hex, "type": "free"})
        token = data["jwt"] if isinstance(data["jwt"], str) else data["jwt"].get("token")
        return {"user_id": data["user"]["_id"], "token": token}

    def project(self, client, pid):
        return self.request("GET", f"/projects/{client['user_id']}/{pid}", client["token"])

    def create_project(self, client, name):
        return self.request("POST", f"/projects/{client['user_id']}", client["token"], data={"name": name})

    def upload_image(self, client, pid, name, data):
        boundary = "fiab-" + uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
                f"Content-Type: image/png\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
        version = self.project(client, pid)["version"]
        self.request("POST", f"/projects/{client['user_id']}/{pid}/img", client["token"], version=version,
                     raw_body=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})

    def add_tool(self, client, pid, tool):
        version = self.project(client, pid)["version"]
        self.request("POST", f"/projects/{client['user_id']}/{pid}/tool", client["token"], data=tool, version=version)

    def process(self, client, pid):
        version = self.project(client, pid)["version"]
        return self.request("POST", f"/projects/{client['user_id']}/{pid}/process", client["token"], data={}, version=version)

    def cancel(self, client, pid):
        version = self.project(client, pid)["version"]
        self.request("DELETE", f"/projects/{client['user_id']}/{pid}/process", client["token"], version=version)

    def results(self, client, pid):
        return self.request("GET", f"/projects/{client['user_id']}/{pid}/process/url", client["token"])

    def remaining_operations(self, client):
        try:
            data = self.request("GET", f"/users/{client['user_id']}", client["token"])
            return data.get("remaining_operations") if isinstance(data, dict) else None
        except Exception:
            return None

    def delete_project(self, client, pid):
        version = self.project(client, pid)["version"]
        self.request("DELETE", f"/projects/{client['user_id']}/{pid}", client["token"], version=version)


# ---------------------------------------------------------------- events

def read_events(directory=None):
    events = []
    for path in sorted((directory or CTL).glob("events-*.jsonl")):
        for line in path.read_text().splitlines():
            try:
                events.append(json.loads(line))
            except ValueError:
                pass
    return sorted(events, key=lambda e: e["ts"])


def reset_ctl():
    CTL.mkdir(parents=True, exist_ok=True)
    for path in CTL.iterdir():
        if path.is_file():
            path.unlink()


def arm(config, trial):
    data = {k: v for k, v in config.items() if k != "service"}
    data["trial"] = trial
    tmp = CTL / f".arm-{config['service']}.tmp"
    tmp.write_text(json.dumps(data))
    os.replace(tmp, CTL / f"arm-{config['service']}.json")


def release(service):
    (CTL / f"release-{service}").write_text("go")


def wait_event(predicate, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for event in read_events():
            if predicate(event):
                return event
        time.sleep(0.1)
    return None


# ---------------------------------------------------------------- trial

def mongo_state(stack, pid):
    return stack.mongo(
        "var p=db.projects.findOne({_id:ObjectId('%s')});"
        "var proc=db.processes.find({project_id:ObjectId('%s')}).toArray().map(function(d){return {msg_id:d.msg_id,img_id:d.img_id.str,cur_pos:d.cur_pos,token:d.token,state:d.state||null}});"
        "var res=db.results.find({project_id:ObjectId('%s')}).toArray().map(function(d){return {img_id:d.img_id.str,token:d.token,file_name:d.file_name,type:d.type}});"
        "print(JSON.stringify({activeToken:p?p.activeToken:null,committedToken:p?p.committedToken:null,processes:proc,results:res}))"
        % (pid, pid, pid))


def wait_ready(stack, timeout):
    """All fault-service queues and project_queue have a consumer."""
    wanted = [f"{s}_queue" for s in PROTOCOL["fault_services"]] + ["project_queue"]
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            table = stack.queues()
            if all(table.get(q, {}).get("consumers", 0) >= 1 for q in wanted):
                return table
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("services not ready (consumers missing)")


def timeline(events, t_start):
    """Fault, readiness and resumption times from the shim traces."""
    out = {"fault": None, "ready_after_fault": None, "resume": None, "deliveries": {},
           # Every armed action (crash, hold, duplicate) logs armed-target; projects logs fault.
           "fault_applied": any(e["event"] in ("armed-target", "fault") for e in events)}
    for event in events:
        if event["event"] == "receive" and event.get("msg_id"):
            out["deliveries"][event["msg_id"]] = out["deliveries"].get(event["msg_id"], 0) + 1
    fault = next((e for e in events if e["event"] == "fault"), None)
    if fault:
        out["fault"] = fault
        later = [e for e in events if e["ts"] > fault["ts"] and e["service"] == fault["service"]]
        ready = next((e for e in later if e["event"] in ("consume", "start") and e.get("boot") != fault.get("boot") and "npm" not in e.get("argv", "")), None)
        if ready:
            out["ready_after_fault"] = ready
        if fault.get("msg_id"):
            resume = next((e for e in later if e["event"] == "receive" and e.get("msg_id") == fault["msg_id"]), None)
            out["resume"] = resume
        for key in ("fault", "ready_after_fault", "resume"):
            if out[key]:
                out[key] = dict(out[key], t_rel=round(out[key]["ts"] - t_start, 3))
    out["max_deliveries"] = max(out["deliveries"].values(), default=0)
    return out


def evaluate(api, stack, client, pid, run_token, corpus, golden):
    state = mongo_state(stack, pid)
    names = {item["file"] for item in corpus}
    run_results = [r for r in state["results"] if r["token"] == run_token]
    per_file = {}
    for r in run_results:
        per_file[r["file_name"]] = per_file.get(r["file_name"], 0) + 1
    committed = state["committedToken"] == run_token
    files = {"missing": sorted(names - set(per_file)), "duplicated": sorted(f for f, n in per_file.items() if n > 1)}
    outputs = {}
    if committed:
        for item in api.results(client, pid).get("imgs", []):
            data = api.download(item["url"])
            outputs.setdefault(item["name"], []).append({"sha256": sha256(data), "size": png_size(data)})
    mismatched = []
    for name, entries in outputs.items():
        for entry in entries:
            if golden and golden.get(name) and entry["sha256"] != golden[name]["sha256"]:
                mismatched.append({"file": name, "size": entry["size"], "expected_size": golden[name]["size"]})
    originals = []
    project = api.project(client, pid)
    by_name = {item["file"]: item for item in corpus}
    for media in project.get("imgs", []):
        expected = by_name.get(media.get("name"))
        if expected and media.get("url"):
            if sha256(api.download(media["url"])) != expected["sha256"]:
                originals.append(media["name"])
    return {"committed": committed, "active_token": state["activeToken"], "committed_token": state["committedToken"],
            "run_token": run_token,
            # Original code deletes a Process when its job ends; the refactoring keeps it with a
            # terminal state (COMPLETED / FAILED). Only non-terminal documents are pending.
            "pending_processes": len([p for p in state["processes"] if p["token"] == run_token
                                      and p.get("state") not in TERMINAL_STATES]),
            "failed_jobs": len([p for p in state["processes"] if p["token"] == run_token and p.get("state") == "FAILED"]),
            "results_for_run": len(run_results), "lost_files": files["missing"], "duplicated_files": files["duplicated"],
            "output_mismatch": mismatched, "originals_altered": originals, "outputs": outputs}


def run_trial(api, stack, scenario_id, rep, folder, corpus, golden):
    scenario = PROTOCOL["scenarios"][scenario_id]
    trial = f"{scenario_id}-{rep:02d}"
    tdir = folder / trial
    tdir.mkdir(parents=True, exist_ok=False)
    record = {"trial": trial, "scenario": scenario_id, "description": scenario["description"], "rep": rep}

    reset_ctl()
    for queue in [f"{s}_queue" for s in PROTOCOL["fault_services"]] + ["project_queue"]:
        stack.purge(queue)
    record["queues_before"] = wait_ready(stack, PROTOCOL["ready_timeout_s"])

    client = api.register(trial.lower())
    project = api.create_project(client, f"fiab {trial}")
    pid = project["_id"]
    record.update(user_id=client["user_id"], project_id=pid)
    for item in corpus:
        api.upload_image(client, pid, item["file"], (CORPUS / item["file"]).read_bytes())
    for tool in scenario.get("pipeline_override", PROTOCOL["pipeline"]):
        api.add_tool(client, pid, tool)
    record["operations_before"] = api.remaining_operations(client)

    if scenario.get("arm"):
        arm(scenario["arm"], trial)
    log_since = datetime.datetime.now(datetime.timezone.utc).isoformat()
    t_start = time.time()
    m_start = time.monotonic()  # durations: immune to host clock corrections (WSL)
    record["t_start"] = t_start
    try:
        api.process(client, pid)
        record["process_http"] = "ok"
    except APIError as error:
        record["process_http"] = f"HTTP {error.status}"
    run_token = mongo_state(stack, pid)["activeToken"]

    if scenario.get("cancel_restart"):
        held = wait_event(lambda e: e["event"] == "hold" and e.get("trial") == trial, PROTOCOL["window_s"])
        record["held"] = bool(held)
        if held:
            t_cancel = time.time()
            api.cancel(client, pid)
            record["t_cancel"] = time.time() - t_start
            api.process(client, pid)
            run_token = mongo_state(stack, pid)["activeToken"]
            # Let the new run's first step finish so the held write lands on it (R7b).
            first = PROTOCOL["pipeline"][0]["procedure"]
            record["new_run_first_step_done"] = bool(wait_event(
                lambda e: sum(1 for x in read_events() if x["service"] == first
                              and x["event"] == "receive" and x["ts"] > t_cancel) >= len(corpus), 30))
            release(scenario["arm"]["service"])
            record["t_release"] = time.time() - t_start

    deadline = t_start + PROTOCOL["window_s"]
    t_done = None
    while time.time() < deadline:
        try:
            if api.results(client, pid).get("imgs"):
                t_done = time.time()
                m_done = time.monotonic()
                break
        except Exception:
            pass
        time.sleep(PROTOCOL["poll_s"])
    record["completed_in_window"] = t_done is not None
    record["duration_s"] = round(m_done - m_start, 3) if t_done else None

    if t_done is None or scenario.get("arm"):
        time.sleep(PROTOCOL["late_check_s"])  # late replies, redeliveries, persistence
    record["evaluation"] = evaluate(api, stack, client, pid, run_token, corpus, golden)
    record["operations_after"] = api.remaining_operations(client)
    events = read_events()
    record["timeline"] = timeline(events, t_start)
    record["queues_after"] = stack.queues()

    for path in CTL.glob("*"):
        if path.is_file():
            shutil.copy2(path, tdir / path.name)
    (tdir / "logs.txt").write_text(stack.logs(log_since, ["projects"] + [f"{s}_tool" for s in PROTOCOL["fault_services"]]))
    try:
        api.delete_project(client, pid)
        record["cleanup"] = "project deleted"
    except Exception as error:
        record["cleanup"] = f"failed: {error}"
    (tdir / "trial.json").write_text(json.dumps(record, indent=2, default=str))
    return record


TERMINAL_STATES = ("COMPLETED", "FAILED")
MAX_DELIVERIES_PERMANENT_ERROR = 3  # limit specified by Pessoa 1 (ENTREGA-P1-FIAB, M12)


def classify(record):
    ev = record["evaluation"]
    scenario = PROTOCOL["scenarios"][record["scenario"]]
    ok = (ev["committed"] and not ev["lost_files"] and not ev["duplicated_files"]
          and not ev["output_mismatch"] and not ev["originals_altered"])
    tl = record["timeline"]
    fault, ready, resume = tl.get("fault"), tl.get("ready_after_fault"), tl.get("resume")
    return {
        "trial": record["trial"], "scenario": record["scenario"],
        "fault_fired": tl.get("fault_applied", bool(fault)) if PROTOCOL["scenarios"][record["scenario"]].get("arm") else None,
        "completed_in_window": record["completed_in_window"], "committed_after_late_check": ev["committed"],
        "recovered_correctly": ok, "lost_files": len(ev["lost_files"]), "duplicated_results": len(ev["duplicated_files"]),
        "output_mismatch": len(ev["output_mismatch"]), "originals_altered": len(ev["originals_altered"]),
        "pending_processes": ev["pending_processes"], "max_deliveries": tl["max_deliveries"],
        "failed_jobs": ev.get("failed_jobs", 0), "error_notifications": record.get("error_notifications"),
        # M12: every job of a permanent error ends FAILED, with bounded deliveries and one
        # notification each. Only meaningful for expect_failure scenarios (R8).
        "permanent_error_handled": (ev.get("failed_jobs", 0) == len(json.loads((CORPUS / "manifest.json").read_text()))
                                    and tl["max_deliveries"] <= MAX_DELIVERIES_PERMANENT_ERROR
                                    and record.get("error_notifications") == ev.get("failed_jobs", 0))
                                   if scenario.get("expect_failure") else None,
        "duration_s": record["duration_s"],
        "fault_to_ready_s": round(ready["ts"] - fault["ts"], 3) if fault and ready else None,
        "ready_to_resume_s": round(resume["ts"] - ready["ts"], 3) if ready and resume else None,
        "operations_delta": (record["operations_after"] - record["operations_before"]
                             if isinstance(record["operations_before"], int) and isinstance(record["operations_after"], int) else None),
    }


def summarize(folder):
    rows = []
    for path in sorted(folder.glob("*/trial.json")):
        record = json.loads(path.read_text())
        # Recompute from the archived traces so later fixes of the analysis apply uniformly.
        record["timeline"] = timeline(read_events(path.parent), record["t_start"])
        logs = path.parent / "logs.txt"
        record["error_notifications"] = logs.read_text().count("[JOB-FAILED]") if logs.exists() else None
        rows.append(classify(record))
    if not rows:
        print("no trials")
        return
    with (folder / "trials.csv").open("w") as stream:
        stream.write(",".join(rows[0]) + "\n")
        for row in rows:
            stream.write(",".join("" if v is None else str(v) for v in row.values()) + "\n")
    summary = {}
    for row in rows:
        s = summary.setdefault(row["scenario"], {"trials": 0, "recovered_correctly": 0, "completed_in_window": 0,
                                                 "lost_files": 0, "duplicated_results": 0, "output_mismatch": 0,
                                                 "originals_altered": 0, "failed_jobs": 0, "permanent_error_handled": 0,
                                                 "durations": [], "ready_to_resume": []})
        s["trials"] += 1
        s["recovered_correctly"] += row["recovered_correctly"]
        s["completed_in_window"] += row["completed_in_window"]
        for key in ("lost_files", "duplicated_results", "output_mismatch", "originals_altered", "failed_jobs"):
            s[key] += row[key]
        s["permanent_error_handled"] += bool(row["permanent_error_handled"])
        if row["duration_s"] is not None:
            s["durations"].append(row["duration_s"])
        if row["ready_to_resume_s"] is not None:
            s["ready_to_resume"].append(row["ready_to_resume_s"])
    median = lambda v: sorted(v)[len(v) // 2] if len(v) % 2 else (sum(sorted(v)[len(v) // 2 - 1:len(v) // 2 + 1]) / 2 if v else None)
    for s in summary.values():
        s["median_duration_s"] = median(s.pop("durations"))
        s["median_ready_to_resume_s"] = median(s.pop("ready_to_resume"))
    (folder / "summary.json").write_text(json.dumps(summary, indent=2))
    width = max(len(k) for k in summary)
    print(f"{'scenario':<{width}}  trials  correct  in-window  lost  dup  mismatch  orig  median_s  resume_s")
    for key, s in summary.items():
        print(f"{key:<{width}}  {s['trials']:>6}  {s['recovered_correctly']:>7}  {s['completed_in_window']:>9}  "
              f"{s['lost_files']:>4}  {s['duplicated_results']:>3}  {s['output_mismatch']:>8}  {s['originals_altered']:>4}  "
              f"{s['median_duration_s']!s:>8}  {s['median_ready_to_resume_s']!s:>8}")


# ---------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("corpus", help="generate the image lot once (never regenerate between versions)")
    for name in ("up", "preflight", "run", "down"):
        p = sub.add_parser(name)
        p.add_argument("--source", required=True, help="source tree of the version under test")
        if name == "up":
            p.add_argument("--build", action="store_true", help="build images (first time only)")
        if name == "run":
            p.add_argument("--phase", required=True, choices=["pilot", "baseline", "final"])
            p.add_argument("--scenarios", default=",".join(PROTOCOL["scenarios"]))
            p.add_argument("--reps", type=int, default=PROTOCOL["repetitions"])
            p.add_argument("--campaign", help="resume into an existing campaign folder name")
    s = sub.add_parser("summarize")
    s.add_argument("campaign")
    args = parser.parse_args()

    if args.cmd == "corpus":
        if (CORPUS / "manifest.json").exists():
            raise SystemExit("corpus already exists; it must not be regenerated between versions")
        return make_corpus()
    if args.cmd == "summarize":
        return summarize(RUNS / args.campaign)

    stack = Stack(args.source)
    if args.cmd == "up":
        return stack.up(args.build)
    if args.cmd == "down":
        return stack.compose("stop", timeout=600)  # never removes volumes
    api = API(PROTOCOL["base_url"])
    if args.cmd == "preflight":
        load_corpus()
        print(json.dumps(stack.inventory(), indent=2)[:3000])
        print(json.dumps(wait_ready(stack, PROTOCOL["ready_timeout_s"]), indent=2))
        stack.check_shims()
        api.register("preflight")
        return print("preflight ok")

    corpus = load_corpus()
    stack.check_shims()
    name = args.campaign or f"{args.phase}-{uuid.uuid4().hex[:6]}"
    folder = RUNS / name
    folder.mkdir(parents=True, exist_ok=True)
    if not (folder / "environment.json").exists():
        (folder / "environment.json").write_text(json.dumps(
            {"phase": args.phase, "started": datetime.datetime.now().isoformat(), "protocol": PROTOCOL,
             "inventory": stack.inventory()}, indent=2))
    # The baseline freezes the reference outputs for every later campaign; a pilot only
    # compares against its own R0 so it never influences the official golden.
    golden_path = RUNS / "golden.json" if args.phase != "pilot" else folder / "golden.json"
    golden = json.loads(golden_path.read_text()) if golden_path.exists() else None
    for scenario_id in args.scenarios.split(","):
        for rep in range(1, args.reps + 1):
            if (folder / f"{scenario_id}-{rep:02d}" / "trial.json").exists():
                continue  # never repeat or replace a recorded trial
            print(f"[{name}] {scenario_id} rep {rep} ...", flush=True)
            record = run_trial(api, stack, scenario_id, rep, folder, corpus, golden)
            if golden is None and args.phase in ("baseline", "pilot") and scenario_id == "R0" and record["evaluation"]["committed"]:
                golden = {n: e[0] for n, e in record["evaluation"]["outputs"].items()}
                golden_path.write_text(json.dumps(golden, indent=2))
                print(f"golden outputs frozen from {record['trial']}")
            print("   ", json.dumps(classify(record)), flush=True)
    summarize(folder)


if __name__ == "__main__":
    sys.exit(main())
