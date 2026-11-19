"""RNF-FIAB-01: worker messaging after decision D1 (docs/rnf-fiab-01/especificacao-e-decisao.md).

The baseline version of this file pinned the original defects (W1, W4, W5): requests
acked on delivery, non-persistent replies without confirms, error replies that raised
or carried the wrong correlationId. Each test below is the inverted assertion, plus
the new delivery limit, the request-level error guarantee and the atomic write.
"""
import importlib
import json
import threading
import time
from types import SimpleNamespace

import pytest
from PIL import Image


class FakeChannel:
    def __init__(self):
        self.calls = []
        self.is_open = True
        self.fail_publish = False

    def __getattr__(self, name):
        if name in ("exchange_declare", "queue_declare", "basic_consume", "basic_qos",
                    "confirm_delivery", "basic_ack", "basic_nack", "start_consuming"):
            return lambda *a, **kw: self.calls.append((name, kw))
        raise AttributeError(name)

    def basic_publish(self, **kw):
        import pika
        if self.fail_publish:
            raise pika.exceptions.NackError([])
        self.calls.append(("basic_publish", kw))

    def names(self):
        return [name for name, _ in self.calls]

    def published(self):
        return [json.loads(kw["body"]) for name, kw in self.calls if name == "basic_publish"]


class FakeConnection:
    def __init__(self, channel):
        self._channel = channel
        self.is_closed = False

    def channel(self):
        return self._channel

    def add_callback_threadsafe(self, callback):
        callback()  # the tests have no I/O loop: run on the calling thread


@pytest.fixture
def channel(monkeypatch, tmp_path):
    monkeypatch.delenv("RNF_FIAB_01_HOOKS", raising=False)
    monkeypatch.setenv("RNF_FIAB_01_ATTEMPTS_DIR", str(tmp_path / "attempts"))
    fake = FakeChannel()
    import pika
    monkeypatch.setattr(pika, "BlockingConnection", lambda params: FakeConnection(fake))
    import utils.fault_hooks
    importlib.reload(utils.fault_hooks)
    import utils.rabbit_mq
    importlib.reload(utils.rabbit_mq)
    import utils.tool_msg
    importlib.reload(utils.tool_msg)
    return fake


def tool_msg():
    from utils.tool_msg import ToolMSG
    return ToolMSG("picturas-brightness-tool-ms", "brightness", "h", 1, "u", "p")


def request(msg_id="request-p-1-i-0"):
    return json.dumps({"messageId": msg_id, "timestamp": "2026-11-15T00:00:00+00:00",
                       "procedure": "brightness",
                       "parameters": {"inputImageURI": "./images/in.png",
                                      "outputImageURI": "./images/out.png"}}).encode()


def deliver(channel, tool, callback, body, tag=1):
    """Deliver one request through the real consumer and wait until it is settled."""
    tool.read_msg(callback)
    on_message = [kw for name, kw in channel.calls if name == "basic_consume"][-1]["on_message_callback"]
    on_message(channel, SimpleNamespace(delivery_tag=tag, redelivered=False), None, body)
    deadline = time.time() + 3
    while time.time() < deadline:
        settled = [(n, kw) for n, kw in channel.calls if n in ("basic_ack", "basic_nack")
                   and kw["delivery_tag"] == tag]
        if settled:
            return settled[0][0]
        time.sleep(0.01)
    pytest.fail("request was never acknowledged nor rejected")


def success_callback(tool):
    def callback(ch, method, props, body):
        info = json.loads(body)
        tool.send_msg(info["messageId"], "resp", "ts", "success", 1.0, info["parameters"]["outputImageURI"])
    return callback


def test_rnf_fiab_01_requests_use_manual_ack_and_prefetch_one(channel):
    """W1 inverted: no auto_ack, one request at a time, confirms on the channel."""
    tool_msg().read_msg(lambda *a: None)
    consume = [kw for name, kw in channel.calls if name == "basic_consume"]
    assert consume and consume[0]["auto_ack"] is False
    assert ("basic_qos", {"prefetch_count": 1}) in channel.calls
    assert "confirm_delivery" in channel.names()


def test_rnf_fiab_01_replies_are_persistent_and_confirmed(channel):
    """W4/W6 inverted: delivery_mode=2, mandatory publish on a confirm channel."""
    tool_msg().send_msg("req", "resp", "ts", "success", 1.0, "out.png")
    publish = [kw for name, kw in channel.calls if name == "basic_publish"]
    assert len(publish) == 1
    assert publish[0]["properties"].delivery_mode == 2 and publish[0]["mandatory"] is True
    assert json.loads(publish[0]["body"])["correlationId"] == "req"


def test_rnf_fiab_01_simple_tool_error_reply_is_published(channel):
    """W5 inverted: the positional call used by the simple tools now works."""
    tool_msg().send_msg("req", "resp", "ts", "error", 1.0, None, 1901, "boom", "./images/in.png")
    [body] = channel.published()
    assert body["status"] == "error" and body["error"] == {
        "code": 1901, "message": "boom", "details": {"inputFileURI": "./images/in.png"}}


def test_rnf_fiab_01_error_reply_correlates_with_the_request(channel):
    """W5 inverted: correlationId is the request, messageId is the reply."""
    tool_msg().send_msg("req", "resp", "ts", "error", 1.0, None, "image", 1901, "boom", "./images/in.png")
    [body] = channel.published()
    assert body["correlationId"] == "req" and body["messageId"] == "resp"


def test_rnf_fiab_01_ack_only_after_the_reply_is_confirmed(channel):
    tool = tool_msg()
    assert deliver(channel, tool, success_callback(tool), request()) == "basic_ack"
    names = channel.names()
    assert names.index("basic_publish") < names.index("basic_ack")


