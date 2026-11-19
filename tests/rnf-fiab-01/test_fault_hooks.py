"""RNF-FIAB-01: worker fault hooks are inert by default and precise when armed."""
import importlib
import json
import os
import threading
import time
from types import SimpleNamespace

import pytest
from PIL import Image


def load_hooks(monkeypatch, tmp_path, enabled):
    if enabled:
        monkeypatch.setenv("RNF_FIAB_01_HOOKS", "1")
    else:
        monkeypatch.delenv("RNF_FIAB_01_HOOKS", raising=False)
    monkeypatch.setenv("RNF_FIAB_01_DIR", str(tmp_path))
    monkeypatch.setenv("RNF_FIAB_01_SERVICE", "brightness_tool")
    import utils.fault_hooks as hooks
    return importlib.reload(hooks)


def arm(tmp_path, **cfg):
    (tmp_path / "fault.json").write_text(json.dumps({"id": "t1", "target": "brightness_tool", **cfg}))


def deliver(hooks, body, redelivered=False):
    seen = []
    wrapped = hooks.wrap_callback(lambda ch, method, props, b: seen.append(b))
    wrapped(None, SimpleNamespace(redelivered=redelivered), None, body)
    return seen


def test_rnf_fiab_01_disabled_hooks_are_identity(monkeypatch, tmp_path, capsys):
    hooks = load_hooks(monkeypatch, tmp_path, enabled=False)
    arm(tmp_path, point="after_receive")
    callback = lambda *a: None  # noqa: E731
    assert hooks.wrap_callback(callback) is callback
    assert hooks.point("after_receive") is None
    hooks.ready()
    hooks.after_reply("{}", lambda: pytest.fail("must not republish"))
    out = tmp_path / "out.png"
    hooks.store_img(Image.new("RGB", (8, 6), "red"), str(out))
    assert Image.open(out).size == (8, 6)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["fault.json", "out.png"]
    assert capsys.readouterr().out == ""


def test_rnf_fiab_01_after_receive_fires_once_and_blocks(monkeypatch, tmp_path, capsys):
    hooks = load_hooks(monkeypatch, tmp_path, enabled=True)
    arm(tmp_path, point="after_receive", match="img03")
    body = json.dumps({"messageId": "request-1", "parameters": {"inputImageURI": "src/img03.png"}}).encode()

    assert deliver(hooks, json.dumps({"messageId": "request-0", "x": "img07"}).encode()) != []

    done = []
    worker = threading.Thread(target=lambda: done.append(deliver(hooks, body, redelivered=False)))
    worker.start()
    time.sleep(0.2)
    assert done == [], "must block at the fault point"
    out = capsys.readouterr().out
    assert "RNF-FIAB-01 RECEIVED service=brightness_tool msg=request-1 redelivered=false" in out
    assert "RNF-FIAB-01 FAULT-POINT service=brightness_tool id=t1 point=after_receive msg=request-1" in out

    (tmp_path / "release-t1").write_text("")
    worker.join(2)
    assert done and done[0] == [body]
    # One-shot: the same message after a restart passes through.
    assert deliver(hooks, body, redelivered=True) == [body]


def test_rnf_fiab_01_during_write_leaves_a_partial_file(monkeypatch, tmp_path, capsys):
    hooks = load_hooks(monkeypatch, tmp_path, enabled=True)
    arm(tmp_path, point="during_write")
    deliver(hooks, json.dumps({"messageId": "request-2"}).encode())
    target = tmp_path / "img.png"
    img = Image.effect_noise((64, 48), 40).convert("RGB")

    worker = threading.Thread(target=hooks.store_img, args=(img, str(target)))
    worker.start()
    deadline = time.time() + 2
    while "point=during_write" not in capsys.readouterr().out and time.time() < deadline:
        time.sleep(0.01)
    partial = target.read_bytes()
    with pytest.raises(Exception):
        Image.open(target).load()
    (tmp_path / "release-t1").write_text("")
    worker.join(2)
    assert len(target.read_bytes()) > len(partial)
    Image.open(target).load()


def test_rnf_fiab_01_duplicate_and_capture_actions(monkeypatch, tmp_path):
    hooks = load_hooks(monkeypatch, tmp_path, enabled=True)
    arm(tmp_path, point="after_reply_before_ack", action="duplicate", count=3)
    deliver(hooks, json.dumps({"messageId": "request-3"}).encode())
    sent = []
    hooks.after_reply('{"r":1}', lambda: sent.append(1))
    assert sent == [1, 1]

    (tmp_path / "fault.json").write_text(json.dumps(
        {"id": "t2", "target": "brightness_tool", "point": "after_reply_before_ack", "action": "capture"}))
    hooks.after_reply('{"r":2}', lambda: pytest.fail("capture must not republish"))
    assert (tmp_path / "captured-t2.json").read_text() == '{"r":2}'


def test_rnf_fiab_01_other_service_is_not_affected(monkeypatch, tmp_path):
    hooks = load_hooks(monkeypatch, tmp_path, enabled=True)
    (tmp_path / "fault.json").write_text(json.dumps(
        {"id": "t3", "target": "rotate_tool", "point": "after_receive"}))
    assert deliver(hooks, b'{"messageId": "m"}') == [b'{"messageId": "m"}']
    assert not os.path.exists(tmp_path / "fired-t3")
