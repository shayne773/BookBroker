import { expect, use } from "chai";
import { default as chaiHttp, request } from "chai-http";
import mongoose from "mongoose";

import app, { loginThrottle } from "../app.js";
import { User } from "../Data.js";
import {
  authHeader,
  clearDatabase,
  createOfferedBook,
  createUser,
  TEST_PASSWORD,
} from "./helpers.js";

use(chaiHttp);

const ALLOWED_ORIGIN = "http://localhost:3000";
const DISALLOWED_ORIGIN = "https://evil.example.com";

// Scoped to each describe rather than declared at the root: a root-level hook
// in one spec file also runs for every other spec file.
async function resetState() {
  await clearDatabase();
  loginThrottle.reset();
}

// ---------------------------------------------------------------------------
// GET /users/:id - auth required, public fields only
// ---------------------------------------------------------------------------
describe("GET /users/:id", () => {
  beforeEach(resetState);

  it("rejects an unauthenticated request", async () => {
    const user = await createUser();

    const res = await request.execute(app).get(`/users/${user._id}`);

    expect(res).to.have.status(401);
  });

  it("never returns the password hash or the email address", async () => {
    const user = await createUser({ location: "Queens" });
    const viewer = await createUser();

    const res = await request
      .execute(app)
      .get(`/users/${user._id}`)
      .set(authHeader(viewer));

    expect(res).to.have.status(200);
    expect(res.body).to.include({
      username: user.username,
      location: "Queens",
      ratings: 5,
    });
    expect(res.body).to.not.have.property("password");
    expect(res.body).to.not.have.property("email");
    expect(JSON.stringify(res.body)).to.not.include(user.email);
    expect(JSON.stringify(res.body)).to.not.include("$2");
  });

  it("rejects an id that is not an ObjectId", async () => {
    const viewer = await createUser();

    const res = await request.execute(app).get("/users/1").set(authHeader(viewer));

    expect(res).to.have.status(400);
  });

  it("returns 404 for an unknown user", async () => {
    const viewer = await createUser();
    const missing = new mongoose.Types.ObjectId();

    const res = await request.execute(app).get(`/users/${missing}`).set(authHeader(viewer));

    expect(res).to.have.status(404);
  });
});

// ---------------------------------------------------------------------------
// Regex injection in the genre filter and the search route
// ---------------------------------------------------------------------------
describe("regex handling in genre and search", () => {
  beforeEach(resetState);

  it("treats a genre with regex metacharacters as a literal", async () => {
    const owner = await createUser();
    await createOfferedBook(owner, { genre: "Adventure" });
    await createOfferedBook(owner, { genre: "Romance" });

    const res = await request.execute(app).get(`/genres/${encodeURIComponent(".*")}`);

    expect(res).to.have.status(200);
    expect(res.body).to.be.an("array").that.is.empty;
  });

  it("still matches a genre case-insensitively", async () => {
    const owner = await createUser();
    await createOfferedBook(owner, { genre: "Adventure" });
    await createOfferedBook(owner, { genre: "Romance" });

    const res = await request.execute(app).get("/genres/adventure");

    expect(res).to.have.status(200);
    expect(res.body).to.have.lengthOf(1);
    expect(res.body[0].genre).to.equal("Adventure");
  });

  it("does not let a genre prefix match a different genre", async () => {
    const owner = await createUser();
    await createOfferedBook(owner, { genre: "Adventure" });

    const res = await request.execute(app).get("/genres/Adven");

    expect(res).to.have.status(200);
    expect(res.body).to.be.an("array").that.is.empty;
  });

  it("treats a search query with regex metacharacters as a literal", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    await createOfferedBook(owner, { title: "The Hobbit" });

    const res = await request
      .execute(app)
      .get("/browse")
      .query({ q: ".*" })
      .set(authHeader(viewer));

    expect(res).to.have.status(200);
    expect(res.body.searchResults).to.be.an("array").that.is.empty;
  });

  it("survives a query built to cause catastrophic backtracking", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    await createOfferedBook(owner, { title: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!" });

    const evil = `${"(a+)+".repeat(8)}$`;
    const startedAt = Date.now();

    const res = await request
      .execute(app)
      .get("/browse")
      .query({ q: evil })
      .set(authHeader(viewer));

    expect(res).to.have.status(200);
    expect(res.body.searchResults).to.be.an("array").that.is.empty;
    expect(Date.now() - startedAt).to.be.below(5000);
  });

  it("still finds books by a substring of the title", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    await createOfferedBook(owner, { title: "The Hobbit" });
    await createOfferedBook(owner, { title: "Dune", author: "Frank Herbert" });

    const res = await request
      .execute(app)
      .get("/browse")
      .query({ q: "hobb" })
      .set(authHeader(viewer));

    expect(res).to.have.status(200);
    expect(res.body.searchResults).to.have.lengthOf(1);
    expect(res.body.searchResults[0].title).to.equal("The Hobbit");
  });
});

