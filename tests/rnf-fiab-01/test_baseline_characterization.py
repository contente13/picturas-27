"""RNF-FIAB-01 characterization of the ORIGINAL worker messaging (baseline).

These tests pin down the behaviour diagnosed in docs/rnf-fiab-01/diagnostico.md
(W1, W4, W5). They are expected to be inverted in Phase 3, when the decision D1
is implemented; until then they document why recovery is impossible today.
"""
import importlib
import json
from types import SimpleNamespace

import pytest


class FakeChannel:
    def __init__(self):
        self.calls = []

    def exchange_declare(self, **kw):
        self.calls.append(("exchange_declare", kw))

    def queue_declare(self, **kw):
        self.calls.append(("queue_declare", kw))

    def basic_consume(self, **kw):
        self.calls.append(("basic_consume", kw))

    def basic_publish(self, **kw):
        self.calls.append(("basic_publish", kw))

    def start_consuming(self):
        self.calls.append(("start_consuming", {}))


@pytest.fixture
def channel(monkeypatch):
    monkeypatch.delenv("RNF_FIAB_01_HOOKS", raising=False)
    fake = FakeChannel()
    import pika
    monkeypatch.setattr(pika, "BlockingConnection",
                        lambda params: SimpleNamespace(channel=lambda: fake))
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


def test_rnf_fiab_01_baseline_requests_are_acked_on_delivery(channel):
    """W1: auto_ack=True removes the request before any work is done."""
    tool_msg().read_msg(lambda *a: None)
    consume = [kw for name, kw in channel.calls if name == "basic_consume"]
    assert consume and consume[0]["auto_ack"] is True


def test_rnf_fiab_01_baseline_replies_are_not_persistent(channel):
    """W4/W6: no delivery_mode=2 and no publisher confirms on the reply."""
    tool_msg().send_msg("req", "resp", "ts", "success", 1.0, "out.png")
    publish = [kw for name, kw in channel.calls if name == "basic_publish"]
    assert len(publish) == 1 and "properties" not in publish[0]
    assert json.loads(publish[0]["body"])["correlationId"] == "req"


def test_rnf_fiab_01_baseline_simple_tool_error_reply_raises(channel):
    """W5: the positional call used by brightness/resize/border/rotate/... raises."""
    with pytest.raises(Exception, match="err_code, err_msg and og_img_uri"):
        tool_msg().send_msg("req", "resp", "ts", "error", 1.0, None,
                            1901, "boom", "./images/in.png")
    assert not [c for c in channel.calls if c[0] == "basic_publish"]


def test_rnf_fiab_01_baseline_error_reply_swaps_correlation(channel):
    """W5: even a well-formed error reply carries the wrong correlationId."""
    tool_msg().send_msg("req", "resp", "ts", "error", 1.0, None, "image",
                        1901, "boom", "./images/in.png")
    body = json.loads([kw for n, kw in channel.calls if n == "basic_publish"][0]["body"])
    assert body["correlationId"] == "resp" and body["messageId"] == "req"
