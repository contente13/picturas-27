"""Fault-injection shim for the Python image workers (RNF-FIAB-01 test harness only).

Loaded automatically by Python when this directory is on PYTHONPATH, so the
application code is not modified. It is inert unless FAULT_DIR is set.

Control: the harness writes <FAULT_DIR>/arm-<FAULT_SERVICE>.json, e.g.
    {"trial": "R1-03", "point": "after_receive", "action": "crash", "nth": 5}
The fault fires on the nth message received after the arm file appears and
is consumed (renamed to *.fired.json) before acting, so a restarted worker
does not fire again.

Points:  after_receive | before_write | during_write | after_write |
         before_publish | after_publish
Actions: crash (exit without cleanup), hold (block until
         <FAULT_DIR>/release-<service> exists), duplicate (publish the
         reply `copies` times, `gap_s` seconds apart; publish points only).

Every receive and reply publish is traced to <FAULT_DIR>/events-<service>.jsonl.
"""

import io
import json
import os
import threading
import time
import uuid

FAULT_DIR = os.environ.get("FAULT_DIR")
SERVICE = os.environ.get("FAULT_SERVICE", "unknown")
REPLY_QUEUE = os.environ.get("FAULT_REPLY_QUEUE", "project_queue")
BOOT = uuid.uuid4().hex[:12]  # PIDs repeat across container restarts (PID 1)

# The message being handled. Process-wide, not thread-local: a worker may run the effect
# and the reply publish on threads other than the consumer callback (e.g. a handler thread
# plus add_callback_threadsafe). Workers handle one message at a time (synchronous callback,
# or prefetch_count=1), so the state is replaced on the next receive instead of being
# cleared when the consumer callback returns.
class _Current:
    msg_id = None
    target = None


_state = _Current()
_arm_lock = threading.Lock()
_arm = {"key": None, "config": None, "count": 0}


def _path(name):
    return os.path.join(FAULT_DIR, name)


def trace(event, **fields):
    record = {"ts": time.time(), "service": SERVICE, "pid": os.getpid(), "boot": BOOT, "event": event}
    record.update(fields)
    line = json.dumps(record) + "\n"
    try:
        fd = os.open(_path(f"events-{SERVICE}.jsonl"), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o666)
        try:
            os.write(fd, line.encode())
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        pass


def _load_arm():
    """Return the active arm config, resetting the counter when it changes."""
    try:
        with open(_path(f"arm-{SERVICE}.json")) as stream:
            config = json.load(stream)
    except (OSError, ValueError):
        _arm.update(key=None, config=None, count=0)
        return None
    key = (config.get("trial"), config.get("point"), config.get("action"), config.get("nth"))
    if key != _arm["key"]:
        _arm.update(key=key, config=config, count=0)
    return _arm["config"]


def _consume_arm():
    try:
        os.replace(_path(f"arm-{SERVICE}.json"), _path(f"arm-{SERVICE}.fired.json"))
    except OSError:
        pass
    _arm.update(key=None, config=None, count=0)


def _target(point):
    """Config if the current message is the armed one and `point` matches."""
    config = getattr(_state, "target", None)
    if config and config.get("point") == point:
        return config
    return None


def crash(point, config):
    trace("fault", point=point, action="crash", trial=config.get("trial"), msg_id=getattr(_state, "msg_id", None))
    os._exit(int(config.get("exit_code", 137)))


def hold(point, config):
    release = _path(f"release-{SERVICE}")
    trace("hold", point=point, trial=config.get("trial"), msg_id=getattr(_state, "msg_id", None))
    deadline = time.time() + float(config.get("hold_timeout_s", 300))
    while not os.path.exists(release) and time.time() < deadline:
        time.sleep(0.05)
    released = os.path.exists(release)
    try:
        os.remove(release)
    except OSError:
        pass
    trace("release", point=point, trial=config.get("trial"), released=released, msg_id=getattr(_state, "msg_id", None))


def _act(point):
    config = _target(point)
    if not config:
        return
    if config.get("action") == "crash":
        crash(point, config)
    elif config.get("action") == "hold":
        hold(point, config)


def _wrap_callback(callback):
    def wrapped(ch, method, properties, body):
        msg_id = None
        try:
            msg_id = json.loads(body).get("messageId")
        except (ValueError, AttributeError):
            pass
        _state.msg_id = msg_id
        _state.target = None
        trace("receive", msg_id=msg_id, routing_key=getattr(method, "routing_key", None),
              delivery_tag=getattr(method, "delivery_tag", None),
              redelivered=bool(getattr(method, "redelivered", False)))
        with _arm_lock:
            config = _load_arm()
            if config:
                _arm["count"] += 1
                if _arm["count"] == int(config.get("nth", 1)):
                    _consume_arm()
                    _state.target = config
                    trace("armed-target", point=config.get("point"), action=config.get("action"),
                          trial=config.get("trial"), msg_id=msg_id)
        _act("after_receive")
        return callback(ch, method, properties, body)
    return wrapped


def _install():
    from pika.adapters.blocking_connection import BlockingChannel
    from PIL import Image

    original_consume = BlockingChannel.basic_consume
    original_publish = BlockingChannel.basic_publish
    original_save = Image.Image.save

    def basic_consume(self, queue, on_message_callback, *args, **kwargs):
        result = original_consume(self, queue, _wrap_callback(on_message_callback), *args, **kwargs)
        trace("consume", queue=queue)  # the worker is ready to receive again
        return result

    def basic_publish(self, exchange, routing_key, body, *args, **kwargs):
        if routing_key != REPLY_QUEUE:
            return original_publish(self, exchange, routing_key, body, *args, **kwargs)
        correlation = None
        try:
            correlation = json.loads(body).get("correlationId")
        except (ValueError, AttributeError):
            pass
        _act("before_publish")
        config = _target("after_publish") or _target("before_publish")
        copies = int(config.get("copies", 2)) if config and config.get("action") == "duplicate" else 1
        result = None
        for index in range(copies):
            if index:
                time.sleep(float(config.get("gap_s", 0)))
            result = original_publish(self, exchange, routing_key, body, *args, **kwargs)
            trace("publish", msg_id=getattr(_state, "msg_id", None), correlation_id=correlation, copy=index + 1)
        config = _target("after_publish")
        if config and config.get("action") == "crash":
            # Give the broker time to route the reply before the process dies.
            time.sleep(float(config.get("post_publish_wait_s", 1.0)))
        _act("after_publish")
        return result

    def save(self, fp, *args, **kwargs):
        _act("before_write")
        config = _target("during_write")
        if config and config.get("action") == "crash" and isinstance(fp, (str, os.PathLike)):
            buffer = io.BytesIO()
            image_format = kwargs.get("format") or (args[0] if args else None)
            if not image_format:
                from PIL import Image as _Image
                _Image.init()
                image_format = _Image.EXTENSION.get(os.path.splitext(str(fp))[1].lower(), "PNG")
            original_save(self, buffer, image_format)
            data = buffer.getvalue()
            with open(fp, "wb") as stream:
                stream.write(data[: max(1, len(data) // 2)])
                stream.flush()
                os.fsync(stream.fileno())
            crash("during_write", config)
        result = original_save(self, fp, *args, **kwargs)
        _act("after_write")
        return result

    BlockingChannel.basic_consume = basic_consume
    BlockingChannel.basic_publish = basic_publish
    Image.Image.save = save
    trace("start")


if FAULT_DIR:
    try:
        _install()
    except Exception as error:  # never break the worker because of the harness
        trace("shim-error", error=repr(error))
