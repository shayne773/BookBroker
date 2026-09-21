import { expect } from "chai";
import { AuthToken, hashToken } from "../lib/authTokens.js";
import { renderEmail, resolveFrontEndBaseUrl } from "../lib/mail.js";
import { User } from "../Data.js";
import {
  api,
  clearDatabase,
  createUser,
  emailedToken,
  outbox,
  TEST_PASSWORD,
} from "./helpers.js";
import { unmockedDeliver } from "./setup.js";

const EMAIL = "new.reader@example.com";
const NEW_PASSWORD = "N3wPassw0rdToo";

const register = (overrides = {}) =>
  api()
    .post("/auth/register")
    .send({
      username: "newreader",
      email: EMAIL,
      password: TEST_PASSWORD,
      location: "Brooklyn",
      ...overrides,
    });

const login = (email = EMAIL, password = TEST_PASSWORD) =>
  api().post("/auth/login").send({ email, password });

const confirm = (token) => api().post("/auth/confirm-email").send({ token });
const resend = (email) => api().post("/auth/resend-confirmation").send({ email });
const forgot = (email) => api().post("/auth/forgot-password").send({ email });
const reset = (token, password = NEW_PASSWORD) =>
  api().post("/auth/reset-password").send({ token, password });

// Moves every stored token's expiry into the past, as if its lifetime had run out.
const expireAllTokens = () =>
  AuthToken.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

describe("email confirmation", () => {
  beforeEach(clearDatabase);

  it("creates the account unconfirmed and emails a confirmation link", async () => {
    const res = await register();

    expect(res).to.have.status(201);
    const stored = await User.findOne({ email: EMAIL });
    expect(stored.emailVerified).to.equal(false);

    expect(outbox).to.have.length(1);
    expect(outbox[0].to).to.equal(EMAIL);
    expect(outbox[0].link).to.match(/^http:\/\/localhost:3000\/confirm-email\?token=/);
  });

  it("builds the link from the configured front end, not the request's Host", async () => {
    await api().post("/auth/register").set("Host", "evil.example.com").send({
      username: "newreader",
      email: EMAIL,
      password: TEST_PASSWORD,
      location: "Brooklyn",
    });

    expect(outbox[0].link).to.not.include("evil.example.com");
  });

  it("stores only a hash of the token", async () => {
    await register();
    const token = emailedToken(EMAIL);

    const [stored] = await AuthToken.find().lean();
    expect(stored._id).to.equal(hashToken(token));
    expect(JSON.stringify(stored)).to.not.include(token);
  });

  it("refuses to sign in an unconfirmed account and says why", async () => {
    await register();

    const res = await login();

    expect(res).to.have.status(403);
    expect(res.body.code).to.equal("EMAIL_NOT_CONFIRMED");
    expect(res.body.message).to.match(/confirm your email/i);
    expect(res.body).to.not.have.property("token");
  });

  it("does not reveal an unconfirmed account to a wrong password", async () => {
    await register();

    const res = await login(EMAIL, "WrongPassw0rd");

    expect(res).to.have.status(400);
    expect(res.body).to.deep.equal({ message: "Invalid credentials" });
  });

  it("signs in normally once the link is used", async () => {
    await register();

    const confirmed = await confirm(emailedToken(EMAIL));
    expect(confirmed).to.have.status(200);

    const res = await login();
    expect(res).to.have.status(200);
    expect(res.body).to.have.property("token");
  });

  it("accepts a confirmation link only once", async () => {
    await register();
    const token = emailedToken(EMAIL);

    expect(await confirm(token)).to.have.status(200);

    const again = await confirm(token);
    expect(again).to.have.status(400);
    expect(again.body.code).to.equal("TOKEN_INVALID");
  });

  it("refuses an expired confirmation link", async () => {
    await register();
    await expireAllTokens();

    const res = await confirm(emailedToken(EMAIL));

    expect(res).to.have.status(400);
    expect(res.body.code).to.equal("TOKEN_INVALID");
    expect((await User.findOne({ email: EMAIL })).emailVerified).to.equal(false);
  });

  it("refuses a made-up or missing token", async () => {
    expect(await confirm("not-a-real-token")).to.have.status(400);
    expect(await api().post("/auth/confirm-email").send({})).to.have.status(400);
    expect(await confirm({ $ne: null })).to.have.status(400);
  });

  it("does not accept a password reset token as a confirmation", async () => {
    await register();
    await forgot(EMAIL);

    const res = await confirm(emailedToken(EMAIL, "/reset-password"));

    expect(res).to.have.status(400);
    expect((await User.findOne({ email: EMAIL })).emailVerified).to.equal(false);
  });
});

