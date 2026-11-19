import functools
import threading
import time

import pika
from pika.exchange_type import ExchangeType

from . import fault_hooks

"""
RabbitMQ helper shared by the image workers.

RNF-FIAB-01: a request is acknowledged only after its handler has finished and the
reply was confirmed by the broker (publisher confirms, persistent message). If the
worker dies before that, the broker redelivers the request. The handler runs in a
separate thread so the connection keeps answering heartbeats during long effects;
publishes and acks always run on the connection thread.

# Handler example
def handler(ch, method, properties, body):
    print(f" [x] Received {body.decode()}")
"""

EXCHANGE = "picturas"
RECONNECT_DELAY_S = 2


class PublishError(Exception):
    """The broker did not confirm a reply; the request must not be acknowledged."""


class Rabbit_MQ:
    def __init__(self, host, port, username, password):
        self._host = host
        self._port = port
        self._credentials = pika.PlainCredentials(username, password)
        self._queue = ''
        self._connect()

    def _connect(self):
        while True:
            try:
                self._connection = pika.BlockingConnection(
                    pika.ConnectionParameters(self._host, self._port, '/', self._credentials))
                break
            except (pika.exceptions.AMQPConnectionError, OSError) as error:
                # OSError covers DNS failures while the broker container is recreated.
                print(f"[rabbit_mq] broker unavailable ({error!r}), retrying", flush=True)
                time.sleep(RECONNECT_DELAY_S)
        self._io_thread = threading.get_ident()
        self._channel = self._connection.channel()
        self._channel.confirm_delivery()
        self._channel.exchange_declare(
            exchange=EXCHANGE,
            exchange_type=ExchangeType.direct,
            durable=True,
        )

    def _publish(self, msg, queue):
        try:
            self._channel.basic_publish(
                exchange=EXCHANGE, routing_key=queue, body=msg,
                properties=pika.BasicProperties(delivery_mode=2, content_type="application/json"),
                mandatory=True)
        except (pika.exceptions.UnroutableError, pika.exceptions.NackError,
                pika.exceptions.AMQPError) as error:
            raise PublishError(repr(error)) from error

    def send_rabbit_msg(self, msg, queue):
        """Publish and wait for the broker confirmation (raises PublishError otherwise)."""
        if threading.get_ident() == self._io_thread:
            self._publish(msg, queue)
            return
        done = threading.Event()
        outcome = {}

        def publish():
            try:
                self._publish(msg, queue)
            except Exception as error:  # noqa: BLE001 - re-raised in the handler thread
                outcome["error"] = error
            finally:
                done.set()

        try:
            self._connection.add_callback_threadsafe(publish)
        except Exception as error:  # noqa: BLE001 - connection already closed
            raise PublishError(repr(error)) from error
        while not done.wait(1):
            if self._connection.is_closed:
                raise PublishError("connection closed before the publish was confirmed")
        if "error" in outcome:
            raise outcome["error"]

    def _settle(self, channel, delivery_tag, ok):
        if not channel.is_open:
            return  # the broker requeues unacknowledged deliveries of a closed channel
        if ok:
            channel.basic_ack(delivery_tag=delivery_tag)
        else:
            channel.basic_nack(delivery_tag=delivery_tag, requeue=True)

    def _on_message(self, handler):
        def on_message(ch, method, properties, body):
            def work():
                ok = False
                try:
                    handler(ch, method, properties, body)
                    ok = True
                except Exception as error:  # noqa: BLE001 - nack and let the broker redeliver
                    print(f"[rabbit_mq] request not acknowledged: {error!r}", flush=True)
                try:
                    self._connection.add_callback_threadsafe(
                        functools.partial(self._settle, ch, method.delivery_tag, ok))
                except Exception:  # noqa: BLE001 - connection closed: broker redelivers
                    pass

            threading.Thread(target=work, name="tool-handler", daemon=True).start()

        return on_message

    def read_rabbit_msg(self, queue, callback):
        if self._queue == "":
            self._queue = queue
        if self._connection.is_closed:
            self._connect()

        self._channel.queue_declare(queue=self._queue, durable=True)
        # One request at a time: a dying worker takes no buffered requests with it.
        self._channel.basic_qos(prefetch_count=1)
        self._channel.basic_consume(
            queue=self._queue,
            on_message_callback=self._on_message(callback),
            auto_ack=False,
        )

        fault_hooks.ready()
        try:
            self._channel.start_consuming()
        except pika.exceptions.AMQPConnectionError as error:
            # Broker restart or network loss: unacknowledged requests are redelivered.
            print(f"[rabbit_mq] connection lost ({error!r}), reconnecting", flush=True)
            time.sleep(RECONNECT_DELAY_S)
            self._connect()
