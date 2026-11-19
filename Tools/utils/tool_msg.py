import datetime
import hashlib
import json
import os
import threading

from .rabbit_mq import Rabbit_MQ, PublishError
from . import fault_hooks

"""
# Callback example for those who need it
def callback(ch, method, properties, body):
    print(f" [x] Received {body.decode()}")
"""

# RNF-FIAB-01: deliveries of the same request (same messageId) are counted in the shared
# image_data volume; after MAX_DELIVERIES the request is answered with a permanent error
# instead of being processed again (classic queues do not count redeliveries).
MAX_DELIVERIES = int(os.getenv("RNF_FIAB_01_MAX_DELIVERIES", "3"))
ATTEMPTS_DIR = os.getenv("RNF_FIAB_01_ATTEMPTS_DIR", "/app/images/.attempts")
ATTEMPTS_EXHAUSTED = "attempts_exhausted"
UNEXPECTED_ERROR = "unexpected_error"


def count_attempt(message_id):
    """Record one delivery of message_id and return how many deliveries it has had."""
    try:
        os.makedirs(ATTEMPTS_DIR, exist_ok=True)
        path = os.path.join(ATTEMPTS_DIR, hashlib.sha256(message_id.encode()).hexdigest())
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
        try:
            os.write(fd, b"1")  # O_APPEND writes are atomic: the size is the count
            return os.fstat(fd).st_size
        finally:
            os.close(fd)
    except OSError as error:
        print(f"[tool_msg] attempt ledger unavailable ({error!r})", flush=True)
        return 1


class ToolMSG:
    queues = {
        'border': 'border_queue',
        'brightness': 'brightness_queue',
        'contrast': 'contrast_queue',
        'cut': 'cut_queue',
        'scale': 'scale_queue',
        'saturation': 'saturation_queue',
        'binarization': 'binarization_queue',
        'rotate': 'rotate_queue',
        'resize': 'resize_queue',
        'cut_ai': 'cut_ai_queue',
        'upgrade_ai': 'upgrade_ai_queue',
        'bg_remove_ai': 'bg_remove_ai_queue',
        'text_ai': 'text_ai_queue',
        'obj_ai': 'obj_ai_queue',
        'people_ai': 'people_ai_queue',
        'expand_ai': 'expand_ai_queue',
        'project': 'project_queue'
    }
    
    def __init__(self, microservice_name, tool_name, rabbit_host, rabbit_port, username, password):
        self._microservice_name = microservice_name
        self._queue = self.queues[tool_name]
        self._proj_queue = self.queues['project']
        self._rabbit_mq = Rabbit_MQ(rabbit_host, rabbit_port, username, password)
        self._state = threading.local()
    
    def read_msg(self, callback):
        # RECEIVED/after_receive hooks see every delivery, including exhausted ones.
        self._rabbit_mq.read_rabbit_msg(self._queue, fault_hooks.wrap_callback(self._handler(callback)))

    def _handler(self, callback):
        """Run one request: limit deliveries, and always answer it exactly once.

        Returning normally acknowledges the request; raising (only when a reply could
        not be confirmed by the broker) leaves it for redelivery.
        """
        def handle(ch, method, properties, body):
            self._state.replied = False
            try:
                info = json.loads(body.decode())
                msg_id = info['messageId']
            except (ValueError, KeyError, TypeError, AttributeError):
                print("[tool_msg] dropping a request without a valid messageId", flush=True)
                return
            input_uri = (info.get('parameters') or {}).get('inputImageURI') or ""
            started = datetime.datetime.now(datetime.timezone.utc)

            def fail(code, message):
                now = datetime.datetime.now(datetime.timezone.utc)
                self.send_msg(msg_id, f"{self._microservice_name}-{code}-{msg_id}", now.isoformat(),
                              'error', (now - started).total_seconds() * 1000, None,
                              err_code=code, err_msg=message, og_img_uri=input_uri)

            attempt = count_attempt(msg_id)
            if attempt > MAX_DELIVERIES:
                fail(ATTEMPTS_EXHAUSTED, f"Request delivered {attempt} times; giving up")
                return
            try:
                callback(ch, method, properties, body)
            except PublishError:
                raise
            except Exception as error:  # noqa: BLE001 - permanent error of this request
                if self._state.replied:
                    return
                fail(UNEXPECTED_ERROR, f"An error occurred while processing the request: {error}")
                return
            if not self._state.replied:
                fail(UNEXPECTED_ERROR, "The tool finished without answering the request")

        return handle

    def send_msg(self, msg_id, resp_msg_id, timestamp, status, processingTime, new_img_uri, type="image", err_code=None, err_msg=None, og_img_uri=None):

        # Every tool reports errors positionally as (..., None, code, message, input_uri),
        # which lands in (type, err_code, err_msg). Accept that call shape.
        if status == "error" and og_img_uri is None and err_msg is not None and not isinstance(type, str):
            type, err_code, err_msg, og_img_uri = "image", type, err_code, err_msg

        msg = {}
        
        match status:
            case "success":
                msg = {
                    "messageId": resp_msg_id,
                    "correlationId": msg_id,
                    "timestamp": timestamp,
                    "status": status,
                    "output": {
                        "type": type,
                        "imageURI": new_img_uri
                    },
                    "metadata": {
                        "processingTime": processingTime,
                        "microservice": self._microservice_name
                    }
                }
            case "error":
                if err_code is None or err_msg is None or og_img_uri is None:
                    raise Exception("Make sure, in case of error status, err_code, err_msg and og_img_uri are not None")
                
                # correlationId identifies the request, as in success replies.
                msg = {
                    "messageId": resp_msg_id,
                    "correlationId": msg_id,
                    "timestamp": timestamp,
                    "status": status,
                    "error": {
                        "code": err_code,
                        "message": err_msg,
                        "details": {
                            "inputFileURI": og_img_uri
                        }
                    },
                    "metadata": {
                        "processingTime": processingTime,
                        "microservice": self._microservice_name
                    }
                }
            case _:
                msg = {}
                
        msg = json.dumps(msg)    
            
        if fault_hooks.ENABLED:
            fault_hooks.point("after_output_before_reply")
        self._rabbit_mq.send_rabbit_msg(msg, self._proj_queue)
        self._state.replied = True
        if fault_hooks.ENABLED:
            fault_hooks.after_reply(msg, lambda: self._rabbit_mq.send_rabbit_msg(msg, self._proj_queue))
        
