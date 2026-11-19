// RNF-FIAB-01: the projects consumer must keep consuming after a broker or channel
// failure. amqplib is replaced by a fake, so this runs without RabbitMQ.
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const Module = require('module');

const connections = [];

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
    channel.assertQueue = async (queue) => ({ queue });
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
  connections[2].close(); // stop the reconnect loop
});
