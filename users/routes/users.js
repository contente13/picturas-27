var express = require("express");
var router = express.Router();

const axios = require("axios");
const fs = require("fs");
const https = require("https");

const auth = require("../auth/auth");
const User = require("../controllers/user");   

// lê as chaves/certificados locais (estes ficheiros EXISTEM no api-gateway-ms)
const key = fs.readFileSync(__dirname + "/../certs/selfsigned.key");
const cert = fs.readFileSync(__dirname + "/../certs/selfsigned.crt");

// agente HTTPS com cert + key
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  cert,
  key,
});

// hostname interno do microserviço de users
const usersURL = "https://users:10001/";

// URL interna do microserviço de projects
const projects_ms = "https://projects:10002/projects/";

const max_free_daily_op = Number(process.env.FREE_DAILY_OP || 5);

function operationDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function removeSensitiveInfo(user) {
  // Use the model's public serializer, which also removes encrypted email and reservations.
  const userObj = user.toJSON ? user.toJSON() : user.toObject ? user.toObject() : user;
  const { password_hash, ...userWithoutPassword } = userObj; // Destructure to exclude password_hash
  return userWithoutPassword;
}

function getRemainingOperations(user) {
  if (user.type === "premium") return null; 

  const todayKey = User.lisbonDayKey();

  const opToday = user.operations.find(
    (o) => operationDayKey(o.day) === todayKey
  );

  const used = opToday ? opToday.processed : 0;

  if (user.type === "free")
    return Math.max(0, max_free_daily_op - used);

  // anonymous não pode usar advanced_tools -> 0 operações “pagas”
  if (user.type === "anonymous") return 0;

  return 0;
}


// Get list of all users
router.get("/", function (req, res, next) {
  User.getAll()
    .then((users) => res.status(200).jsonp(users))
    .catch((_) => res.status(700).jsonp(`Error acquiring all users`));
});

router.get("/validate/:user", function (req, res, next) {
  if (!req.headers.authorization) {
    return res.status(400).jsonp("Missing or invalid Authorization header.");
  }
  User.getOne(req.params.user)
    .then((user) => {
      const token = req.headers.authorization.split(" ")[1];
      try {
        const isValid = auth.validate_jwt(user, token);
        if (isValid) {
          const userResponse = removeSensitiveInfo(user);
          const remaining_operations = getRemainingOperations(user);

          res.status(200).json({
            user: { ...userResponse, remaining_operations },
            token: token,
          });
        } else res.status(401).jsonp("Invalid token.");
      } catch (err) {
        console.error(err);
        res.status(500).jsonp("Error validating token.");
      }
    })
    .catch((_) => res.status(701).jsonp(`Error acquiring user's information.`));
});

// Get specific user
router.get("/:user", function (req, res, next) {
  User.getOne(req.params.user)
    .then((user) => {
      const userResponse = removeSensitiveInfo(user);
      const remaining_operations = getRemainingOperations(user);
      res.status(200).jsonp({ ...userResponse, remaining_operations });
    })
    .catch((_) => res.status(701).jsonp(`Error acquiring user's information.`));
});

// Check user type
router.get("/:user/type/", function (req, res, next) {
  User.getOne(req.params.user)
    .then((user) => {
      res.status(200).send({ type: user.type });
    })
    .catch((_) => res.status(701).jsonp(`Error acquiring user's information.`));
});

// Test if we can process a project based on the number of advanced tools
router.get("/:user/process/:advanced_tools", async function (req, res, next) {
  try {
    const op_num = Number.parseInt(req.params.advanced_tools, 10);
    if (!Number.isInteger(op_num) || op_num < 0) {
      return res.status(400).jsonp("Invalid operations number");
    }

    const user = await User.getOne(req.params.user);
    if (!user) return res.status(404).jsonp("Error acquiring user's information.");
    const remaining = getRemainingOperations(user);
    const allowed = user.type === "premium" || remaining >= op_num;
    return res.status(200).jsonp(allowed);
  } catch (err) {
    console.error("Error in GET /:user/process/:advanced_tools:", err);
    return res.status(500).jsonp("Error acquiring user's information.");
  }
});

