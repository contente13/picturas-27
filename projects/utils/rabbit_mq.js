const amqp = require('amqplib');
const faultHooks = require('./faultHooks');

const rabbit_host = process.env.RABBITMQ_HOST;
const rabbit_port = process.env.RABBITMQ_PORT;
const rabbit_username = process.env.RABBITMQ_USER;
const rabbit_password = process.env.RABBITMQ_PASS;
const exchange = "picturas";

const rabbit_mq_sv = `amqp://${rabbit_username}:${rabbit_password}@${rabbit_host}:${rabbit_port}`;

// RNF-FIAB-01 (D2): one long-lived connection with a confirm channel for publishing,
// persistent messages, and a consumer that acknowledges a message only after its
// handler has finished. Both reconnect after a broker restart.
const RECONNECT_DELAY_MS = 2000;
const CONSUMER_PREFETCH = 20;
const NACK_DELAY_MS = 1000;

let publisher = null; // Promise<ConfirmChannel>

function connectPublisher() {
  if (!publisher) {
    publisher = (async () => {
      const connection = await amqp.connect(rabbit_mq_sv);
      const reset = () => { publisher = null; };
      connection.on('error', (err) => console.error('[rabbit_mq] publisher connection error:', err.message));
      connection.on('close', reset);
      const channel = await connection.createConfirmChannel();
      channel.on('error', (err) => console.error('[rabbit_mq] publisher channel error:', err.message));
      channel.on('close', reset);
      await channel.assertExchange(exchange, 'direct', { durable: true });
      return channel;
    })();
    publisher.catch(() => { publisher = null; });
  }
  return publisher;
}

// Resolves when the broker confirms the (persistent) message; rejects otherwise.
async function publish(msg, queue) {
  const channel = await connectPublisher();
  await new Promise((resolve, reject) => {
    channel.publish(exchange, queue, Buffer.from(JSON.stringify(msg)),
      { persistent: true, contentType: 'application/json' },
      (err) => (err ? reject(err) : resolve()));
  });
}

// Fire-and-forget variant for notifications (ws_queue): failures are logged.
function send_rabbit_msg(msg, queue) {
  publish(msg, queue).catch((err) => console.error(`[rabbit_mq] publish to ${queue} failed:`, err.message));
}

// The callback returns (or resolves) when the message was handled: it is then acked.
// A rejection means a transient failure: the message is requeued after a short delay.
function read_rabbit_msg(queue, callback) {
  const start = async () => {
    const connection = await amqp.connect(rabbit_mq_sv);
    connection.on('error', (err) => console.error('[rabbit_mq] consumer connection error:', err.message));
    connection.on('close', () => {
      console.error('[rabbit_mq] consumer connection closed, reconnecting');
      setTimeout(restart, RECONNECT_DELAY_MS);
    });
    const channel = await connection.createChannel();
    channel.on('error', (err) => console.error('[rabbit_mq] consumer channel error:', err.message));
    // A channel error (e.g. a precondition failure) closes only the channel: close the
    // connection too, so the 'close' handler above restarts the consumer once.
    channel.on('close', () => {
      Promise.resolve().then(() => connection.close()).catch(() => { /* already closing */ });
    });
    await channel.assertExchange(exchange, 'direct', { durable: true });
    const q = await channel.assertQueue(queue, { durable: true });
    await channel.prefetch(CONSUMER_PREFETCH);
    // READY before registering: redeliveries can arrive before consume() resolves.
    faultHooks.ready();
    await channel.consume(q.queue, (msg) => {
      if (msg == null) return;
      if (faultHooks.ENABLED) faultHooks.received(msg);
      Promise.resolve()
        .then(() => callback(msg))
        .then(
          () => channel.ack(msg),
          (err) => {
            console.error('[rabbit_mq] message not handled, requeueing:', err && err.message);
            setTimeout(() => {
              try { channel.nack(msg, false, true); } catch (_) { /* channel closed: redelivered */ }
            }, NACK_DELAY_MS);
          })
        .catch((err) => console.error('[rabbit_mq] ack failed (channel closed?):', err.message));
    }, { noAck: false });
  };
  const restart = () => start().catch((err) => {
    console.error('[rabbit_mq] consumer start failed, retrying:', err.message);
    setTimeout(restart, RECONNECT_DELAY_MS);
  });
  restart();
}

module.exports = { publish, send_rabbit_msg, read_rabbit_msg };