// ---------------------------------------------------------------------------
// CORS allowlist
// ---------------------------------------------------------------------------
describe("CORS allowlist", () => {
  beforeEach(resetState);

  it("allows a configured origin", async () => {
    const res = await request.execute(app).get("/genres").set("Origin", ALLOWED_ORIGIN);

    expect(res).to.have.status(200);
    expect(res).to.have.header("access-control-allow-origin", ALLOWED_ORIGIN);
  });

  it("sends no allow-origin header for an unlisted origin", async () => {
    const res = await request.execute(app).get("/genres").set("Origin", DISALLOWED_ORIGIN);

    expect(res.headers).to.not.have.property("access-control-allow-origin");
  });

  it("does not approve a preflight from an unlisted origin", async () => {
    const res = await request
      .execute(app)
      .options("/auth/login")
      .set("Origin", DISALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "POST");

    expect(res.headers).to.not.have.property("access-control-allow-origin");
  });

  it("approves a preflight from a configured origin", async () => {
    const res = await request
      .execute(app)
      .options("/auth/login")
      .set("Origin", ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "POST");

    expect(res).to.have.header("access-control-allow-origin", ALLOWED_ORIGIN);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/register - validation, normalization, city persistence
// ---------------------------------------------------------------------------
describe("POST /auth/register", () => {
  beforeEach(resetState);

  const validBody = () => ({
    username: "newreader",
    email: "New.Reader@Example.COM",
    password: "Str0ngPassw0rd",
    location: "Brooklyn",
  });

  it("rejects a missing field with a 400 rather than throwing", async () => {
    const res = await request.execute(app).post("/auth/register").send({});

    expect(res).to.have.status(400);
    expect(res.body.message).to.be.a("string").and.not.be.empty;
  });

  for (const [label, patch] of [
    ["a password with no uppercase letter", { password: "str0ngpassword" }],
    ["a password with no digit", { password: "StrongPassword" }],
    ["a password that is too short", { password: "Sh0rt" }],
    ["an invalid email address", { email: "not-an-email" }],
    ["a username that is too short", { username: "ab" }],
    ["a missing city", { location: "" }],
  ]) {
    it(`rejects ${label}`, async () => {
      const res = await request
        .execute(app)
        .post("/auth/register")
        .send({ ...validBody(), ...patch });

      expect(res).to.have.status(400);
      expect(res.body.message).to.be.a("string").and.not.be.empty;
    });
  }

  it("accepts a valid signup and normalizes the email", async () => {
    const res = await request.execute(app).post("/auth/register").send(validBody());

    expect(res).to.have.status(201);

    const stored = await User.findOne({ email: "new.reader@example.com" });
    expect(stored).to.exist;
    expect(stored.email).to.equal("new.reader@example.com");
  });

  it("persists the city from the signup form", async () => {
    await request.execute(app).post("/auth/register").send(validBody());

    const stored = await User.findOne({ email: "new.reader@example.com" });
    expect(stored.location).to.equal("Brooklyn");
  });

  it("round-trips the city through login and GET /user", async () => {
    await request.execute(app).post("/auth/register").send(validBody());

    const login = await request
      .execute(app)
      .post("/auth/login")
      .send({ email: "new.reader@example.com", password: "Str0ngPassw0rd" });

    expect(login).to.have.status(200);

    const me = await request
      .execute(app)
      .get("/user")
      .set("Authorization", `Bearer ${login.body.token}`);

    expect(me).to.have.status(200);
    expect(me.body.location).to.equal("Brooklyn");
  });

  it("treats a differently cased email as the same account", async () => {
    await request.execute(app).post("/auth/register").send(validBody());

    const duplicate = await request
      .execute(app)
      .post("/auth/register")
      .send({ ...validBody(), email: "new.reader@example.com", username: "someoneelse" });

    expect(duplicate).to.have.status(400);
    expect(duplicate.body.message).to.equal("User already exists");
  });

  it("lets a user sign in with a different email casing", async () => {
    await request.execute(app).post("/auth/register").send(validBody());

    const login = await request
      .execute(app)
      .post("/auth/login")
      .send({ email: "  NEW.READER@example.com  ", password: "Str0ngPassw0rd" });

    expect(login).to.have.status(200);
    expect(login.body).to.have.property("token");
  });
});

// ---------------------------------------------------------------------------
// The error handler must not leak internals
// ---------------------------------------------------------------------------
describe("error responses", () => {
  beforeEach(resetState);

  it("does not return err.message or a stack trace on an unexpected failure", async () => {
    const original = User.findOne;
    User.findOne = () => {
      throw new Error("mongodb+srv://user:hunter2@cluster.example.net exploded");
    };

    try {
      const res = await request.execute(app).post("/auth/register").send({
        username: "newreader",
        email: "new.reader@example.com",
        password: "Str0ngPassw0rd",
        location: "Brooklyn",
      });

      expect(res).to.have.status(500);
      expect(res.body).to.deep.equal({ message: "Internal server error" });
      const payload = JSON.stringify(res.body);
      expect(payload).to.not.include("hunter2");
      expect(payload).to.not.include("at ");
    } finally {
      User.findOne = original;
    }
  });

  it("answers an unknown route with JSON rather than an HTML stack page", async () => {
    const res = await request.execute(app).get("/no-such-route");

    expect(res).to.have.status(404);
    expect(res).to.be.json;
    expect(res.body).to.deep.equal({ message: "Not found" });
  });
});

// ---------------------------------------------------------------------------
// POST /auth/login - rate limiting and lockout
// ---------------------------------------------------------------------------
describe("POST /auth/login rate limiting", () => {
  beforeEach(resetState);

  const badLogin = (email) =>
    request.execute(app).post("/auth/login").send({ email, password: "WrongPassw0rd" });

  it("locks an account out after repeated failures", async () => {
    const user = await createUser();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await badLogin(user.email);
      expect(res, `attempt ${attempt + 1}`).to.have.status(400);
    }

    const locked = await badLogin(user.email);
    expect(locked).to.have.status(429);
    expect(locked.body.message).to.equal(
      "Too many failed login attempts. Please try again later."
    );
    expect(locked).to.have.header("retry-after");
  });

  it("rejects the correct password while the account is locked out", async () => {
    const user = await createUser();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await badLogin(user.email);
    }

    const res = await request
      .execute(app)
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(res).to.have.status(429);
  });

  it("responds identically for an account that does not exist", async () => {
    const user = await createUser();
    const unknown = "nobody@example.com";

    const existing = [];
    const missing = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      existing.push(await badLogin(user.email));
      missing.push(await badLogin(unknown));
    }

    expect(missing.map((r) => r.status)).to.deep.equal(existing.map((r) => r.status));
    expect(missing.map((r) => r.body.message)).to.deep.equal(
      existing.map((r) => r.body.message)
    );
    expect(missing[5]).to.have.status(429);
  });

  it("does not lock out a different account", async () => {
    const victim = await createUser();
    const bystander = await createUser();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await badLogin(victim.email);
    }

    const res = await request
      .execute(app)
      .post("/auth/login")
      .send({ email: bystander.email, password: TEST_PASSWORD });

    expect(res).to.have.status(200);
    expect(res.body).to.have.property("token");
  });

  it("clears the account's failure count after a successful sign-in", async () => {
    const user = await createUser();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await badLogin(user.email);
    }

    const ok = await request
      .execute(app)
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    expect(ok).to.have.status(200);

    // The counter reset, so a single later failure must not trip the lockout.
    const res = await badLogin(user.email);
    expect(res).to.have.status(400);
  });

  it("does not reveal which field was wrong on a malformed login", async () => {
    const res = await request.execute(app).post("/auth/login").send({});

    expect(res).to.have.status(400);
    expect(res.body).to.deep.equal({ message: "Invalid credentials" });
  });
});
