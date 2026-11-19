"""RNF-FIAB-01, Phase 4: regression checks of behaviour the requirement must preserve.

    .venv/bin/python regression.py            # all checks
    .venv/bin/python regression.py mixed undo # some checks

Runs against the isolated stack (picturas-fiab) with, in addition to the pipeline
workers, video_tool, contrast_tool, saturation_tool, resize_tool, binarization_tool
and cut_tool running. Each check writes docs/rnf-fiab-01/evidencias/final-regression/
<check>.json; summary.json lists pass/fail. Checks never touch the "picturas" stack.
"""
import datetime as dt
import io
import json
import os
import sys
import time

from bson import ObjectId
from PIL import Image

import corpus
import harness
from harness import Env, now, iso, write_json

OUT = os.path.join(harness.EVIDENCE, "final-regression")
SAMPLE_VIDEO = os.path.join(harness.REPO, "samples", "video", "sample_6s.mov")


def processed(env, user):
    return sum(o.get("processed") or 0 for o in env.operations(user)["operations"])


def upload_video(env, user, project, path):
    with open(path, "rb") as handle:
        r = env.call("POST", f"/{user}/{project}/video", user, project,
                     files={"video": (os.path.basename(path), handle.read(), "video/quicktime")})
    if r.status_code >= 300:
        raise RuntimeError(f"video upload: {r.status_code} {r.text}")


def add_tool(env, user, project, procedure, params):
    r = env.call("POST", f"/{user}/{project}/tool", user, project, json={"procedure": procedure, "params": params})
    if r.status_code >= 300:
        raise RuntimeError(f"tool {procedure}: {r.status_code} {r.text}")


def results(env, project, token):
    return list(env.db.results.find({"project_id": ObjectId(project), "token": token}))


def wait_commit(env, project, token, seconds=180):
    return env.wait_commit(project, token, now() + dt.timedelta(seconds=seconds))


def images(n):
    _, files = harness.corpus_files()
    return files[:n]


def reference(name, pipeline_fn):
    with open(os.path.join(corpus.DATA, name), "rb") as handle:
        return corpus.pixel_sha256(pipeline_fn(Image.open(io.BytesIO(handle.read())).convert("RGB")))


def border_brightness(img):
    from PIL import ImageEnhance, ImageOps
    return ImageEnhance.Brightness(ImageOps.expand(img, border=12, fill=(200, 30, 30))).enhance(1.4)


def check_mixed(env):
    """Images + video in one run: images use the new jobs, the video the legacy path;
    the run commits once after both, video effects are charged once, images are correct."""
    user = env.create_user()
    pipeline = [p for p in corpus.PIPELINE[:2]]  # border, brightness (also video effects)
    project = env.new_project(user, "rnf-fiab-01-mixed", images(2), [])
    upload_video(env, user, project, SAMPLE_VIDEO)
    for tool in pipeline:
        add_tool(env, user, project, tool["procedure"], tool["params"])
    before = processed(env, user)
    run = env.start_run(user, project)
    committed = wait_commit(env, project, run["token"])
    res = results(env, project, run["token"])
    inspected = {o["key"]: o for o in env.inspect(user, project, [{"stage": "out", "key": r["img_key"]} for r in res])}
    imgs = [r for r in res if r["type"] == "image"]
    ok_pixels = sum(1 for r in imgs if inspected[r["img_key"]].get("pixel_sha256") == reference(r["file_name"], border_brightness))
    videos = [r for r in res if r["type"] == "video"]
    after = processed(env, user)
    record = {"status": run["status"], "committed": bool(committed), "results": len(res),
              "image_results_correct": ok_pixels, "video_results": len(videos),
              "quota_delta": after - before, "expected_quota_delta": 2}
    record["pass"] = (run["status"] == 201 and record["committed"] and len(imgs) == 2 and ok_pixels == 2
                      and len(videos) == 1 and record["quota_delta"] == 2)
    return record