describe("accounts from before email confirmation", () => {
  beforeEach(clearDatabase);

  it("count as confirmed and sign in without a database change", async () => {
    const user = await createUser();
    // Written as an account created before the flag existed.
    await User.collection.updateOne({ _id: user._id }, { $unset: { emailVerified: "" } });
    const raw = await User.collection.findOne({ _id: user._id });
    expect(raw).to.not.have.property("emailVerified");

    expect((await User.findById(user._id)).emailVerified).to.equal(true);

    const res = await login(user.email);
    expect(res).to.have.status(200);
    expect(res.body).to.have.property("token");
  });
});

describe("POST /auth/resend-confirmation", () => {
  beforeEach(clearDatabase);

  it("sends a fresh link and retires the old one", async () => {
    await register();
    const first = emailedToken(EMAIL);

    const res = await resend(EMAIL);
    expect(res).to.have.status(200);
    const second = emailedToken(EMAIL);
    expect(second).to.not.equal(first);

    expect(await confirm(first)).to.have.status(400);
    expect(await confirm(second)).to.have.status(200);
  });

  it("finds the account whatever the casing of the address", async () => {
    await register();

    await resend("  New.Reader@EXAMPLE.com ");

    expect(outbox).to.have.length(2);
  });

  it("answers the same for an unknown or already confirmed address and sends nothing", async () => {
    await register();
    const pending = await resend(EMAIL);

    const confirmedUser = await createUser();
    const sentBefore = outbox.length;
    const confirmed = await resend(confirmedUser.email);
    const unknown = await resend("nobody@example.com");

    expect(outbox).to.have.length(sentBefore);
    for (const res of [confirmed, unknown]) {
      expect(res.status).to.equal(pending.status);
      expect(res.body).to.deep.equal(pending.body);
    }
  });

  it("limits requests for one address", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(await resend("nobody@example.com")).to.have.status(200);
    }

    const limited = await resend("nobody@example.com");
    expect(limited).to.have.status(429);
    expect(limited).to.have.header("retry-after");
    expect(await resend("somebody@example.com")).to.have.status(200);
  });

  it("limits requests from one client across addresses", async () => {
    for (let i = 0; i < 10; i += 1) {
      expect(await resend(`reader${i}@example.com`)).to.have.status(200);
    }

    expect(await resend("one-more@example.com")).to.have.status(429);
  });

  it("rejects an address that is not an email", async () => {
    expect(await resend("not-an-email")).to.have.status(400);
  });
});

