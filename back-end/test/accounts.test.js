import { expect } from "chai";
import { api, confirmEmail, offerBook, outbox, signUp, TEST_PASSWORD } from "./helpers.js";
import { Block, Conversation, OfferedBook, Report, User, WishlistBook, WishlistNotice } from "../Data.js";
import Exchange from "../Exchange.js";
import { AuthToken } from "../lib/authTokens.js";
import { notificationsSettled } from "../lib/notifications.js";
import { Session } from "../lib/sessions.js";

describe("deleting an account", () => {
  let ada;
  let bea;

  beforeEach(async () => {
    [ada, bea] = await Promise.all([signUp(), signUp()]);
  });

  const deleteAccount = (user, password = TEST_PASSWORD) =>
    api(user.token).post("/user/delete").send({ password });

  const wishlist = (user, isbn) =>
    api(user.token)
      .post("/user/add-wishlist-book")
      .send({ title: "Wanted", author: "Someone", isbn, cover: "https://example.com/c.jpg" });

  async function trade(from, to, { accept = false, complete = false } = {}) {
    const mine = await offerBook(from, { title: `${from.username}'s book` });
    const theirs = await offerBook(to, { title: `${to.username}'s book` });
    const proposed = await api(from.token)
      .post("/exchanges")
      .send({ responderId: to.id, requesterBooks: [mine.id], responderBooks: [theirs.id] });
    expect(proposed).to.have.status(201);
    const id = proposed.body._id;
    if (accept || complete) expect(await api(to.token).post(`/exchanges/${id}/accept`)).to.have.status(200);
    if (complete) {
      for (const user of [from, to]) {
        expect(await api(user.token).post(`/exchanges/${id}/confirm-complete`)).to.have.status(200);
      }
    }
    return { id, mine, theirs };
  }

  describe("asks for the password", () => {
    it("needs a signed-in reader", async () => {
      expect(await api().post("/user/delete").send({ password: TEST_PASSWORD })).to.have.status(401);
    });

    it("refuses a wrong or missing password and keeps the account", async () => {
      await offerBook(ada);

      for (const body of [{ password: "Wr0ngPassword" }, {}, { password: ["x"] }]) {
        const res = await api(ada.token).post("/user/delete").send(body);
        expect(res).to.have.status(400);
        expect(res.body.message).to.equal("That password isn't right.");
      }

      expect(await User.exists({ _id: ada.id })).to.not.equal(null);
      expect(await OfferedBook.countDocuments({ owner: ada.id })).to.equal(1);
      expect(await api(ada.token).get("/user")).to.have.status(200);
    });

    it("stops taking guesses after five wrong passwords, as sign-in does", async () => {
      for (let i = 0; i < 5; i += 1) expect(await deleteAccount(ada, "Wr0ngPassword")).to.have.status(400);

      const res = await deleteAccount(ada);

      expect(res).to.have.status(429);
      expect(res).to.have.header("retry-after");
      expect(await User.exists({ _id: ada.id })).to.not.equal(null);
    });
  });

  describe("removes what is theirs alone", () => {
    it("deletes the reader, their books, wishlist, blocks, sessions and links", async () => {
      const cal = await signUp();
      await offerBook(ada);
      expect(await wishlist(ada, "9780000000001")).to.have.status(201);
      expect(await api(ada.token).post(`/users/${cal.id}/block`)).to.have.status(200);
      expect(await api(cal.token).post(`/users/${ada.id}/block`)).to.have.status(200);
      const otherSession = await api().post("/auth/login").send({ email: ada.email, password: TEST_PASSWORD });
      await api().post("/auth/forgot-password").send({ email: ada.email });
      await WishlistNotice.create([
        { _id: `${ada.id}:9780000000001`, sentAt: new Date() },
        { _id: `${bea.id}:9780000000001`, sentAt: new Date() },
      ]);

      const res = await deleteAccount(ada);

      expect(res).to.have.status(200);
      expect(await User.exists({ _id: ada.id })).to.equal(null);
      expect(await OfferedBook.countDocuments({ owner: ada.id })).to.equal(0);
      expect(await WishlistBook.countDocuments({ userId: ada.id })).to.equal(0);
      expect(await Block.countDocuments({ blocker: ada.id })).to.equal(0);
      expect(await Block.countDocuments({ blocker: cal.id })).to.equal(1);
      expect(await Session.countDocuments({ user: ada.id })).to.equal(0);
      expect(await AuthToken.countDocuments({ user: ada.id })).to.equal(0);
      expect((await WishlistNotice.find().lean()).map((n) => n._id)).to.deep.equal([
        `${bea.id}:9780000000001`,
      ]);

      // Every browser they were signed in on is signed out.
      for (const token of [ada.token, otherSession.body.token]) {
        expect(await api(token).get("/user")).to.have.status(401);
      }
    });

    it("takes their books off every listing and out of other readers' matches", async () => {
      await offerBook(ada, { title: "Ada's copy", isbn: "9780000000002" });
      expect(await wishlist(bea, "9780000000002")).to.have.status(201);
      const titles = async () => (await api(bea.token).get("/new")).body.map((b) => b.title);
      const matches = async () => (await api(bea.token).get("/user/wishlist/matches")).body;
      const mapCount = async () =>
        (await api(bea.token).get("/map/areas?bbox=-74.3,40.5,-73.7,40.95")).body.areas.length;
      expect(await titles()).to.include("Ada's copy");
      expect(await matches()).to.have.length(1);
      expect(await mapCount()).to.equal(1);

      await deleteAccount(ada);

      expect(await titles()).to.not.include("Ada's copy");
      expect(await matches()).to.have.length(0);
      expect(await mapCount()).to.equal(0);
    });
  });

  describe("trades", () => {
    it("cancels their open offers and unfinished trades, freeing the other side's books", async () => {
      const offered = await trade(ada, bea);
      const accepted = await trade(bea, ada, { accept: true });
      await notificationsSettled();
      outbox.length = 0;

      await deleteAccount(ada);

      for (const { id } of [offered, accepted]) {
        expect((await Exchange.findById(id)).status).to.equal("CANCELLED");
      }
      const beasBooks = await OfferedBook.find({ owner: bea.id }).lean();
      expect(beasBooks).to.have.length(2);
      for (const book of beasBooks) {
        expect(book.locked).to.equal(false);
        expect(book.lockedByExchange).to.equal(null);
      }

      await notificationsSettled();
      expect(outbox.filter((m) => m.to === bea.email).map((m) => m.subject)).to.deep.equal([
        "Deleted reader cancelled your trade",
        "Deleted reader cancelled your trade",
      ]);
    });

    it("completes an accepted trade the other reader already confirmed, as its deadline would", async () => {
      const confirmedByBea = await trade(bea, ada, { accept: true });
      const confirmedByAda = await trade(ada, bea, { accept: true });
      for (const [user, { id }] of [[bea, confirmedByBea], [ada, confirmedByAda]]) {
        expect(await api(user.token).post(`/exchanges/${id}/confirm-complete`)).to.have.status(200);
      }
      await notificationsSettled();
      outbox.length = 0;

      await deleteAccount(ada);

      expect((await Exchange.findById(confirmedByBea.id)).status).to.equal("COMPLETED");
      expect((await Exchange.findById(confirmedByAda.id)).status).to.equal("CANCELLED");
      // The handed-over book is gone; the one from the cancelled trade is free again.
      expect(await OfferedBook.exists({ _id: confirmedByBea.mine.id })).to.equal(null);
      const left = await OfferedBook.find({ owner: bea.id }).lean();
      expect(left.map((b) => String(b._id))).to.deep.equal([confirmedByAda.theirs.id]);
      expect(left[0].locked).to.equal(false);

      await notificationsSettled();
      const toBea = outbox.filter((m) => m.to === bea.email);
      expect(toBea.map((m) => m.subject)).to.have.members([
        "Your trade is complete",
        "Deleted reader cancelled your trade",
      ]);
      const completion = toBea.find((m) => m.subject === "Your trade is complete");
      expect(completion.text).to.include(
        "The other reader deleted their account. You had confirmed the trade, so it is now complete."
      );
      expect(completion.text).to.not.include("confirmed the trade, so it is complete.");
    });

    it("keeps completed trades and every rating, so nobody's average changes", async () => {
      const done = await trade(ada, bea, { complete: true });
      expect(await api(ada.token).post(`/exchanges/${done.id}/rate`).send({ rating: 4 })).to.have.status(200);
      expect(await api(bea.token).post(`/exchanges/${done.id}/rate`).send({ rating: 5 })).to.have.status(200);

      await deleteAccount(ada);

      const res = await api(bea.token).get("/exchanges");
      expect(res).to.have.status(200);
      expect(res.body).to.have.length(1);
      expect(res.body[0].status).to.equal("COMPLETED");
      expect(res.body[0].requester).to.equal(null);
      expect(res.body[0].responder.username).to.equal(bea.username);
      const stored = await Exchange.findById(done.id).lean();
      expect([stored.requesterRating, stored.responderRating]).to.deep.equal([4, 5]);
      const beaNow = await User.findById(bea.id).lean();
      expect([beaNow.ratingsAvg, beaNow.ratingsCount]).to.deep.equal([4, 1]);
    });

    it("refuses a new offer to them", async () => {
      await deleteAccount(ada);

      const res = await api(bea.token)
        .post("/exchanges")
        .send({ responderId: ada.id, requesterBooks: [], responderBooks: [] });

      expect(res).to.have.status(404);
      expect(await Exchange.countDocuments()).to.equal(0);
    });
  });

  describe("what other readers see", () => {
    it("keeps the conversation for the other reader, with no one to answer", async () => {
      const said = async (from, to, content) =>
        expect(await api(from.token).post(`/messages/${to.id}`).send({ content })).to.have.status(200);
      await said(bea, ada, "still have it?");
      await said(ada, bea, "yes!");

      await deleteAccount(ada);

      const inbox = await api(bea.token).get("/messages");
      expect(inbox.body).to.have.length(1);
      expect(inbox.body[0].otherUser).to.deep.include({ id: ada.id, deleted: true, username: null });
      expect(inbox.body[0].lastMessage).to.equal("yes!");

      const thread = await api(bea.token).get(`/messages/${ada.id}`);
      expect(thread.body.map((m) => m.content)).to.deep.equal(["still have it?", "yes!"]);

      const reply = await api(bea.token).post(`/messages/${ada.id}`).send({ content: "hello?" });
      expect(reply).to.have.status(404);

      expect(await api(bea.token).get(`/users/${ada.id}`)).to.have.status(404);
      const convo = await Conversation.findOne().lean();
      expect(Object.keys(convo.readAt)).to.deep.equal([bea.id]);
    });

    it("keeps reports by and about them for admins", async () => {
      process.env.ADMIN_EMAILS = "admin@example.com";
      try {
        const admin = await signUp({ email: "admin@example.com" });
        expect(await api(ada.token).post(`/users/${bea.id}/report`).send({ reason: "SPAM" })).to.have.status(201);
        expect(await api(bea.token).post(`/users/${ada.id}/report`).send({ reason: "SCAM" })).to.have.status(201);

        await deleteAccount(ada);

        expect(await Report.countDocuments()).to.equal(2);
        const res = await api(admin.token).get("/admin/reports");
        const byReason = Object.fromEntries(res.body.map((r) => [r.reason, r]));
        expect(byReason.SPAM.reporter).to.equal(null);
        expect(byReason.SPAM.reported.username).to.equal(bea.username);
        expect(byReason.SCAM.reported).to.equal(null);
      } finally {
        delete process.env.ADMIN_EMAILS;
      }
    });
  });

  it("frees the address to sign up again as a brand-new account", async () => {
    await offerBook(ada);
    await deleteAccount(ada);

    const registered = await api()
      .post("/auth/register")
      .send({ username: "ada-again", email: ada.email, password: TEST_PASSWORD, zip: "11201" });
    expect(registered).to.have.status(201);
    await confirmEmail(ada.email);
    const login = await api().post("/auth/login").send({ email: ada.email, password: TEST_PASSWORD });

    expect(login).to.have.status(200);
    expect(String(login.body.user.id)).to.not.equal(ada.id);
    expect(await OfferedBook.countDocuments({ owner: login.body.user.id })).to.equal(0);
  });
});