def check_cancel_and_rerun(env):
    """Cancel a run in progress, then run again: the cancelled token leaves no results,
    the committed run is restored, quota is coherent (one charge per POST /process)."""
    user = env.create_user()
    project = env.new_project(user, "rnf-fiab-01-cancel", images(3), [])
    upload_video(env, user, project, SAMPLE_VIDEO)
    add_tool(env, user, project, "brightness", {"brightness": 1.4})
    q0 = processed(env, user)
    first = env.start_run(user, project)
    cancel_status = env.cancel_run(user, project)
    time.sleep(8)  # let late replies of the cancelled run arrive (observation, not a fault proof)
    doc = env.db.projects.find_one({"_id": ObjectId(project)})
    cancelled_results = len(results(env, project, first["token"]))
    q1 = processed(env, user)
    second = env.start_run(user, project)
    committed = wait_commit(env, project, second["token"])
    q2 = processed(env, user)
    record = {"cancel_status": cancel_status, "committed_after_cancel": doc.get("committedToken"),
              "cancelled_token": first["token"], "cancelled_results": cancelled_results,
              "rerun_committed": bool(committed), "rerun_results": len(results(env, project, second["token"])),
              "quota_first_run": q1 - q0, "quota_second_run": q2 - q1}
    record["pass"] = (cancel_status == 204 and doc.get("committedToken") != first["token"]
                      and cancelled_results == 0 and record["rerun_committed"] and record["rerun_results"] == 4
                      and record["quota_first_run"] == 1 and record["quota_second_run"] == 1)
    return record


def check_other_workers(env):
    """Five other image workers sharing Tools/utils run a chain to completion."""
    user = env.create_user()
    pipeline = [("contrast", {"contrastFactor": 1.3}), ("saturation", {"saturationFactor": 0.7}),
                ("resize", {"width": 320, "height": 240}),
                ("cut", {"left": 10, "top": 10, "right": 250, "bottom": 200}),
                ("binarization", {"threshold": 128})]
    project = env.new_project(user, "rnf-fiab-01-workers", images(3), [])
    for procedure, params in pipeline:
        add_tool(env, user, project, procedure, params)
    run = env.start_run(user, project)
    committed = wait_commit(env, project, run["token"])
    res = results(env, project, run["token"])
    inspected = env.inspect(user, project, [{"stage": "out", "key": r["img_key"]} for r in res])
    dims = sorted({(o.get("width"), o.get("height")) for o in inspected})
    record = {"committed": bool(committed), "results": len(res), "dims": dims,
              "per_media": sorted(str(r["img_id"]) for r in res)}
    record["pass"] = record["committed"] and len(res) == 3 and len(set(record["per_media"])) == 3 and dims == [(240, 190)]
    return record


def check_undo_in_flight(env):
    """Undo while a run is in progress (K4): the run cannot commit nor leave results."""
    user = env.create_user()
    project = env.new_project(user, "rnf-fiab-01-undo", images(10), corpus.PIPELINE)
    t0 = now()
    fault = {"id": f"undo-{int(time.time())}", "target": "brightness_tool", "point": "before_write",
             "match": "img03.png", "action": "block"}
    env.clear_hooks()
    env.arm(fault)
    run = env.start_run(user, project)
    reached = env.wait_event("brightness_tool", t0, "FAULT-POINT", lambda e: e.get("id") == fault["id"])
    tool_id = str(env.db.projects.find_one({"_id": ObjectId(project)})["tools"][-1]["_id"])
    undo = env.call("DELETE", f"/{user}/{project}/tool/{tool_id}", user, project).status_code
    env.release(fault["id"])
    time.sleep(8)  # observation window for late replies
    doc = env.db.projects.find_one({"_id": ObjectId(project)})
    env.clear_hooks()
    record = {"fault_reached": bool(reached), "undo_status": undo, "run_token": run["token"],
              "active_token": doc.get("activeToken"), "committed_token": doc.get("committedToken"),
              "results_of_run": len(results(env, project, run["token"]))}
    record["pass"] = (bool(reached) and undo == 204 and doc.get("committedToken") != run["token"]
                      and record["results_of_run"] == 0)
    return record


