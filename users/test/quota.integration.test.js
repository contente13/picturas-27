// The daily quota stays per user under RNG-11: requests coming from different projects at the
// same time must never reserve more than the operations left. Runs the real users controller
// against a throw-away MongoDB database.
//
//   MONGO_TEST_URL=mongodb://users_mongoDB:27019/users_test npm test
//
// Skipped when MONGO_TEST_URL is not set.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUrl = process.env.MONGO_TEST_URL;
const skip = !mongoUrl && "MONGO_TEST_URL not set";

const User = require("../controllers/user");
const UserModel = require("../models/user");

async function newUser(type, usedToday = 0) {
  const day = new Date(`${User.lisbonDayKey()}T00:00:00.000Z`);
  const { insertedId } = await UserModel.collection.insertOne({
    type, operations: usedToday ? [{ day, processed: usedToday }] : [], operationReservations: [], __v: 0,
  });
  return String(insertedId);
}

const reserveFromProjects = (userId, projects) =>
  Promise.all(projects.map((project) => User.reserveOperations(userId, 1, `task-${project}-${Math.random()}`)));

test.describe("Daily quota shared by all projects of a user", { skip }, () => {
  test.before(async () => {
    await mongoose.connect(mongoUrl);
    await mongoose.connection.db.dropDatabase();
  });
  test.after(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  test("registered user with one operation left: two simultaneous requests from different projects, only one is reserved", async () => {
    const user = await newUser("free", 4);
    const results = await reserveFromProjects(user, ["A", "B"]);
    assert.deepEqual(results.map((result) => result.allowed).sort(), [false, true]);
  });

  test("registered user with 5 operations: 8 simultaneous requests across projects reserve exactly 5", async () => {
    const user = await newUser("free", 0);
    const results = await reserveFromProjects(user, ["A", "B", "C", "D", "E", "F", "G", "H"]);
    assert.equal(results.filter((result) => result.allowed).length, 5);
  });

  test("a refunded reservation becomes available again and refunding an unknown one changes nothing", async () => {
    const user = await newUser("free", 4);
    const [accepted] = await Promise.all([User.reserveOperations(user, 1, "task-ok")]);
    assert.equal(accepted.allowed, true);
    assert.equal((await User.reserveOperations(user, 1, "task-rejected")).allowed, false);
    await User.refundOperationReservation(user, "task-rejected");
    assert.equal((await User.reserveOperations(user, 1, "task-again")).allowed, false, "unknown refund must not free quota");
    await User.refundOperationReservation(user, "task-ok");
    assert.equal((await User.reserveOperations(user, 1, "task-after-refund")).allowed, true);
  });

  test("premium user has no daily limit across projects", async () => {
    const user = await newUser("premium", 50);
    const results = await reserveFromProjects(user, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]);
    assert.ok(results.every((result) => result.allowed));
  });
});
