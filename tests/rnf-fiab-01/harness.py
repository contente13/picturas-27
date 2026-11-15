"""RNF-FIAB-01 fault-injection harness (scenarios R0-R8).

Runs against the isolated Compose project "picturas-fiab" only (see compose.fiab.yaml and
docs/rnf-fiab-01/protocolo-baseline.md). Never touches the "picturas" project.

    python harness.py check
    python harness.py campaign --phase baseline
    python harness.py run --phase baseline --scenario R1 --reps 10 [--pilot]
    python harness.py summarize --phase baseline

Every failure window is proven by a log line ("RNF-FIAB-01 FAULT-POINT ...") emitted by
an inert-by-default hook; the harness only kills a process after reading that line.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import statistics
import subprocess
import sys
import time
import uuid

import pika
import requests
import urllib3
from bson import ObjectId
from pymongo import MongoClient

import corpus

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
EVIDENCE = os.path.join(REPO, "docs", "rnf-fiab-01", "evidencias")

PROJECT = "picturas-fiab"
PROJECTS_URL = "https://127.0.0.1:19002"
USERS_URL = "https://127.0.0.1:20001"
MONGO_URL = "mongodb://127.0.0.1:37018"
AMQP = ("127.0.0.1", 25672)
MGMT_URL = "http://127.0.0.1:25673"
TOOLS = ("border_tool", "brightness_tool", "rotate_tool")
QUEUES = ("border_queue", "brightness_queue", "rotate_queue", "project_queue", "ws_queue")

T_OBS_MIN = 120.0  # s, see especificacao-e-decisao.md section 4
HOOK_TIMEOUT = 60.0


def now():
    return dt.datetime.now(dt.timezone.utc)


def iso(t):
    return t.isoformat() if t else None


def secs(a, b):
    return round((b - a).total_seconds(), 3) if a and b else None


def sh(*args, check=True, input=None, env=None):
    return subprocess.run(args, check=check, capture_output=True, text=True, input=input, env=env)


def ctr(service):
    return f"{PROJECT}-{service}-1"


# --------------------------------------------------------------------------- environment

class Env:
    def __init__(self):
        mount = sh("podman", "volume", "inspect", f"{PROJECT}_image_data",
                   "--format", "{{.Mountpoint}}").stdout.strip()
        self.volume = mount
        self.hookdir = os.path.join(mount, ".rnf-fiab-01")
        os.makedirs(self.hookdir, exist_ok=True)
        env = json.loads(sh("podman", "inspect", ctr("rabbitmq"), "--format", "{{json .Config.Env}}").stdout)
        values = dict(item.split("=", 1) for item in env if "=" in item)
        self.amqp_credentials = (values["RABBITMQ_DEFAULT_USER"], values["RABBITMQ_DEFAULT_PASS"])
        self.db = MongoClient(MONGO_URL, tz_aware=True)["project"]
        self.http = requests.Session()
        self.http.verify = False

    # --- hooks
    def clear_hooks(self):
        for name in os.listdir(self.hookdir):
            os.remove(os.path.join(self.hookdir, name))

    def arm(self, cfg):
        path = os.path.join(self.hookdir, "fault.json")
        with open(path + ".tmp", "w", encoding="utf-8") as handle:
            json.dump(cfg, handle)
        os.replace(path + ".tmp", path)

    def release(self, fault_id):
        open(os.path.join(self.hookdir, f"release-{fault_id}"), "w").close()

    def captured(self, fault_id):
        with open(os.path.join(self.hookdir, f"captured-{fault_id}.json"), encoding="utf-8") as handle:
            return handle.read()

    # --- broker
    def mgmt(self, method, path):
        response = requests.request(method, MGMT_URL + path, auth=self.amqp_credentials, timeout=10)
        response.raise_for_status()
        return response.json() if response.content else None

    def queue_state(self):
        state = {}
        for queue in QUEUES:
            info = self.mgmt("GET", f"/api/queues/%2F/{queue}")
            state[queue] = {"ready": info.get("messages_ready", 0),
                            "unacked": info.get("messages_unacknowledged", 0),
                            "consumers": info.get("consumers", 0)}
        return state

    def purge(self):
        for queue in QUEUES:
            self.mgmt("DELETE", f"/api/queues/%2F/{queue}/contents")

    def publish_reply(self, body):
        user, password = self.amqp_credentials
        params = pika.ConnectionParameters(AMQP[0], AMQP[1], "/", pika.PlainCredentials(user, password))
        connection = pika.BlockingConnection(params)
        try:
            channel = connection.channel()
            channel.confirm_delivery()
            channel.basic_publish(exchange="picturas", routing_key="project_queue", body=body)
        finally:
            connection.close()

    # --- containers
    def running(self, service):
        out = sh("podman", "inspect", ctr(service), "--format", "{{.State.Running}}", check=False).stdout
        return out.strip() == "true"

    def kill(self, service):
        sh("podman", "kill", "-s", "KILL", ctr(service))
        deadline = time.time() + 30
        while self.running(service) and time.time() < deadline:
            time.sleep(0.05)
        return now()

    def start(self, service):
        started = now()
        sh("podman", "start", ctr(service))
        return started

    def lines(self, service, since):
        out = sh("podman", "logs", "--since", since.strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
                 ctr(service), check=False)
        return (out.stdout + out.stderr).splitlines()

    def events(self, service, since, event=None):
        found = []
        for line in self.lines(service, since):
            match = re.match(r"^RNF-FIAB-01 (\S+) (.*)$", line.strip())
            if not match or (event and match.group(1) != event):
                continue
            fields = dict(re.findall(r"(\w+)=(\S+)", match.group(2)))
            fields["event"] = match.group(1)
            ts = dt.datetime.fromisoformat(fields.get("ts", "").replace("Z", "+00:00")) if fields.get("ts") else None
            if ts and ts >= since:
                fields["at"] = ts
                found.append(fields)
        return found

    def wait_event(self, service, since, event, predicate=lambda e: True, timeout=HOOK_TIMEOUT):
        deadline = time.time() + timeout
        while time.time() < deadline:
            for item in self.events(service, since, event):
                if predicate(item):
                    return item
            time.sleep(0.1)
        return None

    def wait_ready(self, service, since, timeout=90):
        ready = self.wait_event(service, since, "READY", timeout=timeout)
        if service == "projects" and ready:
            deadline = time.time() + timeout
            while time.time() < deadline:
                try:
                    self.http.get(PROJECTS_URL + "/000000000000000000000000", timeout=2)
                    break
                except requests.RequestException:
                    time.sleep(0.1)
        return ready

    def ensure_up(self):
        for service in ("projects",) + TOOLS:
            if not self.running(service):
                since = self.start(service)
                if not self.wait_ready(service, since):
                    raise RuntimeError(f"{service} did not become READY")

    # --- application
    def create_user(self):
        email = f"rnf-fiab-01-{uuid.uuid4().hex[:12]}@example.invalid"
        response = self.http.post(USERS_URL + "/", json={
            "name": "rnf-fiab-01", "email": email, "password": secrets.token_urlsafe(24), "type": "free"},
            timeout=20)
        response.raise_for_status()
        return response.json()["user"]["_id"]

    def operations(self, user):
        data = self.http.get(f"{USERS_URL}/{user}", timeout=20).json()
        return {"operations": [{"day": o.get("day"), "processed": o.get("processed")} for o in data.get("operations", [])],
                "remaining": data.get("remaining_operations")}

    def version(self, project):
        return self.db.projects.find_one({"_id": ObjectId(project)})["version"]

    def call(self, method, path, user, project=None, **kw):
        headers = {"x-caller-id": user}
        if project:
            headers["x-project-version"] = str(self.version(project))
        return self.http.request(method, PROJECTS_URL + path, headers=headers, timeout=60, **kw)

    def new_project(self, user, name, files, pipeline):
        response = self.call("POST", f"/{user}", user, json={"name": name})
        response.raise_for_status()
        project = response.json()["_id"]
        for file_name, data in files:
            r = self.call("POST", f"/{user}/{project}/img", user, project,
                          files={"image": (file_name, data, "image/png")})
            if r.status_code >= 300:
                raise RuntimeError(f"upload {file_name}: {r.status_code} {r.text}")
        for tool in pipeline:
            r = self.call("POST", f"/{user}/{project}/tool", user, project, json=tool)
            if r.status_code >= 300:
                raise RuntimeError(f"tool {tool}: {r.status_code} {r.text}")
        return project

    def start_run(self, user, project):
        sent = now()
        response = self.call("POST", f"/{user}/{project}/process", user, project)
        answered = now()
        doc = self.db.projects.find_one({"_id": ObjectId(project)})
        return {"status": response.status_code, "t_post": sent, "t_post_answer": answered,
                "token": doc.get("activeToken", 0)}

    def cancel_run(self, user, project):
        response = self.call("DELETE", f"/{user}/{project}/process", user, project)
        return response.status_code

    def wait_commit(self, project, token, deadline):
        oid = ObjectId(project)
        while now() < deadline:
            doc = self.db.projects.find_one({"_id": oid}, {"committedToken": 1})
            if doc and doc.get("committedToken") == token:
                seen = now()
                # M8: how many results existed when the run became visible.
                self.results_at_commit = self.db.results.count_documents({"project_id": oid, "token": token})
                return seen
            time.sleep(0.02)
        return None

    def inspect(self, user, project, objects):
        if not objects:
            return []
        with open(os.path.join(HERE, "inspect_objects.js"), encoding="utf-8") as handle:
            script = handle.read()
        def run(batch):
            # One retry on a failed exec (e.g. exit 137): an inspection failure is a measurement
            # problem, not an outcome of the scenario.
            for attempt in (1, 2):
                try:
                    out = sh("podman", "exec", "-i", "-e", "RNF_FIAB_01_OBJECTS=" + json.dumps(batch),
                             ctr("projects"), "node", "-", user, project, input=script)
                    return json.loads(out.stdout.strip().splitlines()[-1])
                except subprocess.CalledProcessError:
                    if attempt == 2:
                        raise
                    time.sleep(2)
        entries = run(objects)
        # Objects that could not be fetched/decoded are read once more after 2 s; both attempts
        # are recorded, so a persistent problem stays visible as "unreadable".
        retry = [{"stage": e["stage"], "key": e["key"]} for e in entries
                 if e.get("error") or e.get("decode_error")]
        if retry:
            time.sleep(2)
            again = {(e["stage"], e["key"]): e for e in run(retry)}
            for i, e in enumerate(entries):
                second = again.get((e["stage"], e["key"]))
                if second is not None:
                    second["first_attempt"] = {k: e[k] for k in ("error", "decode_error") if k in e}
                    entries[i] = second
        return entries


# --------------------------------------------------------------------------- verification

def corpus_files(include_invalid=False):
    manifest = corpus.load_manifest()
    files = []
    for entry in manifest["images"]:
        with open(os.path.join(corpus.DATA, entry["name"]), "rb") as handle:
            files.append((entry["name"], handle.read()))
    if include_invalid:
        with open(os.path.join(corpus.DATA, manifest["invalid"]["name"]), "rb") as handle:
            files.append((manifest["invalid"]["name"], handle.read()))
    return manifest, files


def verify(env, user, project, token, manifest, expect_names):
    """Count, deduplicate and hash the results of one execution, plus original integrity."""
    oid = ObjectId(project)
    doc = env.db.projects.find_one({"_id": oid})
    results = list(env.db.results.find({"project_id": oid, "token": token}))
    processes = env.db.processes.count_documents({"project_id": oid, "token": token})
    by_media = {}
    for result in results:
        by_media.setdefault(str(result["img_id"]), []).append(result)
    expected = {e["name"]: e for e in manifest["images"]}
    names = {str(img["_id"]): os.path.basename(img["og_uri"]) for img in doc["imgs"]}

    objects = [{"stage": "out", "key": r["img_key"]} for r in results]
    objects += [{"stage": "src", "key": img["og_img_key"]} for img in doc["imgs"]]
    inspected = {(o["stage"], o["key"]): o for o in env.inspect(user, project, objects)}

    media = []
    correct = reapplied = unreadable = 0
    for img_id, name in sorted(names.items(), key=lambda kv: kv[1]):
        items = by_media.get(img_id, [])
        hashes = [inspected.get(("out", r["img_key"]), {}) for r in items]
        ref = expected.get(name)
        ok = [h for h in hashes if ref and h.get("pixel_sha256") == ref["expected_pixel_sha256"]]
        # Decoded but wrong pixels => effect re-applied / mixed chain; no pixels => unreadable.
        bad = [h for h in hashes if ref and h.get("pixel_sha256") and h["pixel_sha256"] != ref["expected_pixel_sha256"]]
        lost = [h for h in hashes if ref and not h.get("pixel_sha256")]
        if ok and not bad and not lost:
            correct += 1
        reapplied += len(bad)
        unreadable += len(lost)
        media.append({"name": name, "img_id": img_id, "results": len(items),
                      "pixel_ok": len(ok), "pixel_mismatch": len(bad), "unreadable": len(lost),
                      "dims": sorted({(h.get("width"), h.get("height")) for h in hashes},
                                     key=lambda d: tuple(-1 if x is None else x for x in d)),
                      "inspect_errors": [{k: h[k] for k in ("error", "decode_error", "first_attempt") if k in h}
                                         for h in hashes if h.get("error") or h.get("decode_error") or h.get("first_attempt")]})

    originals_changed = 0
    for img in doc["imgs"]:
        name = os.path.basename(img["og_uri"])
        want = expected.get(name, {}).get("sha256") or (
            manifest["invalid"]["sha256"] if name == manifest["invalid"]["name"] else None)
        got = inspected.get(("src", img["og_img_key"]), {}).get("sha256")
        local = os.path.join(env.volume, img["og_uri"].replace("./images/", "", 1))
        local_sha = None
        if os.path.exists(local):
            with open(local, "rb") as handle:
                local_sha = hashlib.sha256(handle.read()).hexdigest()
        if got != want or (local_sha is not None and local_sha != want):
            originals_changed += 1

    duplicates = sum(max(0, len(v) - 1) for v in by_media.values())
    return {
        "committed_token": doc.get("committedToken"), "active_token": doc.get("activeToken"),
        "token": token, "results_total": len(results), "media_with_result": len(by_media),
        "media_expected": expect_names, "media_correct": correct, "duplicates": duplicates,
        "reapplied": reapplied, "unreadable": unreadable, "missing": max(0, expect_names - len(by_media)),
        "originals_changed": originals_changed, "pending_processes": processes, "media": media,
    }


SANITIZE = re.compile(r"(?i)(bearer\s+\S+|password\S*|jwt\S*|authorization\S*|X-Amz-\S+)")


def excerpt(env, since, services):
    keep = re.compile(r"RNF-FIAB-01|\[COMMIT|\[RUN-GUARD|\[process_msg\]|Traceback|Error|Exception")
    lines = []
    for service in services:
        for line in env.lines(service, since):
            if keep.search(line):
                lines.append(f"{service}: {SANITIZE.sub('<redacted>', line.strip())[:400]}")
    return lines[-400:]


# --------------------------------------------------------------------------- scenarios

BRIGHTNESS = corpus.PIPELINE  # border(0) -> brightness(1) -> rotate(2)
TARGET_IMAGE = "img03.png"

WORKER_FAULTS = {
    "R1": ("brightness_tool", "after_receive"),
    "R2": ("brightness_tool", "during_write"),
    "R3": ("brightness_tool", "after_output_before_reply"),
    "R4": ("brightness_tool", "after_reply_before_ack"),
}
PROJECTS_FAULTS = {
    "R6a": {"point": "after_receive", "match": TARGET_IMAGE},
    "R6b": {"point": "after_process_delete", "match": TARGET_IMAGE, "cur_pos": 1},
    "R6c": {"point": "before_next_publish", "match": TARGET_IMAGE, "cur_pos": 1},
    "R6d": {"point": "after_result_persist", "match": TARGET_IMAGE, "cur_pos": 2},
    "R6e": {"point": "before_commit"},
}
SCENARIOS = ["R0", "R1", "R2", "R3", "R4", "R5a", "R5b", "R5c",
             "R6a", "R6b", "R6c", "R6d", "R6e", "R7", "R8a", "R8b"]


class Rep:
    def __init__(self, env, phase, scenario, rep, t_obs, pilot):
        self.env, self.phase, self.scenario, self.rep, self.t_obs = env, phase, scenario, rep, t_obs
        self.fault_id = f"{scenario}-{rep:02d}-{uuid.uuid4().hex[:6]}"
        self.record = {"requirement": "RNF-FIAB-01", "phase": phase, "scenario": scenario,
                       "rep": rep, "pilot": pilot, "fault_id": self.fault_id, "timestamps": {},
                       "fault": None, "notes": []}

    def ts(self, key, value):
        self.record["timestamps"][key] = iso(value)

    def prepare(self, include_invalid=False, pipeline=None):
        env = self.env
        env.clear_hooks()
        env.ensure_up()
        self.record["queues_before"] = env.queue_state()
        env.purge()
        self.manifest, files = corpus_files(include_invalid)
        self.user = env.create_user()
        self.ops_before = env.operations(self.user)
        self.project = env.new_project(self.user, f"rnf-fiab-01-{self.scenario}-{self.rep}", files,
                                       pipeline or BRIGHTNESS)
        self.expect = len(files)
        self.t0 = now()
        self.ts("t_setup_done", self.t0)
        self.record.update({"user": self.user, "project": self.project, "media": len(files)})

    def finish(self, token, t_commit, services, base_time=None):
        env = self.env
        env.ensure_up()
        self.ts("t_commit", t_commit)
        self.record["committed"] = t_commit is not None
        self.record["results_at_commit"] = getattr(env, "results_at_commit", None) if t_commit else None
        env.results_at_commit = None
        self.record["verify"] = verify(env, self.user, self.project, token, self.manifest, self.expect)
        self.record["ops_before"] = self.ops_before
        self.record["ops_after"] = env.operations(self.user)
        self.record["quota_delta"] = _processed(self.record["ops_after"]) - _processed(self.ops_before)
        self.record["queues_after"] = env.queue_state()
        self.record["log_excerpt"] = excerpt(env, self.t0, services)
        if base_time:
            self.record["duration_s"] = secs(base_time, t_commit)
        env.clear_hooks()
        return self.record


def _processed(ops):
    return sum(o.get("processed") or 0 for o in ops.get("operations", []))


def r0(rep):
    rep.prepare()
    run = rep.env.start_run(rep.user, rep.project)
    rep.ts("t_post", run["t_post"])
    rep.record["post_status"] = run["status"]
    t_commit = rep.env.wait_commit(rep.project, run["token"], run["t_post"] + dt.timedelta(seconds=rep.t_obs))
    return rep.finish(run["token"], t_commit, ("projects",) + TOOLS, base_time=run["t_post"])


def kill_scenario(rep, service, cfg):
    env = rep.env
    rep.prepare()
    cfg = {"id": rep.fault_id, "target": service, "action": "block", **cfg}
    rep.record["fault"] = cfg
    env.arm(cfg)
    run = env.start_run(rep.user, rep.project)
    rep.ts("t_post", run["t_post"])
    rep.record["post_status"] = run["status"]
    fault = env.wait_event(service, rep.t0, "FAULT-POINT", lambda e: e.get("id") == rep.fault_id)
    if not fault:
        rep.record["notes"].append("fault point not reached: run is INVALID for this scenario")
        t_commit = env.wait_commit(rep.project, run["token"], now() + dt.timedelta(seconds=rep.t_obs))
        return rep.finish(run["token"], t_commit, ("projects",) + TOOLS)
    rep.ts("t_fault", fault["at"])
    rep.record["fault_msg"] = fault.get("msg")
    if cfg["point"] == "after_reply_before_ack":
        # Proof that the broker accepted the reply: projects received it.
        seen = env.wait_event("projects", rep.t0, "RECEIVED", lambda e: e.get("msg") == fault.get("msg"))
        rep.ts("t_reply_seen_by_projects", seen["at"] if seen else None)
        if not seen:
            rep.record["notes"].append("reply not observed at projects before kill")
    t_kill = env.kill(service)
    rep.ts("t_kill", t_kill)
    t_start = env.start(service)
    ready = env.wait_ready(service, t_start)
    t_ready = ready["at"] if ready else None
    rep.ts("t_ready", t_ready)
    deadline = (t_ready or now()) + dt.timedelta(seconds=rep.t_obs)
    t_commit = env.wait_commit(rep.project, run["token"], deadline)
    resumed = env.events(service, t_ready, "RECEIVED") if t_ready else []
    resumed = [e for e in resumed if e.get("msg") == fault.get("msg")]
    t_resume = resumed[0]["at"] if resumed else None
    rep.ts("t_resume", t_resume)
    rep.record["resume_s"] = secs(t_ready, t_resume)
    rep.record["complete_after_fault_s"] = secs(fault["at"], t_commit)
    return rep.finish(run["token"], t_commit, ("projects",) + TOOLS, base_time=run["t_post"])


def r5(rep, variant):
    env = rep.env
    rep.prepare()
    if variant in ("a", "b"):
        target = "rotate_tool" if variant == "a" else "border_tool"
        cfg = {"id": rep.fault_id, "target": target, "point": "after_reply_before_ack",
               "match": TARGET_IMAGE, "action": "duplicate", "count": 3}
    else:
        target = "rotate_tool"
        cfg = {"id": rep.fault_id, "target": target, "point": "after_reply_before_ack",
               "match": TARGET_IMAGE, "action": "capture"}
    rep.record["fault"] = cfg
    env.arm(cfg)
    run = env.start_run(rep.user, rep.project)
    rep.ts("t_post", run["t_post"])
    fault = env.wait_event(target, rep.t0, "FAULT-POINT", lambda e: e.get("id") == rep.fault_id)
    rep.ts("t_fault", fault["at"] if fault else None)
    msg = fault.get("msg") if fault else None
    copies = 3 if variant in ("a", "b") else 2
    t_commit = env.wait_commit(rep.project, run["token"], run["t_post"] + dt.timedelta(seconds=rep.t_obs))
    if variant == "c" and fault:
        # Sequential duplicate, delivered after the original was processed and committed.
        env.publish_reply(env.captured(rep.fault_id))
        rep.ts("t_duplicate_published", now())
    received = env.wait_event("projects", rep.t0, "RECEIVED",
                              lambda e: e.get("msg") == msg and
                              len([x for x in env.events("projects", rep.t0, "RECEIVED") if x.get("msg") == msg]) >= copies,
                              timeout=30)
    rep.ts("t_all_copies_received", received["at"] if received else None)
    # Observation window for late side effects of the copies (not a failure proof).
    settle_until = time.time() + 30
    oid = ObjectId(rep.project)
    while time.time() < settle_until and env.db.processes.count_documents({"project_id": oid, "token": run["token"]}):
        time.sleep(0.05)
    time.sleep(2)
    rep.record["copies_delivered"] = len([x for x in env.events("projects", rep.t0, "RECEIVED") if x.get("msg") == msg])
    if t_commit is None:
        t_commit = env.wait_commit(rep.project, run["token"], now())
    return rep.finish(run["token"], t_commit, ("projects", target), base_time=run["t_post"])


def r7(rep):
    env = rep.env
    rep.prepare()
    cfg = {"id": rep.fault_id, "target": "brightness_tool", "point": "before_write",
           "match": TARGET_IMAGE, "action": "block"}
    rep.record["fault"] = cfg
    env.arm(cfg)
    old = env.start_run(rep.user, rep.project)
    rep.ts("t_post_old", old["t_post"])
    fault = env.wait_event("brightness_tool", rep.t0, "FAULT-POINT", lambda e: e.get("id") == rep.fault_id)
    rep.ts("t_fault", fault["at"] if fault else None)
    rep.record["cancel_status"] = env.cancel_run(rep.user, rep.project)
    rep.ts("t_cancel", now())
    new = env.start_run(rep.user, rep.project)
    rep.ts("t_post_new", new["t_post"])
    rep.record["tokens"] = {"old": old["token"], "new": new["token"]}
    # Barrier: every media of the new run has finished border (cur_pos >= 1 registered).
    oid = ObjectId(rep.project)
    deadline = time.time() + 60
    while time.time() < deadline:
        procs = list(env.db.processes.find({"project_id": oid, "token": new["token"]}, {"cur_pos": 1}))
        if len(procs) == rep.expect and all(p["cur_pos"] >= 1 for p in procs):
            break
        time.sleep(0.05)
    else:
        rep.record["notes"].append("new run did not reach the brightness step before release")
    rep.ts("t_new_run_at_step1", now())
    env.release(rep.fault_id)
    rep.ts("t_release", now())
    t_commit = env.wait_commit(rep.project, new["token"], new["t_post"] + dt.timedelta(seconds=rep.t_obs))
    record = rep.finish(new["token"], t_commit, ("projects",) + TOOLS, base_time=new["t_post"])
    record["old_results"] = env.db.results.count_documents({"project_id": oid, "token": old["token"]})
    return record


def r8(rep, variant):
    env = rep.env
    if variant == "a":
        rep.prepare(include_invalid=True)
    else:
        bad = json.loads(json.dumps(BRIGHTNESS))
        bad[1]["params"]["brightness"] = "invalid"
        rep.prepare(pipeline=bad)
        rep.record["pipeline"] = bad
    run = env.start_run(rep.user, rep.project)
    rep.ts("t_post", run["t_post"])
    t_commit = env.wait_commit(rep.project, run["token"], run["t_post"] + dt.timedelta(seconds=rep.t_obs))
    record = rep.finish(run["token"], t_commit, ("projects",) + TOOLS, base_time=run["t_post"])
    target = "border_tool" if variant == "a" else "brightness_tool"
    deliveries = {}
    for item in env.events(target, rep.t0, "RECEIVED"):
        deliveries[item.get("msg")] = deliveries.get(item.get("msg"), 0) + 1
    record["max_deliveries_per_msg"] = max(deliveries.values()) if deliveries else 0
    record["worker_running_after"] = env.running(target)
    record["error_notified"] = any("[process_msg]" in l or "status=error" in l for l in record["log_excerpt"])
    return record


def run_one(env, phase, scenario, rep_no, t_obs, pilot):
    rep = Rep(env, phase, scenario, rep_no, t_obs, pilot)
    if scenario == "R0":
        return r0(rep)
    if scenario in WORKER_FAULTS:
        service, point = WORKER_FAULTS[scenario]
        return kill_scenario(rep, service, {"point": point, "match": TARGET_IMAGE})
    if scenario in PROJECTS_FAULTS:
        return kill_scenario(rep, "projects", dict(PROJECTS_FAULTS[scenario]))
    if scenario.startswith("R5"):
        return r5(rep, scenario[-1])
    if scenario == "R7":
        return r7(rep)
    if scenario.startswith("R8"):
        return r8(rep, scenario[-1])
    raise SystemExit(f"unknown scenario {scenario}")


# --------------------------------------------------------------------------- campaign

def campaign_metadata(phase):
    git = lambda *a: sh("git", "-C", REPO, *a).stdout.strip()  # noqa: E731
    images = {}
    for service in ("rabbitmq", "projects_mongoDB", "projects", "users", "img_storage", "seaweedfs") + TOOLS:
        out = sh("podman", "inspect", ctr(service), "--format", "{{.ImageName}} {{.Image}}", check=False).stdout.split()
        images[service] = {"image": out[0] if out else None, "id": out[1] if len(out) > 1 else None}
    config = sh("podman", "compose", "-p", PROJECT, "-f", os.path.join(REPO, "docker-compose.yaml"),
                "-f", os.path.join(HERE, "compose.fiab.yaml"), "config", check=False).stdout
    with open(corpus.MANIFEST, "rb") as handle:
        manifest_sha = hashlib.sha256(handle.read()).hexdigest()
    return {
        "requirement": "RNF-FIAB-01", "phase": phase, "created": iso(now()),
        "git": {"sha": git("rev-parse", "HEAD"), "branch": git("rev-parse", "--abbrev-ref", "HEAD"),
                "status": git("status", "--porcelain").splitlines()},
        "runtime": {"podman": sh("podman", "--version").stdout.strip(),
                    "compose": sh("podman", "compose", "version", check=False).stdout.strip().splitlines()[-1:],
                    "kernel": os.uname().release, "cpus": os.cpu_count()},
        "images": images,
        "compose_config_sha256": hashlib.sha256(config.encode()).hexdigest(),
        "hooks_enabled_on": ["projects"] + list(TOOLS),
        "corpus_manifest_sha256": manifest_sha,
        "t_obs_min_s": T_OBS_MIN,
    }


def out_dir(phase, scenario=None, pilot=False):
    base = os.path.join(EVIDENCE, phase + ("-pilot" if pilot else ""))
    return os.path.join(base, scenario) if scenario else base


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, default=str)
        handle.write("\n")


def t_obs_for(phase):
    path = os.path.join(out_dir(phase), "summary.json")
    try:
        with open(path, encoding="utf-8") as handle:
            r0 = json.load(handle)["scenarios"]["R0"]["duration_median_s"]
        return max(10 * r0, T_OBS_MIN)
    except (OSError, KeyError, TypeError, ValueError):
        return T_OBS_MIN


def cmd_run(args):
    env = Env()
    corpus.verify()
    # A partial re-run (--only-reps) keeps the original campaign.json and records its own metadata.
    meta_name = ("campaign-rerun-" + now().strftime("%Y%m%dT%H%M%SZ") + ".json") if args.only_reps else "campaign.json"
    write_json(os.path.join(out_dir(args.phase, pilot=args.pilot), meta_name), campaign_metadata(args.phase))
    t_obs = args.t_obs or t_obs_for(args.phase)
    only = [int(x) for x in args.only_reps.split(",")] if args.only_reps else None
    scenarios = SCENARIOS if args.scenario == "all" else args.scenario.split(",")
    for scenario in scenarios:
        for rep_no in (only or range(1, args.reps + 1)):
            existing = os.path.join(out_dir(args.phase, scenario, args.pilot), f"rep-{rep_no:02d}.json")
            if only and os.path.exists(existing):
                # Re-runs are allowed only for harness errors; the old record is kept as evidence.
                with open(existing, encoding="utf-8") as handle:
                    if not json.load(handle).get("harness_error"):
                        sys.exit(f"{existing} is a valid measurement; refusing to replace it")
                os.replace(existing, os.path.join(os.path.dirname(existing), f"superseded-rep-{rep_no:02d}.json"))
            started = time.time()
            try:
                record = run_one(env, args.phase, scenario, rep_no, t_obs, args.pilot)
            except Exception as error:  # noqa: BLE001 - failed runs stay in the denominator
                record = {"requirement": "RNF-FIAB-01", "phase": args.phase, "scenario": scenario,
                          "rep": rep_no, "harness_error": repr(error)}
                try:
                    env.clear_hooks()
                    env.ensure_up()
                except Exception as recovery:  # noqa: BLE001
                    record["recovery_error"] = repr(recovery)
            record["t_obs_s"] = t_obs
            record["wall_s"] = round(time.time() - started, 2)
            write_json(os.path.join(out_dir(args.phase, scenario, args.pilot), f"rep-{rep_no:02d}.json"), record)
            v = record.get("verify", {})
            print(f"{scenario} rep {rep_no}: committed={record.get('committed')} "
                  f"correct={v.get('media_correct')}/{v.get('media_expected')} dup={v.get('duplicates')} "
                  f"reapplied={v.get('reapplied')} resume={record.get('resume_s')} "
                  f"dur={record.get('duration_s')} err={record.get('harness_error')}", flush=True)


def _stats(values):
    values = [v for v in values if v is not None]
    if not values:
        return None
    values.sort()
    q = statistics.quantiles(values, n=4) if len(values) >= 2 else [values[0]] * 3
    return {"n": len(values), "median": round(statistics.median(values), 3), "q1": round(q[0], 3),
            "q3": round(q[2], 3), "min": values[0], "max": values[-1]}


def _reapplied(v):
    # Records written before the "unreadable" class existed counted an output without decoded
    # pixels (dims [None, None]) as a mismatch; reclassify those from the per-media detail.
    if "unreadable" in v:
        return v.get("reapplied", 0) or 0
    return sum(m["pixel_mismatch"] for m in v.get("media", [])
               if not any(d[0] is None for d in m.get("dims", [])))


def _unreadable(v):
    if "unreadable" in v:
        return v["unreadable"]
    return sum(m["pixel_mismatch"] for m in v.get("media", [])
               if any(d[0] is None for d in m.get("dims", [])))


def cmd_summarize(args):
    base = out_dir(args.phase, pilot=args.pilot)
    summary = {"requirement": "RNF-FIAB-01", "phase": args.phase, "scenarios": {}}
    for scenario in SCENARIOS:
        directory = os.path.join(base, scenario)
        if not os.path.isdir(directory):
            continue
        reps = []
        superseded = sorted(n for n in os.listdir(directory) if n.startswith("superseded-"))
        for name in sorted(n for n in os.listdir(directory) if n.startswith("rep-")):
            with open(os.path.join(directory, name), encoding="utf-8") as handle:
                reps.append(json.load(handle))
        v = [r.get("verify", {}) for r in reps]
        recoverable = scenario in WORKER_FAULTS or scenario in PROJECTS_FAULTS
        jobs_expected = sum(x.get("media_expected", 0) or 0 for x in v)
        entry = {
            "reps": len(reps),
            "harness_errors": sum(1 for r in reps if r.get("harness_error")),
            "fault_not_reached": sum(1 for r in reps if any("not reached" in n for n in r.get("notes", []))),
            "runs_committed": sum(1 for r in reps if r.get("committed")),
            "jobs_expected": jobs_expected,
            "jobs_correct": sum(x.get("media_correct", 0) or 0 for x in v),
            "jobs_missing": sum(x.get("missing", 0) or 0 for x in v),
            "duplicates": sum(x.get("duplicates", 0) or 0 for x in v),
            "reapplied": sum(_reapplied(x) for x in v),
            "unreadable": sum(_unreadable(x) for x in v),
            "superseded_harness_errors": len(superseded),
            "originals_changed": sum(x.get("originals_changed", 0) or 0 for x in v),
            "quota_delta_total": sum(r.get("quota_delta", 0) or 0 for r in reps),
            "resumed": sum(1 for r in reps if r.get("resume_s") is not None),
            "resume_s": _stats([r.get("resume_s") for r in reps]),
            "complete_after_fault_s": _stats([r.get("complete_after_fault_s") for r in reps]),
            "duration_s": _stats([r.get("duration_s") for r in reps]),
            "premature_commits": sum(1 for r in reps if r.get("committed") and
                                     (r.get("results_at_commit") or 0) < (r.get("verify", {}).get("media_expected") or 0)),
        }
        if recoverable:
            # A run is "completed correctly" only if committed with every job correct.
            entry["recoverable_runs_ok"] = sum(
                1 for r in reps if r.get("committed") and r.get("verify", {}).get("media_correct") == r.get("verify", {}).get("media_expected")
                and not r.get("verify", {}).get("duplicates"))
        if scenario.startswith("R8"):
            entry["max_deliveries_per_msg"] = max((r.get("max_deliveries_per_msg") or 0) for r in reps)
            entry["worker_running_after"] = sum(1 for r in reps if r.get("worker_running_after"))
        if scenario == "R0" and entry["duration_s"]:
            entry["duration_median_s"] = entry["duration_s"]["median"]
        summary["scenarios"][scenario] = entry
    write_json(os.path.join(base, "summary.json"), summary)
    print(json.dumps(summary, indent=2))


def cmd_check(_args):
    env = Env()
    corpus.verify()
    print("hookdir:", env.hookdir)
    print("queues:", json.dumps(env.queue_state()))
    for service in ("projects",) + TOOLS:
        print(service, "running" if env.running(service) else "STOPPED")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    run = sub.add_parser("run")
    run.add_argument("--phase", required=True)
    run.add_argument("--scenario", default="all")
    run.add_argument("--reps", type=int, default=10)
    run.add_argument("--t-obs", type=float, default=None)
    run.add_argument("--pilot", action="store_true")
    run.add_argument("--only-reps", default=None,
                     help="comma-separated rep numbers to re-run; only records with harness_error")
    summ = sub.add_parser("summarize")
    summ.add_argument("--phase", required=True)
    summ.add_argument("--pilot", action="store_true")
    args = parser.parse_args()
    {"check": cmd_check, "run": cmd_run, "summarize": cmd_summarize}[args.cmd](args)


if __name__ == "__main__":
    main()
