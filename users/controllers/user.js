const bcrypt = require("bcrypt");
const User = require("../models/user");
const { hashEmail } = require("../utils/fieldCrypto");

const MAX_DAILY_OPERATIONS = Number(process.env.FREE_DAILY_OP || 5);
const MAX_OPERATION_UPDATE_ATTEMPTS = 20;

function lisbonDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateForDayKey(dayKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey || "");
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === dayKey ? date : null;
}

function operationDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function copyOperationEntries(entries = []) {
  return entries.map((entry) => entry.toObject ? entry.toObject() : { ...entry });
}

function userVersionFilter(user) {
  return user.__v == null
    ? { _id: user._id, __v: { $exists: false } }
    : { _id: user._id, __v: user.__v };
}

async function reserveOperations(userId, amount, reservationId) {
  const operationAmount = Number(amount);
  if (!Number.isInteger(operationAmount) || operationAmount < 0) {
    throw new Error("Invalid operations number");
  }

  for (let attempt = 0; attempt < MAX_OPERATION_UPDATE_ATTEMPTS; attempt += 1) {
    const user = await User.findById(userId).exec();
    if (!user) return { found: false, allowed: false };

    const reservations = copyOperationEntries(user.operationReservations || []);
    const existingReservation = reservationId && reservations.find((entry) => entry.id === reservationId);
    if (existingReservation) {
      return { found: true, allowed: true, reservedFor: operationDayKey(existingReservation.day) };
    }

    if (user.type === "anonymous" && operationAmount > 0) {
      return { found: true, allowed: false, remaining: 0 };
    }

    const dayKey = lisbonDayKey();
    const operationDate = dateForDayKey(dayKey);
    const operations = copyOperationEntries(user.operations || []);
    const currentEntry = operations.find((entry) => operationDayKey(entry.day) === dayKey);
    const used = currentEntry?.processed || 0;
    if (user.type === "free" && used + operationAmount > MAX_DAILY_OPERATIONS) {
      return {
        found: true,
        allowed: false,
        remaining: Math.max(0, MAX_DAILY_OPERATIONS - used),
        resetAt: "00:00 (hora de Lisboa)",
      };
    }

    if (operationAmount > 0) {
      if (currentEntry) currentEntry.processed = used + operationAmount;
      else operations.push({ day: operationDate, processed: operationAmount });
    }
    if (reservationId) {
      reservations.push({ id: reservationId, day: operationDate, amount: operationAmount });
    }

    const updated = await User.updateOne(
      userVersionFilter(user),
      { $set: { operations, operationReservations: reservations }, $inc: { __v: 1 } },
    );
    if (updated.matchedCount) {
      return {
        found: true,
        allowed: true,
        reservedFor: dayKey,
        remaining: user.type === "free"
          ? Math.max(0, MAX_DAILY_OPERATIONS - used - operationAmount)
          : null,
      };
    }
  }

  throw new Error("Não foi possível reservar as operações devido a alterações concorrentes. Tenta novamente.");
}

async function settleOperationReservation(userId, reservationId, refund = false) {
  if (!reservationId) return { settled: false };

  for (let attempt = 0; attempt < MAX_OPERATION_UPDATE_ATTEMPTS; attempt += 1) {
    const user = await User.findById(userId).exec();
    if (!user) return { settled: false };
    const reservations = copyOperationEntries(user.operationReservations || []);
    const reservationIndex = reservations.findIndex((entry) => entry.id === reservationId);
    if (reservationIndex < 0) return { settled: true, alreadySettled: true };

    const [reservation] = reservations.splice(reservationIndex, 1);
    const operations = copyOperationEntries(user.operations || []);
    if (refund) {
      const reservationDay = operationDayKey(reservation.day);
      const operationIndex = operations.findIndex((entry) => operationDayKey(entry.day) === reservationDay);
      if (operationIndex >= 0) {
        operations[operationIndex].processed = Math.max(0, operations[operationIndex].processed - reservation.amount);
        if (operations[operationIndex].processed === 0) operations.splice(operationIndex, 1);
      }
    }

    const updated = await User.updateOne(
      userVersionFilter(user),
      { $set: { operations, operationReservations: reservations }, $inc: { __v: 1 } },
    );
    if (updated.matchedCount) return { settled: true, refunded: refund };
  }

  throw new Error("Não foi possível atualizar a reserva devido a alterações concorrentes. Tenta novamente.");
}

