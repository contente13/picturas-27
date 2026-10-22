// Direct HTTP requests to the real service routers, without the API gateway.
// Database calls are controlled so rejection and side effects can be checked offline.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const { tokenFor } = require("./helpers/auth");
const { getCallerId } = require("../utils/caller");
const Project = require("../controllers/project");
const ProjectModel = require("../models/project");

const owner = "507f1f77bcf86cd799439011";
const collaborator = "507f1f77bcf86cd799439012";
const projectId = "507f1f77bcf86cd799439013";
const imageId = "507f1f77bcf86cd799439014";
const videoPath = `/${owner}/${projectId}/video/${imageId}`;
let lookups = 0;
let writes = 0;
const originals = {
  getOne: Project.getOne,
  getOneByShareId: Project.getOneByShareId,
  findOneAndUpdate: ProjectModel.findOneAndUpdate,
};
const project = {
  _id: projectId,
  user_id: owner,
  version: 0,
  imgs: { id: (id) => id === imageId ? {
    subtitles: [{ start: 0, end: 1, text: "original" }],
    mediaMetadata: { duration: 10 },
  } : null },
  sharedLinks: [
    { id: "read-link", permission: "read" },
    { id: "edit-link", permission: "edit" },
    { id: "revoked-link", permission: "edit", revoked: true },
  ],
};
Project.getOne = async () => { lookups++; return project; };
Project.getOneByShareId = async (id) => {
  lookups++;
  return project.sharedLinks.some((link) => link.id === id) ? project : null;
};
ProjectModel.findOneAndUpdate = () => {
  writes++;
  return { select: () => ({ lean: async () => ({ version: 1 }) }) };
};
const videoRouter = require("../routes/video");
const videoConcatRouter = require("../routes/videoConcat");
const { router: projectRouter } = require("../routes/projects");
let server;
let base;

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use(videoRouter);
  app.use(videoConcatRouter);
  app.use(projectRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => { lookups = 0; writes = 0; });
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  Object.assign(Project, { getOne: originals.getOne, getOneByShareId: originals.getOneByShareId });
  ProjectModel.findOneAndUpdate = originals.findOneAndUpdate;
});

async function request(method, path, token, extraHeaders = {}) {
  return fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    ...(method === "PUT" ? { body: JSON.stringify({
      segments: [{ start: 0, end: 1, text: "edited" }], projectVersion: 0,
    }) } : {}),
  });
}

const protectedRoutes = [
  ["GET", `${videoPath}/subtitles`],
  ["PUT", `${videoPath}/subtitles`],
  ["GET", `${videoPath}/with-subtitles`],
  ["POST", `${videoPath}/trim`],
  ["POST", `${videoPath}/subtitles/generate`],
  ["POST", `${videoPath}/subtitles/embed`],
  ["POST", `/${owner}/${projectId}/video/concat`],
  ["POST", `/${owner}/${projectId}/img`],
  ["GET", `/${owner}/${projectId}`],
  ["GET", `/${owner}/${projectId}/imgs`],
  ["GET", `/${owner}`],
  ["POST", `/${owner}`],
  ["DELETE", `/${owner}`],
  ["GET", `/${owner}/${projectId}/share`],
  ["GET", "/share/read-link/project"],
];

test("REQ-VID-QUAL-002: a forged X-Caller-Id cannot bypass any project/video entry point", async () => {
  for (const [method, path] of protectedRoutes) {
    const response = await request(method, path, null, { "x-caller-id": owner });
    assert.equal(response.status, 401, `${method} ${path}`);
    await response.text();
  }
  assert.equal(lookups, 0);
  assert.equal(writes, 0);
});

