"""Unit tests of the RNF-FIAB-01 harness itself (no Docker needed).

    python -m pytest -q benchmarks/fault-tolerance/test_fiab.py   # needs pika and pillow
"""

import importlib.util
import io
import json
import os
import sys
from pathlib import Path

import pytest
from pika.adapters.blocking_connection import BlockingChannel
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fiab  # noqa: E402


class Crashed(Exception):
    pass


class Method:
    routing_key = "rotate_queue"
    delivery_tag = 1
    redelivered = False


@pytest.fixture
def shim(tmp_path, monkeypatch):
    """Load sitecustomize over fake pika methods; os._exit raises Crashed."""
    published = []
    monkeypatch.setattr(BlockingChannel, "basic_consume", lambda self, queue, cb, *a, **k: cb)
    monkeypatch.setattr(BlockingChannel, "basic_publish",
                        lambda self, exchange, routing_key, body, *a, **k: published.append((routing_key, body)))
    monkeypatch.setattr(Image.Image, "save", Image.Image.save)
    monkeypatch.setenv("FAULT_DIR", str(tmp_path))
    monkeypatch.setenv("FAULT_SERVICE", "rotate")
    spec = importlib.util.spec_from_file_location("fiab_sitecustomize", HERE / "faultshim" / "sitecustomize.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def crash(code):
        raise Crashed(code)
    monkeypatch.setattr(module.os, "_exit", crash)

    channel = object.__new__(BlockingChannel)
    module.callback_for = lambda cb: BlockingChannel.basic_consume(channel, "rotate_queue", cb)
    module.channel = channel
    module.published = published
    module.dir = tmp_path
    return module


def events(directory):
    path = directory / "events-rotate.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def arm(directory, **config):
    (directory / "arm-rotate.json").write_text(json.dumps({"trial": "t", **config}))


def body(msg_id):
    return json.dumps({"messageId": msg_id}).encode()


def test_png_encoder_round_trip(tmp_path):
    data = fiab.png_bytes(5, 3, lambda x, y: (x * 10, y * 20, 7))
    image = Image.open(io.BytesIO(data))
    assert image.size == (5, 3) and image.getpixel((4, 2)) == (40, 40, 7)
    assert fiab.png_size(data) == (5, 3)
    assert fiab.png_size(b"not a png") is None


def test_receives_are_traced_and_unarmed_worker_runs_normally(shim):
    seen = []
    callback = shim.callback_for(lambda ch, m, p, b: seen.append(b))
    callback(None, Method(), None, body("a"))
    assert seen == [body("a")]
    assert [e["event"] for e in events(shim.dir)] == ["start", "consume", "receive"]


def test_crash_after_receive_fires_on_nth_message_only_once(shim):
    arm(shim.dir, point="after_receive", action="crash", nth=2)
    seen = []
    callback = shim.callback_for(lambda ch, m, p, b: seen.append(b))
    callback(None, Method(), None, body("m1"))
    with pytest.raises(Crashed):
        callback(None, Method(), None, body("m2"))
    assert seen == [body("m1")]
    assert not (shim.dir / "arm-rotate.json").exists() and (shim.dir / "arm-rotate.fired.json").exists()
    fault = [e for e in events(shim.dir) if e["event"] == "fault"]
    assert fault and fault[0]["msg_id"] == "m2" and fault[0]["point"] == "after_receive"
    callback(None, Method(), None, body("m3"))  # a restarted worker is not re-armed
    assert seen[-1] == body("m3")


def test_crash_during_write_leaves_a_truncated_file(shim, tmp_path):
    arm(shim.dir, point="during_write", action="crash", nth=1)
    target = tmp_path / "out.png"
    image = Image.new("RGB", (64, 48), (10, 200, 30))
    callback = shim.callback_for(lambda ch, m, p, b: image.save(str(target)))
    with pytest.raises(Crashed):
        callback(None, Method(), None, body("w"))
    complete = io.BytesIO()
    image.save(complete, "PNG")
    assert 0 < target.stat().st_size < len(complete.getvalue())


def test_crash_after_write_keeps_complete_output_and_no_reply(shim, tmp_path):
    arm(shim.dir, point="after_write", action="crash", nth=1)
    target = tmp_path / "out.png"

    def work(ch, m, p, b):
        Image.new("RGB", (8, 8)).save(str(target))
        BlockingChannel.basic_publish(shim.channel, "picturas", "project_queue", b"{}")
    with pytest.raises(Crashed):
        shim.callback_for(work)(None, Method(), None, body("x"))
    assert Image.open(target).size == (8, 8)
    assert shim.published == []


def test_crash_after_publish_sends_the_reply_first(shim, monkeypatch):
    monkeypatch.setattr(shim.time, "sleep", lambda s: None)
    arm(shim.dir, point="after_publish", action="crash", nth=1)
    reply = json.dumps({"correlationId": "c1"}).encode()
    with pytest.raises(Crashed):
        shim.callback_for(lambda ch, m, p, b: BlockingChannel.basic_publish(shim.channel, "picturas", "project_queue", reply))(
            None, Method(), None, body("c1"))
    assert shim.published == [("project_queue", reply)]


def test_duplicate_publishes_reply_copies(shim, monkeypatch):
    monkeypatch.setattr(shim.time, "sleep", lambda s: None)
    arm(shim.dir, point="after_publish", action="duplicate", nth=1, copies=2, gap_s=2)
    shim.callback_for(lambda ch, m, p, b: BlockingChannel.basic_publish(shim.channel, "picturas", "project_queue", b"{}"))(
        None, Method(), None, body("d"))
    assert len(shim.published) == 2
    # Messages to other queues (e.g. ws progress) are never duplicated.
    BlockingChannel.basic_publish(shim.channel, "picturas", "ws_queue", b"{}")
    assert len(shim.published) == 3


def test_hold_blocks_until_release(shim):
    arm(shim.dir, point="before_publish", action="hold", nth=1, hold_timeout_s=5)
    (shim.dir / "release-rotate").write_text("go")
    shim.callback_for(lambda ch, m, p, b: BlockingChannel.basic_publish(shim.channel, "picturas", "project_queue", b"{}"))(
        None, Method(), None, body("h"))
    kinds = [e["event"] for e in events(shim.dir)]
    assert "hold" in kinds and "release" in kinds and len(shim.published) == 1
    assert not (shim.dir / "release-rotate").exists()


def test_timeline_measures_ready_and_resume():
    events_ = [
        {"ts": 10.0, "service": "rotate", "pid": 1, "boot": "a", "event": "receive", "msg_id": "m"},
        {"ts": 10.1, "service": "rotate", "pid": 1, "boot": "a", "event": "fault", "msg_id": "m"},
        {"ts": 12.0, "service": "rotate", "pid": 1, "boot": "b", "event": "start"},
        {"ts": 12.5, "service": "rotate", "pid": 1, "boot": "b", "event": "consume"},
        {"ts": 13.0, "service": "rotate", "pid": 1, "boot": "b", "event": "receive", "msg_id": "m", "redelivered": True},
    ]
    tl = fiab.timeline(events_, 9.0)
    assert tl["ready_after_fault"]["ts"] == 12.0 and tl["resume"]["ts"] == 13.0
    assert tl["deliveries"] == {"m": 2} and tl["max_deliveries"] == 2


def test_classify_flags_loss_and_duplicates():
    record = {"trial": "R1-01", "scenario": "R1", "completed_in_window": False, "duration_s": None,
              "operations_before": 5, "operations_after": 5,
              "timeline": {"fault": {"ts": 1}, "ready_after_fault": {"ts": 3}, "resume": None, "max_deliveries": 1},
              "evaluation": {"committed": False, "lost_files": ["fiab-04.png"], "duplicated_files": [],
                             "output_mismatch": [], "originals_altered": [], "pending_processes": 1}}
    row = fiab.classify(record)
    assert row["recovered_correctly"] is False and row["lost_files"] == 1
    assert row["fault_to_ready_s"] == 2 and row["ready_to_resume_s"] is None and row["operations_delta"] == 0
