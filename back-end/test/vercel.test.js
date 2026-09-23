import { expect, use } from "chai";
import { default as chaiHttp, request } from "chai-http";
import mongoose from "mongoose";

import { runInBackground } from "../lib/background.js";
import { connectDatabase, DB_NAME } from "../lib/db.js";
import { createVercelHandler } from "../vercel.js";
import { authHeader, createUser } from "./helpers.js";

use(chaiHttp);

// ---------------------------------------------------------------------------
// The Vercel function: the API under /api on the site's own origin
// ---------------------------------------------------------------------------
describe("Vercel function", () => {
  // The root hook has already connected Mongoose to the in-process database.
  let connects;
  const handler = createVercelHandler({
    connect: async () => {
      connects += 1;
    },
  });

  beforeEach(() => {
    connects = 0;
  });

  it("serves the API's routes under /api", async () => {
    const res = await request.execute(handler).get("/api/genres");

    expect(res).to.have.status(200);
    expect(res.body).to.be.an("array");
    expect(connects).to.equal(1);
  });

  it("serves signed-in routes under /api", async () => {
    const user = await createUser();

    const res = await request
      .execute(handler)
      .get("/api/user")
      .query({ id: String(user._id) })
      .set(await authHeader(user));

    expect(res).to.have.status(200);
  });

  it("serves nothing outside /api", async () => {
    const res = await request.execute(handler).get("/genres");

    expect(res).to.have.status(404);
    expect(connects).to.equal(0);
  });

  // The deployed site is its own origin, which CORS_ALLOWED_ORIGINS need not list.
  it("lets a request from an unlisted origin reach its route", async () => {
    const res = await request
      .execute(handler)
      .post("/api/auth/login")
      .set("Origin", "https://bookbroker.vercel.example")
      .send({ email: "nobody@example.com", password: "Wr0ngPassword" });

    expect(res).to.have.status(400);
    expect(res.body).to.deep.equal({ message: "Invalid credentials" });
    expect(res.headers).to.not.have.property("access-control-allow-origin");
  });

  it("answers 503 without detail when the database cannot be reached", async () => {
    const failing = createVercelHandler({
      connect: async () => {
        throw new Error("querySrv ENOTFOUND _mongodb._tcp.cluster.example");
      },
    });

    const res = await request.execute(failing).get("/api/genres");

    expect(res).to.have.status(503);
    expect(res.body).to.deep.equal({ message: "Service temporarily unavailable" });
  });
});

describe("connectDatabase", () => {
  let realConnect;
  let calls;

  beforeEach(() => {
    realConnect = mongoose.connect;
    calls = [];
  });

  afterEach(() => {
    mongoose.connect = realConnect;
  });

  it("refuses to connect without a connection string", async () => {
    let failure;
    await connectDatabase("").catch((err) => {
      failure = err;
    });

    expect(failure?.message).to.match(/MONGODB_URI/);
  });

  it("opens one connection for every caller and retries after a failure", async () => {
    mongoose.connect = async (uri, options) => {
      calls.push({ uri, options });
      if (calls.length === 1) throw new Error("connection refused");
      return mongoose;
    };

    let failure;
    await connectDatabase("mongodb://db.example").catch((err) => {
      failure = err;
    });
    expect(failure?.message).to.equal("connection refused");

    const [first, second] = await Promise.all([
      connectDatabase("mongodb://db.example"),
      connectDatabase("mongodb://db.example"),
    ]);
    await connectDatabase("mongodb://db.example");

    expect(first).to.equal(second);
    expect(calls).to.have.lengthOf(2);
    expect(calls[1]).to.deep.equal({ uri: "mongodb://db.example", options: { dbName: DB_NAME } });
  });
});

describe("runInBackground", () => {
  // Where Vercel's runtime publishes the invocation's waitUntil.
  const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
  let realConsoleError;
  let logged;

  beforeEach(() => {
    realConsoleError = console.error;
    logged = [];
    console.error = (...args) => logged.push(args);
  });

  afterEach(() => {
    console.error = realConsoleError;
    delete globalThis[REQUEST_CONTEXT];
  });

  it("keeps a Vercel invocation alive until the work settles", async () => {
    const kept = [];
    globalThis[REQUEST_CONTEXT] = { get: () => ({ waitUntil: (p) => kept.push(p) }) };

    let finish;
    runInBackground(new Promise((resolve) => (finish = resolve)), "send mail");

    expect(kept).to.have.lengthOf(1);
    finish();
    await kept[0];
  });

  it("logs a failure instead of rejecting, with or without Vercel", async () => {
    runInBackground(Promise.reject(new Error("Resend is down")), "send mail");
    await new Promise((resolve) => setImmediate(resolve));

    expect(logged).to.have.lengthOf(1);
    expect(logged[0][0]).to.equal("Failed to send mail:");
    expect(logged[0][1].message).to.equal("Resend is down");
  });
});
