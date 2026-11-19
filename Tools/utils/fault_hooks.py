"""RNF-FIAB-01 fault-injection hooks for the image workers.

Inert unless the container sets RNF_FIAB_01_HOOKS=1, which only the isolated
test stack does (tests/rnf-fiab-01/compose.fiab.yaml). When disabled, every
public function returns immediately without touching the filesystem, and
store_img() is exactly Image.save(path, format=fmt).

When enabled, a fault is armed by writing <DIR>/fault.json:

    {"id": "...", "target": "<service>", "point": "<point>",
     "match": "<substring of the request body>", "action": "block|duplicate|capture",
     "count": 3}

Each fault fires at most once (marker <DIR>/fired-<id>, created with O_EXCL),
so a restarted worker does not trip it again. "block" logs a FAULT-POINT line
and then waits for <DIR>/release-<id>; the test harness kills the process after
reading that line, so the failure window is proven by the log, not by timing.
"""
import datetime
import io
import json
import os
import threading
import time

from PIL import Image

ENABLED = os.getenv("RNF_FIAB_01_HOOKS") == "1"
SERVICE = os.getenv("RNF_FIAB_01_SERVICE", "unknown")
DIR = os.getenv("RNF_FIAB_01_DIR", "/app/images/.rnf-fiab-01")

POINTS = (
    "after_receive",
    "before_write",
    "during_write",
    "after_output_before_reply",
    "after_reply_before_ack",
)

_current = threading.local()


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def log(event, **fields):
    parts = " ".join(f"{key}={value}" for key, value in fields.items())
    print(f"RNF-FIAB-01 {event} service={SERVICE} {parts} ts={_now()}".replace("  ", " "), flush=True)


def ready():
    if ENABLED:
        log("READY")


def _set_current(body, redelivered):
    _current.body = body
    try:
        _current.msg = json.loads(body).get("messageId", "?")
    except (ValueError, AttributeError):
        _current.msg = "?"
    _current.redelivered = redelivered


def current_msg():
    return getattr(_current, "msg", "?")


def wrap_callback(callback):
    """Log RECEIVED and run the after_receive point before the tool callback."""
    if not ENABLED:
        return callback

    def wrapped(ch, method, properties, body):
        text = body.decode(errors="replace") if isinstance(body, (bytes, bytearray)) else str(body)
        _set_current(text, bool(getattr(method, "redelivered", False)))
        log("RECEIVED", msg=current_msg(), redelivered=str(_current.redelivered).lower())
        point("after_receive")
        return callback(ch, method, properties, body)

    return wrapped


def _config():
    try:
        with open(os.path.join(DIR, "fault.json"), encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def _armed(name):
    cfg = _config()
    if not cfg or cfg.get("target") != SERVICE or cfg.get("point") != name:
        return None
    match = cfg.get("match")
    if match and match not in getattr(_current, "body", ""):
        return None
    try:
        fd = os.open(os.path.join(DIR, f"fired-{cfg['id']}"), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.close(fd)
    except (FileExistsError, KeyError):
        return None
    return cfg


def _block(cfg):
    release = os.path.join(DIR, f"release-{cfg['id']}")
    while not os.path.exists(release):
        time.sleep(0.02)
    log("RELEASED", id=cfg["id"], msg=current_msg())


def point(name):
    """Fire the armed fault for this point, if any. Returns its config."""
    if not ENABLED:
        return None
    cfg = _armed(name)
    if cfg is None:
        return None
    log("FAULT-POINT", id=cfg["id"], point=name, msg=current_msg())
    if cfg.get("action", "block") == "block":
        _block(cfg)
    return cfg


def after_reply(reply, republish):
    """after_reply_before_ack: block, publish duplicates, or capture the reply."""
    if not ENABLED:
        return
    cfg = point("after_reply_before_ack")
    if cfg is None:
        return
    action = cfg.get("action", "block")
    if action == "duplicate":
        extra = max(int(cfg.get("count", 2)) - 1, 0)
        for _ in range(extra):
            republish()
        log("DUPLICATED", id=cfg["id"], msg=current_msg(), copies=extra + 1)
    elif action == "capture":
        with open(os.path.join(DIR, f"captured-{cfg['id']}.json"), "w", encoding="utf-8") as handle:
            handle.write(reply)
        log("CAPTURED", id=cfg["id"], msg=current_msg())


def _format_for(path):
    ext = os.path.splitext(path)[1].lower()
    return Image.registered_extensions().get(ext)


def store_img(img, path, fmt=None):
    """Image.save(path, format=fmt), with the before_write/during_write points when enabled.

    Img_Handler passes the temporary file of its atomic write, so during_write leaves a
    partial temporary file, never a partial file under the final name."""
    if ENABLED:
        point("before_write")
        cfg = _armed("during_write")
        if cfg is not None:
            buffer = io.BytesIO()
            img.save(buffer, format=fmt or _format_for(path))
            data = buffer.getvalue()
            with open(path, "wb") as handle:
                handle.write(data[: len(data) // 2])
                handle.flush()
                os.fsync(handle.fileno())
            log("FAULT-POINT", id=cfg["id"], point="during_write", msg=current_msg(),
                written=len(data) // 2, total=len(data))
            _block(cfg)
    img.save(path, format=fmt)
