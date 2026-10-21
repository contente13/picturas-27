// Regression discovered while opening the video editor for manual acceptance tests.
// The password hash is needed internally to authenticate, but must never reach the API response.
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const bcrypt = require('bcrypt');
const UserModel = require('../models/user');
const router = require('../routes/users');
let server, base;
const email = 'video-login-regression@example.invalid';
const password = 'Only-a-local-test-2026!';
test.describe('Authentication required by the video editor', { skip: !process.env.MONGO_TEST_URL && 'MONGO_TEST_URL not set' }, () => {
  test.before(async () => {
    await mongoose.connect(process.env.MONGO_TEST_URL, { dbName: 'picturas_test_login' });
    await mongoose.connection.db.dropDatabase();
    await UserModel.create({ name: 'Video test', email, type: 'free', password_hash: await bcrypt.hash(password, 4) });
    const app = express(); app.use(express.json()); app.use(router);
    await new Promise(resolve => { server = app.listen(0, resolve); }); base = `http://127.0.0.1:${server.address().port}`;
  });
  test.after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await mongoose.connection.db.dropDatabase(); await mongoose.disconnect(); });
  async function login(pass) {
    const r = await fetch(`${base}/${email}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pass }) });
    return { status: r.status, body: await r.json() };
  }
  test('valid credentials return a session without password hashes or encrypted email fields', async () => {
    const r = await login(password); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.jwt);
    assert.equal(r.body.user.email, email);
    for (const field of ['password_hash', 'email_hash', 'email_encrypted', 'operationReservations']) assert.equal(r.body.user[field], undefined);
  });
  test('incorrect credentials never return a session', async () => {
    const r = await login('wrong-password'); assert.equal(r.status, 401); assert.equal(r.body.jwt, undefined);
  });
});