def test_rnf_fiab_01_unconfirmed_reply_leaves_the_request_for_redelivery(channel):
    tool = tool_msg()
    channel.fail_publish = True
    assert deliver(channel, tool, success_callback(tool), request()) == "basic_nack"
    nack = [kw for name, kw in channel.calls if name == "basic_nack"][0]
    assert nack["requeue"] is True


def test_rnf_fiab_01_unexpected_tool_exception_becomes_one_error_reply(channel):
    """R8b: an exception outside the tool's own try block must not kill the worker."""
    tool = tool_msg()

    def broken(ch, method, props, body):
        raise TypeError("brightness must be a number")

    assert deliver(channel, tool, broken, request("request-x")) == "basic_ack"
    [body] = channel.published()
    assert body["status"] == "error" and body["correlationId"] == "request-x"
    assert body["error"]["code"] == "unexpected_error"


def test_rnf_fiab_01_delivery_limit_answers_without_processing(channel):
    tool = tool_msg()
    calls = []

    def counting(ch, method, props, body):
        calls.append(1)
        raise SystemExit  # simulates a request that kills the worker every time

    body = request("request-poison")
    for tag in (1, 2, 3):
        # BaseException escapes the handler like a crash: the request is not acked.
        with pytest.raises(SystemExit):
            tool._handler(counting)(channel, SimpleNamespace(delivery_tag=tag), None, body)
    assert calls == [1, 1, 1]
    assert deliver(channel, tool, counting, body, tag=4) == "basic_ack"
    assert calls == [1, 1, 1], "the fourth delivery must not run the effect"
    [reply] = channel.published()
    assert reply["error"]["code"] == "attempts_exhausted" and reply["correlationId"] == "request-poison"


def test_rnf_fiab_01_handler_keeps_heartbeats_on_the_connection_thread(channel):
    """The effect runs outside the consumer callback (W7)."""
    tool = tool_msg()
    seen = []
    tool.read_msg(lambda *a: seen.append(threading.get_ident()))
    on_message = [kw for name, kw in channel.calls if name == "basic_consume"][-1]["on_message_callback"]
    on_message(channel, SimpleNamespace(delivery_tag=9, redelivered=False), None, request("request-t"))
    deadline = time.time() + 2
    while not seen and time.time() < deadline:
        time.sleep(0.01)
    assert seen and seen[0] != threading.get_ident()


def test_rnf_fiab_01_store_img_is_atomic(channel, tmp_path):
    from utils.img_handler import Img_Handler
    target = tmp_path / "runs" / "1" / "img" / "0" / "out.png"
    Img_Handler().store_img(Image.new("RGB", (8, 6), "red"), str(target))
    assert Image.open(target).size == (8, 6)
    assert [p.name for p in target.parent.iterdir()] == ["out.png"]

    class Broken:
        def save(self, path, format=None):
            open(path, "wb").write(b"partial")
            raise OSError("disk full")

    with pytest.raises(OSError):
        Img_Handler().store_img(Broken(), str(target))
    assert Image.open(target).size == (8, 6), "the previous complete file is kept"
    assert [p.name for p in target.parent.iterdir()] == ["out.png"], "no temporary file is left"


def test_rnf_fiab_01_during_write_never_exposes_the_final_name(monkeypatch, tmp_path, capsys):
    monkeypatch.setenv("RNF_FIAB_01_HOOKS", "1")
    monkeypatch.setenv("RNF_FIAB_01_DIR", str(tmp_path / "hooks"))
    monkeypatch.setenv("RNF_FIAB_01_SERVICE", "brightness_tool")
    (tmp_path / "hooks").mkdir()
    (tmp_path / "hooks" / "fault.json").write_text(json.dumps(
        {"id": "w1", "target": "brightness_tool", "point": "during_write"}))
    import utils.fault_hooks
    importlib.reload(utils.fault_hooks)
    import utils.img_handler
    importlib.reload(utils.img_handler)
    target = tmp_path / "out" / "img.png"
    worker = threading.Thread(target=utils.img_handler.Img_Handler().store_img,
                              args=(Image.effect_noise((64, 48), 40).convert("RGB"), str(target)))
    worker.start()
    deadline = time.time() + 2
    while "point=during_write" not in capsys.readouterr().out and time.time() < deadline:
        time.sleep(0.01)
    assert not target.exists(), "a partial write must only exist under a temporary name"
    assert len(list(target.parent.iterdir())) == 1
    (tmp_path / "hooks" / "release-w1").write_text("")
    worker.join(2)
    Image.open(target).load()
    assert [p.name for p in target.parent.iterdir()] == ["img.png"]


def test_rnf_fiab_01_worker_retries_while_the_broker_name_does_not_resolve(monkeypatch, tmp_path):
    """Broker container being recreated: DNS fails for a while, the worker keeps trying."""
    import socket
    import pika
    import utils.rabbit_mq
    fake = FakeChannel()
    attempts = []

    def connect(params):
        attempts.append(1)
        if len(attempts) < 3:
            raise socket.gaierror(-2, "Name or service not known")
        return FakeConnection(fake)

    monkeypatch.setattr(pika, "BlockingConnection", connect)
    monkeypatch.setattr(utils.rabbit_mq.time, "sleep", lambda s: None)
    importlib.reload(utils.rabbit_mq)
    monkeypatch.setattr(utils.rabbit_mq.time, "sleep", lambda s: None)
    utils.rabbit_mq.Rabbit_MQ("h", 1, "u", "p")
    assert len(attempts) == 3