describe("password reset", () => {
  beforeEach(clearDatabase);

  it("answers identically for known and unknown addresses", async () => {
    const user = await createUser();

    const known = await forgot(user.email);
    const unknown = await forgot("nobody@example.com");

    expect(known.status).to.equal(200);
    expect(unknown.status).to.equal(known.status);
    expect(unknown.body).to.deep.equal(known.body);

    expect(outbox).to.have.length(1);
    expect(outbox[0].to).to.equal(user.email);
    expect(outbox[0].link).to.match(/^http:\/\/localhost:3000\/reset-password\?token=/);
  });

  it("sets a new password that works, and the old one stops working", async () => {
    const user = await createUser();
    await forgot(user.email);

    const res = await reset(emailedToken(user.email, "/reset-password"));
    expect(res).to.have.status(200);

    expect(await login(user.email, NEW_PASSWORD)).to.have.status(200);
    expect(await login(user.email, TEST_PASSWORD)).to.have.status(400);
  });

  it("accepts a reset link only once", async () => {
    const user = await createUser();
    await forgot(user.email);
    const token = emailedToken(user.email, "/reset-password");

    expect(await reset(token)).to.have.status(200);

    const again = await reset(token, "An0therPassw0rd");
    expect(again).to.have.status(400);
    expect(again.body.code).to.equal("TOKEN_INVALID");
    expect(await login(user.email, NEW_PASSWORD)).to.have.status(200);
  });

  it("refuses an expired reset link", async () => {
    const user = await createUser();
    await forgot(user.email);
    await expireAllTokens();

    const res = await reset(emailedToken(user.email, "/reset-password"));

    expect(res).to.have.status(400);
    expect(res.body.code).to.equal("TOKEN_INVALID");
    expect(await login(user.email, TEST_PASSWORD)).to.have.status(200);
  });

  it("enforces the sign-up password rules and keeps the link usable", async () => {
    const user = await createUser();
    await forgot(user.email);
    const token = emailedToken(user.email, "/reset-password");

    const weak = await reset(token, "weakpass");
    expect(weak).to.have.status(400);
    expect(weak.body.message).to.match(/uppercase letter/);

    expect(await reset(token)).to.have.status(200);
  });

  it("works only with the newest link", async () => {
    const user = await createUser();
    await forgot(user.email);
    const first = emailedToken(user.email, "/reset-password");
    await forgot(user.email);

    expect(await reset(first)).to.have.status(400);
    expect(await reset(emailedToken(user.email, "/reset-password"))).to.have.status(200);
  });

  it("confirms an unconfirmed address, since the link proves it", async () => {
    await register();
    await forgot(EMAIL);

    expect(await reset(emailedToken(EMAIL, "/reset-password"))).to.have.status(200);

    expect(await login(EMAIL, NEW_PASSWORD)).to.have.status(200);
  });

  it("does not accept a confirmation token as a reset", async () => {
    await register();

    expect(await reset(emailedToken(EMAIL, "/confirm-email"))).to.have.status(400);
  });

  it("limits requests for one address", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect(await forgot("nobody@example.com")).to.have.status(200);
    }

    expect(await forgot("nobody@example.com")).to.have.status(429);
  });
});

describe("mail module", () => {
  it("keeps the email to the wordmark, one sentence, one link and an ignore line", () => {
    const link = "https://app.example.test/confirm-email?token=abc";
    const { text, html } = renderEmail({ sentence: "Confirm it.", action: "Confirm email", link });

    expect(text).to.include("BookBroker");
    expect(text).to.include(link);
    expect(text).to.match(/did not ask for this/);
    expect(html).to.include(link);
    expect(html.match(/<a /g)).to.have.length(1);
  });

  it("logs the message instead of sending when RESEND_API_KEY is not set", async () => {
    const logged = [];
    const original = console.log;
    console.log = (...args) => logged.push(args.join(" "));
    try {
      await unmockedDeliver({
        to: "reader@example.com",
        subject: "Confirm your email",
        text: "",
        html: "",
        link: "http://localhost:3000/confirm-email?token=abc",
      }, {});
    } finally {
      console.log = original;
    }

    expect(logged.join("\n")).to.include("reader@example.com");
    expect(logged.join("\n")).to.include("Confirm your email");
    expect(logged.join("\n")).to.include("http://localhost:3000/confirm-email?token=abc");
  });

  it("requires FRONTEND_BASE_URL in production", () => {
    expect(() => resolveFrontEndBaseUrl({ NODE_ENV: "production" })).to.throw(/FRONTEND_BASE_URL/);
    expect(
      resolveFrontEndBaseUrl({ NODE_ENV: "production", FRONTEND_BASE_URL: "https://app.example.test/" })
    ).to.equal("https://app.example.test");
    expect(resolveFrontEndBaseUrl({})).to.equal("http://localhost:3000");
  });
});