test("REQ-VID-QUAL-002: invalid JWTs cannot authenticate, including through a valid share link", async () => {
  const valid = tokenFor(owner);
  const [header, payload] = valid.split(".");
  const invalid = [
    "not-a-jwt",
    jwt.sign({ id: owner }, "wrong-signing-key", { expiresIn: "1h" }),
    `${header}.${Buffer.from(JSON.stringify({ id: owner, exp: 9999999999 })).toString("base64url")}.${valid.split(".")[2]}`,
    `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${payload}.`,
    jwt.sign({ id: owner }, process.env.JWT_SECRET_KEY, { expiresIn: -1 }),
    jwt.sign({ id: owner }, process.env.JWT_SECRET_KEY, { expiresIn: "1h", notBefore: "1h" }),
    jwt.sign({ id: owner }, process.env.JWT_SECRET_KEY),
    jwt.sign({}, process.env.JWT_SECRET_KEY, { expiresIn: "1h" }),
    jwt.sign({ id: { owner } }, process.env.JWT_SECRET_KEY, { expiresIn: "1h" }),
    jwt.sign({ id: owner }, process.env.JWT_SECRET_KEY, { algorithm: "HS384", expiresIn: "1h" }),
  ];
  for (const token of invalid) {
    for (const suffix of ["", "?share=edit-link"]) {
      const response = await request("PUT", `${videoPath}/subtitles${suffix}`, token, { "x-caller-id": owner });
      assert.equal(response.status, 401);
      await response.text();
    }
  }
  assert.equal(lookups, 0);
  assert.equal(writes, 0);
});

test("REQ-VID-QUAL-002: the verified JWT wins over a forged owner header", async () => {
  const token = tokenFor(collaborator);
  assert.equal(getCallerId({ headers: { authorization: `Bearer ${token}`, "x-caller-id": owner } }), collaborator);
  for (const [method, path] of protectedRoutes.filter(([, path]) => !path.startsWith("/share/"))) {
    const response = await request(method, path, token, { "x-caller-id": owner });
    assert.equal(response.status, 403, `${method} ${path}`);
    await response.text();
  }
  assert.equal(lookups, 0);
  assert.equal(writes, 0);
});

test("owner access works with a valid JWT and without X-Caller-Id", async () => {
  const response = await request("GET", `${videoPath}/subtitles`, tokenFor(owner));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).segments[0].text, "original");
});

test("a read-share collaborator can read but cannot edit subtitles or start processing", async () => {
  const token = tokenFor(collaborator);
  const response = await request("GET", `${videoPath}/subtitles?share=read-link`, token);
  assert.equal(response.status, 200);
  await response.text();
  for (const [method, path] of [["PUT", `${videoPath}/subtitles`], ["POST", `${videoPath}/trim`], ["POST", `/${owner}/${projectId}/video/concat`], ["POST", `/${owner}/${projectId}/img`]]) {
    const denied = await request(method, `${path}?share=read-link`, token);
    assert.equal(denied.status, 403);
    await denied.text();
  }
  assert.equal(writes, 0);
});

test("an edit-share collaborator can save subtitles with a valid JWT", async () => {
  const response = await request("PUT", `${videoPath}/subtitles?share=edit-link`, tokenFor(collaborator));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).projectVersion, 1);
  assert.equal(writes, 1);
});

test("unknown, revoked and mismatched share links cannot authorize access", async () => {
  const token = tokenFor(collaborator);
  for (const [path, status] of [
    [`${videoPath}/subtitles?share=unknown`, 404],
    [`${videoPath}/subtitles?share=revoked-link`, 410],
    [`/${collaborator}/${projectId}/video/${imageId}/subtitles?share=edit-link`, 403],
    [`/${owner}/another-project/video/${imageId}/subtitles?share=edit-link`, 403],
  ]) {
    const response = await request("GET", path, token);
    assert.equal(response.status, status);
    await response.text();
  }
  assert.equal(writes, 0);
});

test("missing server JWT configuration fails closed", () => {
  const token = tokenFor(owner);
  const secret = process.env.JWT_SECRET_KEY;
  try {
    delete process.env.JWT_SECRET_KEY;
    assert.equal(getCallerId({ headers: { authorization: `Bearer ${token}`, "x-caller-id": owner } }), null);
  } finally {
    process.env.JWT_SECRET_KEY = secret;
  }
});
