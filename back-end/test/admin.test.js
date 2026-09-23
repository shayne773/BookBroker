import { expect } from "chai";
import mongoose from "mongoose";
import { api, createUser, authHeader, offerBook, signUp, TEST_PASSWORD } from "./helpers.js";
import { Report, User } from "../Data.js";
import { Session } from "../lib/sessions.js";
import Exchange from "../Exchange.js";

describe("admin", () => {
  let admin;
  let reader;
  let reported;

  beforeEach(async () => {
    admin = await signUp({ email: "admin@example.com" });
    reader = await signUp();
    reported = await signUp();
    // Listed with different casing and spacing: the comparison ignores both.
    process.env.ADMIN_EMAILS = " someone@example.com, ADMIN@Example.com ";
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAILS;
  });

  const report = (by, target, body = { reason: "SPAM" }) =>
    api(by.token).post(`/users/${target.id}/report`).send(body);
  const suspend = (by, target, note) =>
    api(by.token).post(`/admin/users/${target.id}/suspend`).send(note === undefined ? {} : { note });
  const unsuspend = (by, target) => api(by.token).delete(`/admin/users/${target.id}/suspend`);
  const login = (user) =>
    api().post("/auth/login").send({ email: user.email, password: TEST_PASSWORD });

  describe("access", () => {
    const someId = String(new mongoose.Types.ObjectId());
    const endpoints = [
      ["GET", "/admin/reports"],
      ["POST", `/admin/reports/${someId}/review`],
      ["POST", `/admin/users/${someId}/suspend`],
      ["DELETE", `/admin/users/${someId}/suspend`],
    ];
    const call = (token, method, path) => api(token)[method.toLowerCase()](path);

    for (const [method, path] of endpoints) {
      it(`${method} ${path.replace(someId, ":id")} is refused to a reader who is not an admin`, async () => {
        expect(await call(reader.token, method, path)).to.have.status(403);
      });

      it(`${method} ${path.replace(someId, ":id")} needs a signed-in admin`, async () => {
        expect(await api()[method.toLowerCase()](path)).to.have.status(401);
      });
    }

    it("refuses everyone when ADMIN_EMAILS is unset", async () => {
      delete process.env.ADMIN_EMAILS;
      expect(await api(admin.token).get("/admin/reports")).to.have.status(403);
    });

    it("refuses a listed address that has not been confirmed", async () => {
      const unconfirmed = await createUser({ email: "pending@example.com", emailVerified: false });
      process.env.ADMIN_EMAILS = "pending@example.com";

      const res = await api().get("/admin/reports").set(await authHeader(unconfirmed));
      expect(res).to.have.status(403);
    });

    it("tells the front end who is an admin", async () => {
      expect((await api(admin.token).get("/user")).body.isAdmin).to.equal(true);
      expect((await api(reader.token).get("/user")).body.isAdmin).to.equal(false);
    });
  });

  describe("reports", () => {
    it("lists open reports newest first with both readers, reason, details and date", async () => {
      await report(reader, reported, { reason: "SCAM", details: "Asked for money up front." });
      await report(admin, reported, { reason: "SPAM" });
      await Report.updateOne({ reason: "SCAM" }, { createdAt: new Date(Date.now() - 60_000) });

      const res = await api(admin.token).get("/admin/reports");

      expect(res).to.have.status(200);
      expect(res.body.map((r) => r.reason)).to.deep.equal(["SPAM", "SCAM"]);
      const [, scam] = res.body;
      expect(scam.reporter).to.deep.equal({ _id: reader.id, username: reader.username });
      expect(scam.reported).to.include({ _id: reported.id, username: reported.username, suspended: false });
      expect(scam.details).to.equal("Asked for money up front.");
      expect(scam.createdAt).to.be.a("string");
      expect(scam.reviewedAt).to.equal(null);
      expect(scam.reporter).to.not.have.property("email");
    });

    it("marks a report reviewed, moving it from open to reviewed", async () => {
      await report(reader, reported);
      const [open] = (await api(admin.token).get("/admin/reports")).body;

      const res = await api(admin.token).post(`/admin/reports/${open._id}/review`);
      expect(res).to.have.status(200);
      expect(res.body.reviewedAt).to.be.a("string");

      expect((await api(admin.token).get("/admin/reports?status=open")).body).to.deep.equal([]);
      const reviewed = (await api(admin.token).get("/admin/reports?status=reviewed")).body;
      expect(reviewed).to.have.lengthOf(1);
      expect(reviewed[0].reviewedBy).to.deep.equal({ _id: admin.id, username: admin.username });
    });

    it("keeps the first review when a report is marked reviewed twice", async () => {
      await report(reader, reported);
      const [open] = (await api(admin.token).get("/admin/reports")).body;

      const first = await api(admin.token).post(`/admin/reports/${open._id}/review`);
      const second = await api(admin.token).post(`/admin/reports/${open._id}/review`);

      expect(second.body.reviewedAt).to.equal(first.body.reviewedAt);
    });

    it("refuses an unknown status, a malformed report id and an unknown report", async () => {
      expect(await api(admin.token).get("/admin/reports?status=all")).to.have.status(400);
      expect(await api(admin.token).post("/admin/reports/nope/review")).to.have.status(400);
      const unknown = String(new mongoose.Types.ObjectId());
      expect(await api(admin.token).post(`/admin/reports/${unknown}/review`)).to.have.status(404);
    });
  });

  describe("suspending a reader", () => {
    it("records the suspension with its note and shows it on their reports", async () => {
      await report(reader, reported);

      const res = await suspend(admin, reported, "  Repeated scams.  ");
      expect(res).to.have.status(200);

      const user = await User.findById(reported.id).lean();
      expect(user.suspended).to.equal(true);
      expect(user.suspension.note).to.equal("Repeated scams.");
      expect(String(user.suspension.by)).to.equal(admin.id);

      const [row] = (await api(admin.token).get("/admin/reports")).body;
      expect(row.reported.suspended).to.equal(true);
      expect(row.reported.suspension.note).to.equal("Repeated scams.");
    });

    it("refuses to let an admin suspend themselves", async () => {
      expect(await suspend(admin, admin)).to.have.status(400);
      expect((await User.findById(admin.id).lean()).suspended).to.equal(false);
    });

    it("refuses a malformed id, an unknown reader and an overlong note", async () => {
      expect(await suspend(admin, { id: "nope" })).to.have.status(400);
      expect(await suspend(admin, { id: String(new mongoose.Types.ObjectId()) })).to.have.status(404);
      expect(await suspend(admin, reported, "x".repeat(1001))).to.have.status(400);
    });

    it("ends every session of the reader at once", async () => {
      const second = (await login(reported)).body.token;
      expect(await Session.countDocuments({ user: reported.id })).to.equal(2);

      await suspend(admin, reported);

      expect(await Session.countDocuments({ user: reported.id })).to.equal(0);
      expect(await api(reported.token).get("/user")).to.have.status(401);
      expect(await api(second).get("/user")).to.have.status(401);
    });

    it("stops the reader signing in, with a message saying why", async () => {
      await suspend(admin, reported);

      const res = await login(reported);

      expect(res).to.have.status(403);
      expect(res.body.code).to.equal("ACCOUNT_SUSPENDED");
      expect(res.body.message).to.match(/suspended/);
      expect(res.body).to.not.have.property("token");
    });

    it("still answers a wrong password as invalid credentials", async () => {
      await suspend(admin, reported);

      const res = await api().post("/auth/login").send({ email: reported.email, password: "Wr0ngPassw0rd" });

      expect(res).to.have.status(400);
      expect(res.body.message).to.equal("Invalid credentials");
    });

    it("takes their offers off browse, search, the feed, matches and the most-wanted list", async () => {
      const book = await offerBook(reported, { title: "Suspended Shelf", isbn: "9780000000001" });
      await api(reader.token)
        .post("/user/add-wishlist-book")
        .send({ title: "Suspended Shelf", author: "A", isbn: "9780000000001", cover: "https://x.test/c.jpg" });

      await suspend(admin, reported);

      const ids = (books) => books.map((b) => String(b._id));
      const browse = (await api(reader.token).get("/browse?q=Suspended")).body;
      expect(ids(browse.searchResults)).to.not.include(String(book._id));
      expect(ids(browse.newlyAdded)).to.not.include(String(book._id));
      expect(ids(browse.popular)).to.not.include(String(book._id));
      expect(ids((await api().get("/popular")).body)).to.not.include(String(book._id));
      expect(ids((await api().get("/new")).body)).to.not.include(String(book._id));
      expect(ids((await api(reader.token).get("/feed")).body)).to.not.include(String(book._id));
      expect(ids((await api(reader.token).get("/books?query=Suspended")).body)).to.deep.equal([]);
      expect((await api(reader.token).get("/user/wishlist/matches")).body).to.deep.equal([]);
      expect((await api(reader.token).get(`/users/${reported.id}/offered`)).body).to.deep.equal([]);
      expect(await api(reader.token).get(`/books/${book._id}`)).to.have.status(404);
    });

    it("stops others messaging them or proposing a trade to them", async () => {
      await suspend(admin, reported);

      const message = await api(reader.token).post(`/messages/${reported.id}`).send({ content: "hi" });
      expect(message).to.have.status(403);

      const trade = await api(reader.token)
        .post("/exchanges")
        .send({ responderId: reported.id, requesterBooks: [], responderBooks: [] });
      expect(trade).to.have.status(403);
    });

    it("stops a pending offer from them being accepted, but leaves the trade in place", async () => {
      const exchange = await Exchange.create({
        requester: reported.id,
        responder: reader.id,
        status: "PENDING",
        proposedBy: reported.id,
      });

      await suspend(admin, reported);

      expect(await api(reader.token).post(`/exchanges/${exchange._id}/accept`)).to.have.status(403);
      expect((await Exchange.findById(exchange._id)).status).to.equal("PENDING");
      expect(await api(reader.token).post(`/exchanges/${exchange._id}/decline`)).to.have.status(200);
    });
  });

  describe("unsuspending a reader", () => {
    it("restores sign-in, their offers, messaging and proposals", async () => {
      const book = await offerBook(reported, { title: "Back Again" });
      await suspend(admin, reported, "Mistaken");

      const res = await unsuspend(admin, reported);
      expect(res).to.have.status(200);
      expect(res.body.suspended).to.equal(false);

      const user = await User.findById(reported.id).lean();
      expect(user.suspended).to.equal(false);
      expect(user).to.not.have.property("suspension");

      const signIn = await login(reported);
      expect(signIn).to.have.status(200);
      expect(await api(signIn.body.token).get("/user")).to.have.status(200);

      const newlyAdded = (await api(reader.token).get("/browse")).body.newlyAdded;
      expect(newlyAdded.map((b) => String(b._id))).to.include(String(book._id));

      expect(
        await api(reader.token).post(`/messages/${reported.id}`).send({ content: "hi" })
      ).to.have.status(200);
      expect(
        await api(reader.token)
          .post("/exchanges")
          .send({ responderId: reported.id, requesterBooks: [], responderBooks: [String(book._id)] })
      ).to.have.status(201);
    });
  });
});
