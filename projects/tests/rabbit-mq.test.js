// RNF-FIAB-01: the projects consumer must keep consuming after a broker or channel
// failure. amqplib is replaced by a fake, so this runs without RabbitMQ.
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const Module = require('module');

const connections = [];
let failSetups = 0; // the next N assertQueue calls fail like a broker channel error

function fakeConnection() {
  const connection = new EventEmitter();
  connection.consumers = [];
  connection.closed = false;
  connection.close = async () => {
    if (connection.closed) throw new Error('Connection closing');
    connection.closed = true;
    connection.emit('close');
  };
  connection.createChannel = async () => {
    const channel = new EventEmitter();
    channel.assertExchange = async () => {};
    channel.assertQueue = async (queue) => {
      if (failSetups > 0) {
        // amqplib on e.g. 406 PRECONDITION_FAILED: the channel closes and the call rejects.
        failSetups -= 1;
        channel.emit('error', new Error('PRECONDITION_FAILED'));
        channel.emit('close');
        throw new Error('Channel closed by server: 406 PRECONDITION_FAILED');
      }
      return { queue };
    };
    channel.prefetch = async () => {};
    channel.consume = async (queue, handler) => { connection.consumers.push(handler); };
    channel.ack = () => {};
    channel.nack = () => {};
    connection.channel = channel;
    return channel;
  };
  connections.push(connection);
  return connection;
}

const fakeAmqp = { connect: async () => fakeConnection() };
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'amqplib') return 'amqplib';
  return originalResolve.call(this, request, ...rest);
};
require.cache.amqplib = { id: 'amqplib', filename: 'amqplib', loaded: true, exports: fakeAmqp };

const { read_rabbit_msg } = require('../utils/rabbit_mq');

const waitFor = async (predicate, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test('RNF-FIAB-01 a closed consumer channel restarts the consumer once', async () => {
  read_rabbit_msg('project_queue', async () => {});
  await waitFor(() => connections.length === 1 && connections[0].consumers.length === 1);

  // A channel-level error closes the channel while the connection stays open.
  connections[0].channel.emit('close');
  await waitFor(() => connections.length === 2 && connections[1].consumers.length === 1);
  assert.equal(connections[0].closed, true, 'the old connection is closed');

  // The restart is not repeated.
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(connections.length, 2);

  // A connection loss (broker restart) also restarts it; its channel closes as well.
  connections[1].closed = true;
  connections[1].emit('close');
  connections[1].channel.emit('close');
  await waitFor(() => connections.length === 3 && connections[2].consumers.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 2300));
  assert.equal(connections.length, 3);
});

test('RNF-FIAB-01 a failed consumer setup restarts it once, leaving one consumer', async () => {
  const base = connections.length;
  failSetups = 1;
  read_rabbit_msg('project_queue', async () => {});

  await waitFor(() => connections.length === base + 2 && connections[base + 1].consumers.length === 1);
  // The channel close, the connection close and the rejected setup report the same failure.
  await new Promise((resolve) => setTimeout(resolve, 2300));
  const mine = connections.slice(base);
  assert.equal(mine.length, 2, 'one reconnection');
  assert.equal(mine[0].closed, true, 'the failed connection is closed');
  const open = mine.filter((c) => !c.closed);
  assert.equal(open.length, 1);
  assert.equal(open[0].consumers.length, 1, 'exactly one consumer');
});
