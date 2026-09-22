import { expect } from "chai";
import { hashToken } from "../lib/authTokens.js";
import { Session, SESSION_LIFETIME_MS, TOUCH_INTERVAL_MS } from "../lib/sessions.js";
import { api, emailedToken, signUp, TEST_PASSWORD } from "./helpers.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const me = (token) => api(token).get("/user");
const sessionFor = (token) => Session.findById(hashToken(token)).lean();

// Moves a session's clock back, as if it had last been used `ms` ago.
const ageSession = async (token, ms) => {
  const session = await sessionFor(token);
  await Session.updateOne(
    { _id: session._id },
    {
      $set: {
        lastUsedAt: new Date(session.lastUsedAt.getTime() - ms),
        expiresAt: new Date(session.expiresAt.getTime() - ms),
      },
    }
  );
};

describe("sign-in sessions", () => {
  it("signing in creates a session that stores only a hash of the token", async () => {
    const user = await signUp();

    const session = await sessionFor(user.token);

    expect(session).to.not.equal(null);
    expect(String(session.user)).to.equal(user.id);
    expect(session.createdAt).to.be.a("date");
    expect(session.lastUsedAt).to.be.a("date");
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).to.equal(SESSION_LIFETIME_MS);
    expect(await Session.exists({ _id: user.token })).to.equal(null);
  });

  it("each sign-in is its own session", async () => {
    const user = await signUp();
    const again = await api()
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(again.body.token).to.not.equal(user.token);
    expect(await Session.countDocuments({ user: user.id })).to.equal(2);
  });

  it("a live session authenticates requests", async () => {
    const user = await signUp();

    const res = await me(user.token);

    expect(res).to.have.status(200);
    expect(res.body.username).to.equal(user.username);
  });

  it("use slides the expiry forward to 30 days from now", async () => {
    const user = await signUp();
    await ageSession(user.token, 10 * DAY);
    const before = await sessionFor(user.token);

    expect(await me(user.token)).to.have.status(200);

    const after = await sessionFor(user.token);
    expect(after.expiresAt.getTime()).to.be.greaterThan(before.expiresAt.getTime());
    expect(after.expiresAt.getTime()).to.be.closeTo(Date.now() + SESSION_LIFETIME_MS, 60 * 1000);
    expect(after.lastUsedAt.getTime()).to.be.closeTo(Date.now(), 60 * 1000);
  });

  it("does not write the session again within the touch interval", async () => {
    const user = await signUp();
    await ageSession(user.token, TOUCH_INTERVAL_MS / 2);
    const before = await sessionFor(user.token);

    expect(await me(user.token)).to.have.status(200);

    expect(await sessionFor(user.token)).to.deep.equal(before);
  });

  it("refuses an expired session", async () => {
    const user = await signUp();
    await ageSession(user.token, SESSION_LIFETIME_MS + HOUR);

    expect(await me(user.token)).to.have.status(401);
  });

  it("refuses a made-up token", async () => {
    expect(await me("not-a-session")).to.have.status(401);
  });

  it("clears expired sessions with a TTL index on the expiry", async () => {
    await Session.init();
    const indexes = await Session.collection.indexes();

    const ttl = indexes.find((index) => index.key.expiresAt === 1);
    expect(ttl?.expireAfterSeconds).to.equal(0);
  });
});

describe("POST /logout", () => {
  it("ends this session only", async () => {
    const user = await signUp();
    const other = await api()
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(await api(user.token).post("/logout")).to.have.status(200);

    expect(await me(user.token)).to.have.status(401);
    expect(await sessionFor(user.token)).to.equal(null);
    expect(await me(other.body.token)).to.have.status(200);
  });

  it("answers 200 without a live token", async () => {
    expect(await api().post("/logout")).to.have.status(200);
    expect(await api("not-a-session").post("/logout")).to.have.status(200);
  });
});

describe("password reset and sessions", () => {
  it("ends every session of the account and leaves other accounts signed in", async () => {
    const user = await signUp();
    const second = await api()
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD });
    const bystander = await signUp();

    await api().post("/auth/forgot-password").send({ email: user.email });
    const res = await api()
      .post("/auth/reset-password")
      .send({ token: emailedToken(user.email, "/reset-password"), password: "N3wPassw0rdToo" });
    expect(res).to.have.status(200);

    expect(await me(user.token)).to.have.status(401);
    expect(await me(second.body.token)).to.have.status(401);
    expect(await Session.countDocuments({ user: user.id })).to.equal(0);
    expect(await me(bystander.token)).to.have.status(200);
  });
});