async function refundOperations(userId, amount, dayKey = lisbonDayKey()) {
  const operationAmount = Number(amount);
  const requestedDay = dateForDayKey(dayKey);
  if (!Number.isInteger(operationAmount) || operationAmount <= 0 || !requestedDay) {
    throw new Error("Invalid operations refund");
  }

  for (let attempt = 0; attempt < MAX_OPERATION_UPDATE_ATTEMPTS; attempt += 1) {
    const user = await User.findById(userId).exec();
    if (!user) return { found: false };
    if (user.type === "premium") return { found: true };

    const operations = copyOperationEntries(user.operations || []);
    const operationIndex = operations.findIndex((entry) => operationDayKey(entry.day) === dayKey);
    if (operationIndex < 0) return { found: true };
    operations[operationIndex].processed = Math.max(0, operations[operationIndex].processed - operationAmount);
    if (operations[operationIndex].processed === 0) operations.splice(operationIndex, 1);

    const updated = await User.updateOne(
      userVersionFilter(user),
      { $set: { operations }, $inc: { __v: 1 } },
    );
    if (updated.matchedCount) return { found: true };
  }

  throw new Error("Não foi possível devolver as operações devido a alterações concorrentes. Tenta novamente.");
}

async function encrypt_password(user) {
  const salt = await bcrypt.genSalt();
  user.password_hash = await bcrypt.hash(user.password, salt);

  delete user.password;

  return user;
}

module.exports.getAll = async () => {
  const users = await User.find().sort({ _id: 1 }).exec();

  return users.map((u) => u.toJSON());
};


module.exports.getOne = async (user_id) => {
  const user = await User.findOne({ _id: user_id }).exec();
  return user ? user.toJSON() : null;
};

module.exports.getOneEmail = async (email) => {
  const emailHash = hashEmail(email);
  const user = await User.findOne({ email_hash: emailHash }).exec();
  return user ? user.toJSON() : null;
};


module.exports.create = async (user) => {
  try {
    const encrypt_user = await encrypt_password(user);
    const created = await User.create(encrypt_user);
    // devolve já o objeto JSON com email desencriptado e campos sensíveis removidos
    return created.toJSON();
  } catch (error) {
    if (error.code === 11000 && error.keyPattern && error.keyPattern.email_hash) {
      throw Error("The given email is already in use.");
    }
    throw error;
  }
};

module.exports.updatePassword = async (user_id, user) => {
  const encrypted = await encrypt_password({ password: user.password });
  return updateUserProfile(user_id, user, encrypted.password_hash);
};

async function updateUserProfile(user_id, user, passwordHash) {
  const existingUser = await User.findById(user_id).exec();
  if (!existingUser) return { matchedCount: 0 };

  if (Object.prototype.hasOwnProperty.call(user, "name")) existingUser.name = user.name;
  if (Object.prototype.hasOwnProperty.call(user, "email")) existingUser.email = user.email;
  if (Object.prototype.hasOwnProperty.call(user, "type")) existingUser.type = user.type;
  if (passwordHash) existingUser.password_hash = passwordHash;

  return existingUser.save();
}

module.exports.update = updateUserProfile;

module.exports.reserveOperations = reserveOperations;
module.exports.refundOperations = refundOperations;
module.exports.refundOperationReservation = (userId, reservationId) =>
  settleOperationReservation(userId, reservationId, true);
module.exports.commitOperationReservation = (userId, reservationId) =>
  settleOperationReservation(userId, reservationId, false);
module.exports.lisbonDayKey = lisbonDayKey;

module.exports.delete = (user_id) => {
  return User.deleteOne({ _id: user_id });
};