router.post("/:user/process/:advanced_tools/reserve/:reservationId", async function (req, res) {
  try {
    const op_num = Number.parseInt(req.params.advanced_tools, 10);
    if (!Number.isInteger(op_num) || op_num <= 0) {
      return res.status(400).jsonp("Invalid operations number");
    }

    const result = await User.reserveOperations(req.params.user, op_num, req.params.reservationId);
    if (!result.found) return res.status(404).jsonp("Error acquiring user's information.");
    if (!result.allowed) {
      return res.status(701).jsonp("A quota diária foi esgotada. A quota é reposta às 00:00 (hora de Lisboa).");
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error("Error reserving operations:", error);
    return res.status(500).jsonp("Error acquiring user's information.");
  }
});


// Create a new user
router.post("/", function (req, res, next) {
  const user = {
    name: req.body.name || undefined,
    email: req.body.email || undefined,
    type: req.body.type || "free",
    operations: [],
  };

  // Handle anonymous user properly
  if (req.body.type === "anonymous") {
    user.email = undefined;
    user.password = "";
  } else {
    user.password = req.body.password;
  }

  User.create(user)
    .then((createdUser) => {
      const userResponse = removeSensitiveInfo(createdUser);
      const remaining_operations = getRemainingOperations(createdUser);

      res.status(201).jsonp({
        user: { ...userResponse, remaining_operations },
        jwt: auth.get_jwt(createdUser),
      });
    })
    .catch((err) => {
      // Never log the request, user object, or raw error: validation/DB errors may include values.
      console.error("USERS-MS registration failed", {
        errorName: typeof err?.name === "string" ? err.name : "Error",
        errorCode: typeof err?.code === "string" || typeof err?.code === "number" ? err.code : undefined,
      });

      res.status(702).jsonp("Error creating a new user.");
    });
});

// Login user
router.post("/:email/login", function (req, res, next) {
  User.getOneEmail(req.params.email)
    .then(async (user) => {
      const correct_pass = await auth.authenticate(req.body.password, user);
      if (correct_pass) {
        const userResponse = removeSensitiveInfo(user);
        const remaining_operations = getRemainingOperations(user);

        res.status(200).jsonp({
          user: { ...userResponse, remaining_operations },
          jwt: auth.get_jwt(user),
        });
      } else res.status(401).jsonp("The provided credentials are incorrect");
    })
    .catch((_) => res.status(701).jsonp(`Error acquiring user's information.`));
});

// Update user info
router.put("/:user", function (req, res, next) {
  User.getOne(req.params.user)
    .then((user) => {
      user.name = req.body.name || user.name;
      user.email = req.body.email || user.email;
      user.type = req.body.type || user.type;

      if (req.body.password != null) {
        user.password = req.body.password || user.password;

        User.updatePassword(req.params.user, user)
          .then((_) => res.sendStatus(204))
          .catch((_) =>
            res.status(703).jsonp(`Error updating user's information`),
          );
      } else {
        User.update(req.params.user, user)
          .then((_) => res.sendStatus(204))
          .catch((_) =>
            res.status(704).jsonp(`Error updating user's information`),
          );
      }
    })
    .catch((_) => res.status(701).jsonp(`Error acquiring user's information.`));
});

// Update number of advanced tools used
router.put("/:user/process/:advanced_tools", async function (req, res) {
  try {
    const op_num = Number.parseInt(req.params.advanced_tools, 10);
    if (!Number.isInteger(op_num) || op_num < 0) {
      return res.status(400).jsonp("Invalid operations number");
    }
    const result = await User.reserveOperations(req.params.user, op_num);
    if (!result.found) return res.status(404).jsonp("Error acquiring user's information.");
    if (!result.allowed) return res.status(799).jsonp("Cannot perform desired operation");
    return res.sendStatus(204);
  } catch (error) {
    console.error("Error updating advanced tool operations:", error);
    return res.status(704).jsonp("Error updating user's information");
  }
});

// Refund de operações quando um processamento é cancelado
router.post("/:user/process/refund/:advanced_tools", async function (req, res) {
  try {
    const op_num = parseInt(req.params.advanced_tools, 10);

    if (!Number.isFinite(op_num) || op_num <= 0) {
      return res.status(400).jsonp("Invalid operations number");
    }

    const reservationId = req.body?.reservationId;
    if (reservationId) {
      await User.refundOperationReservation(req.params.user, reservationId);
      return res.status(200).jsonp(true);
    }

    const refundDay = req.body?.dayKey || User.lisbonDayKey();
    await User.refundOperations(req.params.user, op_num, refundDay);
    return res.status(200).jsonp(true);
  } catch (err) {
    console.error("Error refunding operations:", err);
    return res.status(701).jsonp("Error acquiring user's information.");
  }
});

router.post("/:user/process/commit/:reservationId", async function (req, res) {
  try {
    await User.commitOperationReservation(req.params.user, req.params.reservationId);
    return res.status(200).jsonp(true);
  } catch (error) {
    console.error("Error committing reserved operations:", error);
    return res.status(701).jsonp("Error settling reserved operations.");
  }
});

// Delete a user + all related data (projects, daily ops, etc.)
router.delete("/:user", async function (req, res, next) {
  const userId = req.params.user;

  try {
    // Garantir que o user do token é o mesmo
    // Se o API Gateway já valida isto, podes confiar nele.
    if (!req.headers.authorization) {
      return res.status(401).jsonp("Missing Authorization header");
    }

    const authHeader = req.headers.authorization;

    // 1) Apagar projetos do utilizador no projects-ms
    try {
      await axios.delete(projects_ms + userId, {
        httpsAgent,
        headers: {
          Authorization: authHeader,
        },
      });
    } catch (err) {
      console.error(
        "Error deleting user's projects:",
        err.response?.status,
        err.response?.data
      );
      // Se for para falhar logo: return res.status(502).jsonp("Error deleting user's projects");
      // Aqui estou a continuar mesmo que dê erro, para não bloquear o delete de conta.
    }

    // 2) Apagar o próprio utilizador
    await User.delete(userId);

    // 3) (Opcional) Apagar daily_operations associadas ao user
    // if (dailyoperationsModel) {
    //   await dailyoperationsModel.dailyOperation_deleteByUserId(userId);
    // }

    return res.sendStatus(204);
  } catch (err) {
    console.error("Error deleting user and related data:", err);
    return res
      .status(705)
      .jsonp(`Error deleting user's information and related data`);
  }
});


module.exports = router;
