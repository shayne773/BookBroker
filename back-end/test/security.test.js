import { expect, use } from "chai";
import { default as chaiHttp, request } from "chai-http";
import mongoose from "mongoose";

import app from "../app.js";
import { resolveAllowedOrigins } from "../lib/cors.js";
import {
  DEFAULT_OPTIONS,
  LoginAttempt,
  LoginThrottle,
  throttleKey,
} from "../lib/loginThrottle.js";
import { User } from "../Data.js";
import {
  authHeader,
  clearDatabase,
  confirmEmail,
  createOfferedBook,
  createUser,
  TEST_PASSWORD,
} from "./helpers.js";

use(chaiHttp);

const ALLOWED_ORIGIN = "http://localhost:3000";
const DISALLOWED_ORIGIN = "https://evil.example.com";

// Scoped to each describe rather than declared at the root: a root-level hook
// in one spec file also runs for every other spec file. Login throttle counters
// are stored in Mongo, so clearing the database resets them too.
async function resetState() {
  await clearDatabase();
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
      .set(await authHeader(viewer));

    expect(res).to.have.status(200);
    expect(res.body).to.include({
      username: user.username,
      location: "Queens",
      ratingsAvg: 0,
      ratingsCount: 0,
      blockedByMe: false,
    });
    expect(res.body).to.not.have.property("ratings");
    expect(res.body).to.not.have.property("password");
    expect(res.body).to.not.have.property("email");
    expect(JSON.stringify(res.body)).to.not.include(user.email);
    expect(JSON.stringify(res.body)).to.not.include("$2");
  });

  it("rejects an id that is not an ObjectId", async () => {
    const viewer = await createUser();

    const res = await request.execute(app).get("/users/1").set(await authHeader(viewer));

    expect(res).to.have.status(400);
  });

  it("returns 404 for an unknown user", async () => {
    const viewer = await createUser();
    const missing = new mongoose.Types.ObjectId();

    const res = await request.execute(app).get(`/users/${missing}`).set(await authHeader(viewer));

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

  it("still matches a genre by a substring", async () => {
    const owner = await createUser();
    await createOfferedBook(owner, { genre: "Adventure" });
    await createOfferedBook(owner, { genre: "Romance" });

    const res = await request.execute(app).get("/genres/Adven");

    expect(res).to.have.status(200);
    expect(res.body).to.have.lengthOf(1);
    expect(res.body[0].genre).to.equal("Adventure");
  });

  it("treats a search query with regex metacharacters as a literal", async () => {
    const owner = await createUser();
    const viewer = await createUser();
    await createOfferedBook(owner, { title: "The Hobbit" });

    const res = await request
      .execute(app)
      .get("/browse")
      .query({ q: ".*" })
      .set(await authHeader(viewer));

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
      .set(await authHeader(viewer));

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
      .set(await authHeader(viewer));

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

  it("allows no cross-origin caller in production when unconfigured", () => {
    expect(resolveAllowedOrigins({ NODE_ENV: "production" })).to.deep.equal([]);
  });

  it("falls back to the development origin outside production", () => {
    expect(resolveAllowedOrigins({ NODE_ENV: "development" })).to.deep.equal([
      ALLOWED_ORIGIN,
    ]);
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

  it("accepts a username with a space and a non-ASCII letter", async () => {
    const res = await request
      .execute(app)
      .post("/auth/register")
      .send({ ...validBody(), username: "Jane Sm\u00edth" });

    expect(res).to.have.status(201);

    const stored = await User.findOne({ email: "new.reader@example.com" });
    expect(stored.username).to.equal("Jane Sm\u00edth");
  });

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
    await confirmEmail("new.reader@example.com");

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
    await confirmEmail("new.reader@example.com");

    const login = await request
      .execute(app)
      .post("/auth/login")
      .send({ email: "  NEW.READER@example.com  ", password: "Str0ngPassw0rd" });

    expect(login).to.have.status(200);
    expect(login.body).to.have.property("token");
  });
});

// ---------------------------------------------------------------------------
// Accounts stored before emails were normalized keep a mixed-case address
// ---------------------------------------------------------------------------
describe("accounts with a mixed-case stored email", () => {
  beforeEach(resetState);

  it("lets a legacy account sign in", async () => {
    const legacy = await createUser({ email: "Legacy.Reader@Example.COM" });

    const res = await request
      .execute(app)
      .post("/auth/login")
      .send({ email: "legacy.reader@example.com", password: TEST_PASSWORD });

    expect(res).to.have.status(200);
    expect(res.body).to.have.property("token");
    expect(res.body.user.id).to.equal(legacy._id.toString());
  });

  it("does not rewrite the stored address on sign-in", async () => {
    await createUser({ email: "Legacy.Reader@Example.COM" });

    await request
      .execute(app)
      .post("/auth/login")
      .send({ email: "legacy.reader@example.com", password: TEST_PASSWORD });

    const stored = await User.findOne({ email: "Legacy.Reader@Example.COM" });
    expect(stored).to.exist;
  });

  it("refuses a signup that would duplicate a legacy account", async () => {
    await createUser({ email: "Legacy.Reader@Example.COM" });

    const res = await request.execute(app).post("/auth/register").send({
      username: "newreader",
      email: "legacy.reader@example.com",
      password: "Str0ngPassw0rd",
      location: "Brooklyn",
    });

    expect(res).to.have.status(400);
    expect(res.body.message).to.equal("User already exists");
    expect(await User.countDocuments({})).to.equal(1);
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

// ---------------------------------------------------------------------------
// Owner documents joined for filtering must not reach the client
// ---------------------------------------------------------------------------
describe("owner lookups in the recommendation pipelines", () => {
  beforeEach(resetState);

  // Both routes $lookup the owner purely to filter on their city. The joined
  // document must not survive into the response.
  const recommendationCases = [
    {
      label: "GET /browse",
      path: "/browse",
      pick: (body) => body.recommended,
    },
    {
      label: "GET /user/get-recommended-books",
      path: "/user/get-recommended-books",
      pick: (body) => body,
    },
  ];

  for (const { label, path, pick } of recommendationCases) {
    it(`${label} does not return the owner's password hash or email`, async () => {
      const viewer = await createUser({ location: "Brooklyn" });
      const owner = await createUser({ location: "Brooklyn" });
      await createOfferedBook(owner);

      const res = await request.execute(app).get(path).set(await authHeader(viewer));

      expect(res).to.have.status(200);

      const books = pick(res.body);
      expect(books, "the neighbour's book is recommended").to.have.lengthOf(1);
      expect(books[0]).to.not.have.property("ownerDetails");
      expect(JSON.stringify(res.body)).to.not.include(owner.password);
      expect(JSON.stringify(res.body)).to.not.include(owner.email);
    });
  }
});

// ---------------------------------------------------------------------------
// POST /user/edit - the write path returns public fields only
// ---------------------------------------------------------------------------
describe("POST /user/edit", () => {
  beforeEach(resetState);

  it("does not echo the caller's password hash", async () => {
    const user = await createUser();

    const res = await request
      .execute(app)
      .post("/user/edit")
      .set(await authHeader(user))
      .send({ user: { username: "renamed" } });

    expect(res).to.have.status(200);
    expect(res.body.user.username).to.equal("renamed");
    expect(res.body.user).to.not.have.property("password");
    expect(JSON.stringify(res.body)).to.not.include(user.password);
  });
});

// ---------------------------------------------------------------------------
// POST /user/edit - an address change cannot strand another account
// ---------------------------------------------------------------------------
describe("POST /user/edit email changes", () => {
  beforeEach(resetState);

  it("refuses an address a legacy mixed-case account already holds", async () => {
    const legacy = await createUser({ email: "Bob@X.com" });
    const attacker = await createUser();

    const res = await request
      .execute(app)
      .post("/user/edit")
      .set(await authHeader(attacker))
      .send({ user: { email: "bob@x.com" } });

    expect(res.status, "the edit is rejected").to.be.within(400, 499);

    const stillMine = await User.findById(attacker._id).select("email");
    expect(stillMine.email).to.equal(attacker.email);

    // The legacy owner can still sign in with the address they registered.
    const signIn = await request
      .execute(app)
      .post("/auth/login")
      .send({ email: "Bob@X.com", password: TEST_PASSWORD });

    expect(signIn).to.have.status(200);
    expect(signIn.body).to.have.property("token");
    expect(signIn.body.user.id).to.equal(legacy._id.toString());
  });

  it("rejects an address that is not a valid email", async () => {
    const user = await createUser();

    const res = await request
      .execute(app)
      .post("/user/edit")
      .set(await authHeader(user))
      .send({ user: { email: "not-an-address" } });

    expect(res).to.have.status(400);

    const unchanged = await User.findById(user._id).select("email");
    expect(unchanged.email).to.equal(user.email);
  });

  it("holds a changed address normalized, pending confirmation", async () => {
    const user = await createUser();

    const res = await request
      .execute(app)
      .post("/user/edit")
      .set(await authHeader(user))
      .send({ user: { email: "  Renamed@Example.COM " } });

    expect(res).to.have.status(200);

    const updated = await User.findById(user._id).select("email pendingEmail");
    expect(updated.pendingEmail).to.equal("renamed@example.com");
    expect(updated.email).to.equal(user.email);
  });

  it("still allows an edit that leaves the address alone", async () => {
    const user = await createUser();

    const res = await request
      .execute(app)
      .post("/user/edit")
      .set(await authHeader(user))
      .send({ user: { username: "renamed", location: "Queens" } });

    expect(res).to.have.status(200);

    const updated = await User.findById(user._id).select("username location email");
    expect(updated.username).to.equal("renamed");
    expect(updated.location).to.equal("Queens");
    expect(updated.email).to.equal(user.email);
  });
});

// ---------------------------------------------------------------------------
// LoginThrottle - one Mongo document per address
// ---------------------------------------------------------------------------
describe("LoginThrottle", () => {
  beforeEach(resetState);

  const failTimes = async (throttle, address, times, now) => {
    for (let i = 0; i < times; i += 1) {
      await throttle.recordFailure(address, now);
    }
  };

  it("locks only the address that failed", async () => {
    const throttle = new LoginThrottle();
    const now = Date.now();

    await failTimes(throttle, "victim@example.com", DEFAULT_OPTIONS.accountMaxAttempts, now);

    expect((await throttle.check("victim@example.com", now)).limited).to.equal(true);
    expect((await throttle.check("bystander@example.com", now)).limited).to.equal(false);
  });

  it("keeps a locked account locked while many other addresses fail", async () => {
    const throttle = new LoginThrottle();
    const now = Date.now();
    const victim = "victim@example.com";

    await failTimes(throttle, victim, DEFAULT_OPTIONS.accountMaxAttempts, now);
    for (let i = 0; i < 50; i += 1) {
      await failTimes(throttle, `spray-${i}@example.com`, DEFAULT_OPTIONS.accountMaxAttempts, now);
    }

    expect((await throttle.check(victim, now)).limited).to.equal(true);
  });

  it("does not let failures on other addresses lock an address", async () => {
    const throttle = new LoginThrottle();
    const now = Date.now();

    for (let i = 0; i < 50; i += 1) {
      await failTimes(throttle, `spray-${i}@example.com`, DEFAULT_OPTIONS.accountMaxAttempts, now);
    }

    expect((await throttle.check("victim@example.com", now)).limited).to.equal(false);
  });

  it("does not let one address clear another address's failures", async () => {
    const throttle = new LoginThrottle();
    const now = Date.now();
    const victim = "victim@example.com";

    await failTimes(throttle, victim, DEFAULT_OPTIONS.accountMaxAttempts - 1, now);
    await throttle.recordFailure("other@example.com", now);
    await throttle.recordSuccess("other@example.com");
    await throttle.recordFailure(victim, now);

    expect((await throttle.check(victim, now)).limited).to.equal(true);
  });

  it("clears an address's failures on success", async () => {
    const throttle = new LoginThrottle();
    const now = Date.now();
    const address = "reader@example.com";

    await failTimes(throttle, address, DEFAULT_OPTIONS.accountMaxAttempts - 1, now);
    await throttle.recordSuccess(address);
    await throttle.recordFailure(address, now);

    expect((await throttle.check(address, now)).limited).to.equal(false);
  });

  it("counts every one of a burst of concurrent failures", async () => {
    const throttle = new LoginThrottle();
    const now = Date.now();
    const address = "burst@example.com";

    await Promise.all(
      Array.from({ length: DEFAULT_OPTIONS.accountMaxAttempts }, () =>
        throttle.recordFailure(address, now)
      )
    );

    expect((await throttle.check(address, now)).limited).to.equal(true);
  });

  it("treats differently cased addresses as the same key", async () => {
    const throttle = new LoginThrottle();
    const now = Date.now();

    await failTimes(throttle, "Reader@Example.com", DEFAULT_OPTIONS.accountMaxAttempts, now);

    expect((await throttle.check("reader@example.com", now)).limited).to.equal(true);
  });

  it("starts a fresh window once the old one has passed", async () => {
    const throttle = new LoginThrottle();
    const start = Date.now();
    const address = "slow@example.com";

    await failTimes(throttle, address, DEFAULT_OPTIONS.accountMaxAttempts - 1, start);
    const later = start + DEFAULT_OPTIONS.windowMs;
    await throttle.recordFailure(address, later);

    expect((await throttle.check(address, later)).limited).to.equal(false);
  });

  it("lifts the lockout once it has run its course", async () => {
    const throttle = new LoginThrottle();
    const now = Date.now();
    const address = "locked@example.com";

    await failTimes(throttle, address, DEFAULT_OPTIONS.accountMaxAttempts, now);
    const locked = await throttle.check(address, now);
    expect(locked.retryAfterSeconds).to.equal(DEFAULT_OPTIONS.lockoutMs / 1000);

    const after = now + DEFAULT_OPTIONS.lockoutMs;
    expect((await throttle.check(address, after)).limited).to.equal(false);
  });

  it("sets each document to expire once its window and lockout have passed", async () => {
    const throttle = new LoginThrottle();
    const now = Date.now();

    await throttle.recordFailure("once@example.com", now);
    await failTimes(throttle, "locked@example.com", DEFAULT_OPTIONS.accountMaxAttempts, now);

    const once = await LoginAttempt.findById(throttleKey("once@example.com")).lean();
    const locked = await LoginAttempt.findById(throttleKey("locked@example.com")).lean();
    expect(once.expiresAt.getTime()).to.equal(now + DEFAULT_OPTIONS.windowMs);
    expect(locked.expiresAt.getTime()).to.equal(now + DEFAULT_OPTIONS.lockoutMs);

    await LoginAttempt.init();
    const indexes = await LoginAttempt.collection.indexes();
    expect(indexes.find((index) => index.key.expiresAt === 1)).to.include({
      expireAfterSeconds: 0,
    });
  });

  it("stores a fixed-size digest rather than the address itself", async () => {
    const throttle = new LoginThrottle();
    const address = "Reader@Example.com";

    await throttle.recordFailure(address);

    const [attempt] = await LoginAttempt.find().lean();
    expect(attempt._id).to.match(/^[0-9a-f]{64}$/);
    expect(attempt._id).to.not.include("reader");
  });

  it("rejects an oversized login email before recording anything", async () => {
    const res = await request
      .execute(app)
      .post("/auth/login")
      .send({ email: `${"a".repeat(250)}@example.com`, password: "WrongPassw0rd" });

    expect(res).to.have.status(400);
    expect(res.body).to.deep.equal({ message: "Invalid credentials" });
    expect(await LoginAttempt.countDocuments()).to.equal(0);
  });

  it("fails the login rather than skipping the throttle when the store is down", async () => {
    const user = await createUser();
    const original = LoginAttempt.findById;
    LoginAttempt.findById = () => {
      throw new Error("store unavailable");
    };

    try {
      const res = await request
        .execute(app)
        .post("/auth/login")
        .send({ email: user.email, password: TEST_PASSWORD });

      expect(res).to.have.status(500);
      expect(res.body).to.not.have.property("token");
    } finally {
      LoginAttempt.findById = original;
    }
  });
});