def check_video_only(env):
    """Video-only project (legacy path): commits once with one video result."""
    user = env.create_user()
    project = env.new_project(user, "rnf-fiab-01-video", [], [])
    upload_video(env, user, project, SAMPLE_VIDEO)
    add_tool(env, user, project, "brightness", {"brightness": 1.2})
    run = env.start_run(user, project)
    committed = wait_commit(env, project, run["token"])
    res = results(env, project, run["token"])
    record = {"committed": bool(committed), "results": [(r["type"], r["file_name"]) for r in res]}
    record["pass"] = record["committed"] and len(res) == 1 and res[0]["type"] == "video"
    return record


def check_extract_frames(env):
    """Frame extraction on a mixed project (legacy barriers): 3 frames + the images."""
    user = env.create_user()
    project = env.new_project(user, "rnf-fiab-01-frames", images(1), [])
    upload_video(env, user, project, SAMPLE_VIDEO)
    add_tool(env, user, project, "border", {"borderWidth": 4, "r": 0, "g": 0, "b": 0})
    add_tool(env, user, project, "extract_frames", {"mode": "count", "count": 3, "format": "png"})
    run = env.start_run(user, project)
    committed = wait_commit(env, project, run["token"])
    res = results(env, project, run["token"])
    record = {"status": run["status"], "committed": bool(committed), "results": len(res),
              "types": sorted({r["type"] for r in res})}
    record["pass"] = record["committed"] and len(res) == 4
    return record


def check_preview(env):
    """Image preview (legacy path, ack after handling) still reaches its final step."""
    user = env.create_user()
    project = env.new_project(user, "rnf-fiab-01-preview", images(1), corpus.PIPELINE)
    img = str(env.db.projects.find_one({"_id": ObjectId(project)})["imgs"][0]["_id"])
    status = env.call("POST", f"/{user}/{project}/preview/{img}", user, project).status_code
    deadline = time.time() + 30
    count = 0
    while time.time() < deadline:
        count = env.db.previews.count_documents({"project_id": ObjectId(project)})
        if count:
            break
        time.sleep(0.2)
    record = {"status": status, "preview_documents": count}
    record["pass"] = status == 201 and count >= 1
    return record


CHECKS = {
    "mixed": check_mixed,
    "cancel": check_cancel_and_rerun,
    "workers": check_other_workers,
    "undo": check_undo_in_flight,
    "video": check_video_only,
    "frames": check_extract_frames,
    "preview": check_preview,
}


def main():
    env = Env()
    names = sys.argv[1:] or list(CHECKS)
    summary_path = os.path.join(OUT, "summary.json")
    summary = {}
    if os.path.exists(summary_path):
        with open(summary_path, encoding="utf-8") as handle:
            summary = json.load(handle).get("checks", {})
    meta = harness.campaign_metadata("final-regression")
    for name in names:
        started = now()
        try:
            env.clear_hooks()
            env.ensure_up()
            record = CHECKS[name](env)
        except Exception as error:  # noqa: BLE001 - a failed check is reported, not hidden
            record = {"pass": False, "error": repr(error)}
        record.update({"requirement": "RNF-FIAB-01", "check": name, "doc": CHECKS[name].__doc__.strip(),
                       "started": iso(started), "finished": iso(now())})
        write_json(os.path.join(OUT, f"{name}.json"), record)
        summary[name] = record["pass"]
        print(f"{name}: {'PASS' if record['pass'] else 'FAIL'} {json.dumps({k: v for k, v in record.items() if k not in ('doc',)})[:400]}", flush=True)
    write_json(summary_path, {"requirement": "RNF-FIAB-01", "metadata": meta, "checks": summary})


if __name__ == "__main__":
    main()
