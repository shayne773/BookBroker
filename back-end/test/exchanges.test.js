import { expect } from "chai";
import mongoose from "mongoose";
import { api, signUp, offerBook } from "./helpers.js";
import { OfferedBook, User } from "../Data.js";
import Exchange from "../Exchange.js";

describe("exchanges", () => {
  let requester;
  let responder;
  let requesterBook;
  let responderBook;

  beforeEach(async () => {
    requester = await signUp();
    responder = await signUp();
    requesterBook = await offerBook(requester, { title: "Offered by requester" });
    responderBook = await offerBook(responder, { title: "Offered by responder" });
  });

  async function propose() {
    const res = await api(requester.token)
      .post("/exchanges")
      .send({
        responderId: responder.id,
        requesterBooks: [requesterBook.id],
        responderBooks: [responderBook.id],
        message: "Swap?",
      });
    expect(res).to.have.status(201);
    return res.body._id;
  }

  it("POST /exchanges creates a pending trade both participants can see", async () => {
    const id = await propose();

    for (const user of [requester, responder]) {
      const res = await api(user.token).get("/exchanges");
      expect(res).to.have.status(200);
      expect(res.body.map((ex) => ex._id)).to.deep.equal([id]);
      expect(res.body[0].status).to.equal("PENDING");
    }
  });

  it("POST /exchanges refuses a book the requester does not own", async () => {
    const res = await api(requester.token)
      .post("/exchanges")
      .send({
        responderId: responder.id,
        requesterBooks: [responderBook.id],
        responderBooks: [],
      });

    expect(res).to.have.status(400);
  });

  it("GET /exchanges/:id is forbidden to someone outside the trade", async () => {
    const id = await propose();
    const outsider = await signUp();

    const res = await api(outsider.token).get(`/exchanges/${id}`);

    expect(res).to.have.status(403);
  });

  it("accepting locks both sides' books in one transaction", async () => {
    const id = await propose();

    const res = await api(responder.token).post(`/exchanges/${id}/accept`);

    expect(res).to.have.status(200);
    const books = await OfferedBook.find({ _id: { $in: [requesterBook.id, responderBook.id] } });
    expect(books).to.have.lengthOf(2);
    for (const book of books) {
      expect(book.locked).to.equal(true);
      expect(String(book.lockedByExchange)).to.equal(id);
    }
  });

  it("the trade completes, and its books leave the market, once both sides confirm", async () => {
    const id = await propose();
    await api(responder.token).post(`/exchanges/${id}/accept`);

    const first = await api(requester.token).post(`/exchanges/${id}/confirm-complete`);
    expect(first).to.have.status(200);
    expect(first.body.status).to.equal("ACCEPTED");
    expect(await OfferedBook.countDocuments()).to.equal(2);

    const second = await api(responder.token).post(`/exchanges/${id}/confirm-complete`);
    expect(second).to.have.status(200);
    expect(second.body.status).to.equal("COMPLETED");
    expect(await OfferedBook.countDocuments()).to.equal(0);
  });

  describe("rating a completed trade", () => {
    async function complete() {
      const id = await propose();
      await api(responder.token).post(`/exchanges/${id}/accept`);
      await api(requester.token).post(`/exchanges/${id}/confirm-complete`);
      await api(responder.token).post(`/exchanges/${id}/confirm-complete`);
      return id;
    }

    it("POST /exchanges/:id/rate records the rating on the trade, once", async () => {
      const id = await complete();

      const rate = await api(requester.token).post(`/exchanges/${id}/rate`).send({ rating: 4 });
      expect(rate).to.have.status(200);
      const again = await api(requester.token).post(`/exchanges/${id}/rate`).send({ rating: 5 });
      expect(again).to.have.status(400);

      const ex = await api(requester.token).get(`/exchanges/${id}`);
      expect(ex.body.requesterRating).to.equal(4);
    });

    it("POST /exchanges/:id/rate accumulates the rated user's average", async () => {
      const first = await complete();
      await api(requester.token).post(`/exchanges/${first}/rate`).send({ rating: 4 });

      let rated = await User.findById(responder.id).lean();
      expect(rated).to.include({ ratingsCount: 1, ratingsAvg: 4 });

      // The first trade took both books off the market, so a second trade needs new ones.
      requesterBook = await offerBook(requester, { title: "Second from requester" });
      responderBook = await offerBook(responder, { title: "Second from responder" });
      const second = await complete();
      await api(requester.token).post(`/exchanges/${second}/rate`).send({ rating: 1 });

      rated = await User.findById(responder.id).lean();
      expect(rated).to.include({ ratingsCount: 2, ratingsAvg: 2.5 });
    });

    it("the list and detail endpoints carry each participant's real average and count", async () => {
      const id = await complete();
      await api(requester.token).post(`/exchanges/${id}/rate`).send({ rating: 1 });

      const list = await api(requester.token).get("/exchanges");
      const detail = await api(requester.token).get(`/exchanges/${id}`);

      for (const ex of [list.body[0], detail.body]) {
        expect(ex.responder).to.include({ username: responder.username, ratingsAvg: 1, ratingsCount: 1 });
        expect(ex.requester).to.include({ username: requester.username, ratingsAvg: 0, ratingsCount: 0 });
        expect(ex.responder).to.not.have.property("ratings");
        expect(ex.requester).to.not.have.property("ratings");
      }
    });
  });

  it("a declined trade cannot then be accepted", async () => {
    const id = await propose();

    const decline = await api(responder.token).post(`/exchanges/${id}/decline`);
    expect(decline).to.have.status(200);

    const accept = await api(responder.token).post(`/exchanges/${id}/accept`);
    expect(accept).to.have.status(400);
    const book = await OfferedBook.findById(requesterBook.id);
    expect(book.locked).to.equal(false);
  });

  describe("who may accept", () => {
    it("the proposer cannot accept their own invite", async () => {
      const id = await propose();

      const res = await api(requester.token).post(`/exchanges/${id}/accept`);

      expect(res).to.have.status(403);
      const ex = await Exchange.findById(id);
      expect(ex.status).to.equal("PENDING");
      const book = await OfferedBook.findById(requesterBook.id);
      expect(book.locked).to.equal(false);
    });

    it("after a counter, only the side that received it may accept", async () => {
      const id = await propose();
      const counter = await api(responder.token)
        .post(`/exchanges/${id}/counter`)
        .send({ requesterBooks: [requesterBook.id], responderBooks: [], message: "Just yours?" });
      expect(counter).to.have.status(200);

      const own = await api(responder.token).post(`/exchanges/${id}/accept`);
      expect(own).to.have.status(403);

      const theirs = await api(requester.token).post(`/exchanges/${id}/accept`);
      expect(theirs).to.have.status(200);
    });
  });

  describe("cancelling an accepted trade", () => {
    it("either participant can cancel it, which unlocks both sides' books", async () => {
      for (const canceller of ["requester", "responder"]) {
        const id = await propose();
        await api(responder.token).post(`/exchanges/${id}/accept`);

        const user = canceller === "requester" ? requester : responder;
        const res = await api(user.token).post(`/exchanges/${id}/cancel`);

        expect(res).to.have.status(200);
        expect((await Exchange.findById(id)).status).to.equal("CANCELLED");
        const books = await OfferedBook.find({ _id: { $in: [requesterBook.id, responderBook.id] } });
        expect(books).to.have.lengthOf(2);
        for (const book of books) {
          expect(book.locked).to.equal(false);
          expect(book.lockedByExchange).to.equal(null);
        }
      }
    });

    for (const [confirmer, canceller] of [["requester", "responder"], ["responder", "requester"]]) {
      it(`is refused with 409 for the ${canceller} once the ${confirmer} has confirmed completion`, async () => {
        const users = { requester, responder };
        const id = await propose();
        await api(responder.token).post(`/exchanges/${id}/accept`);
        await api(users[confirmer].token).post(`/exchanges/${id}/confirm-complete`);

        const res = await api(users[canceller].token).post(`/exchanges/${id}/cancel`);

        expect(res).to.have.status(409);
        expect((await Exchange.findById(id)).status).to.equal("ACCEPTED");
        const books = await OfferedBook.find({ _id: { $in: [requesterBook.id, responderBook.id] } });
        expect(books).to.have.lengthOf(2);
        for (const book of books) {
          expect(book.locked).to.equal(true);
          expect(String(book.lockedByExchange)).to.equal(id);
        }
      });
    }

    it("is still allowed after only the canceller has confirmed, unlocking both sides' books", async () => {
      const id = await propose();
      await api(responder.token).post(`/exchanges/${id}/accept`);
      await api(requester.token).post(`/exchanges/${id}/confirm-complete`);

      const res = await api(requester.token).post(`/exchanges/${id}/cancel`);

      expect(res).to.have.status(200);
      expect((await Exchange.findById(id)).status).to.equal("CANCELLED");
      const books = await OfferedBook.find({ _id: { $in: [requesterBook.id, responderBook.id] } });
      expect(books).to.have.lengthOf(2);
      for (const book of books) {
        expect(book.locked).to.equal(false);
        expect(book.lockedByExchange).to.equal(null);
      }
    });

    it("an outsider cannot cancel it, and the books stay locked", async () => {
      const id = await propose();
      await api(responder.token).post(`/exchanges/${id}/accept`);
      const outsider = await signUp();

      const res = await api(outsider.token).post(`/exchanges/${id}/cancel`);

      expect(res).to.have.status(403);
      expect((await OfferedBook.findById(requesterBook.id)).locked).to.equal(true);
    });

    it("a completed trade cannot be cancelled", async () => {
      const id = await propose();
      await api(responder.token).post(`/exchanges/${id}/accept`);
      await api(requester.token).post(`/exchanges/${id}/confirm-complete`);
      await api(responder.token).post(`/exchanges/${id}/confirm-complete`);

      const res = await api(requester.token).post(`/exchanges/${id}/cancel`);

      expect(res).to.have.status(400);
      expect((await Exchange.findById(id)).status).to.equal("COMPLETED");
    });

    it("leaves books locked by a different trade alone", async () => {
      const id = await propose();
      const other = await signUp();
      const otherBook = await offerBook(other, { title: "Held elsewhere" });
      const elsewhere = new Exchange({ requester: other.id, responder: requester.id })._id;
      await OfferedBook.updateOne({ _id: otherBook._id }, { locked: true, lockedByExchange: elsewhere });
      await api(responder.token).post(`/exchanges/${id}/accept`);

      await api(requester.token).post(`/exchanges/${id}/cancel`);

      expect((await OfferedBook.findById(otherBook._id)).locked).to.equal(true);
    });
  });

  describe("books locked in an accepted trade", () => {
    it("disappear from /feed, /books and /browse", async () => {
      const id = await propose();
      const viewer = await signUp();
      const free = await offerBook(requester, { title: "Still available" });
      await api(responder.token).post(`/exchanges/${id}/accept`);

      const feed = await api(viewer.token).get("/feed");
      expect(feed.body.map((b) => b._id)).to.deep.equal([String(free._id)]);

      const books = await api(viewer.token).get("/books");
      expect(books.body.map((b) => b._id)).to.deep.equal([String(free._id)]);

      const browse = await api(viewer.token).get("/browse").query({ q: "a" });
      expect(browse).to.have.status(200);
      for (const section of ["searchResults", "popular", "newlyAdded"]) {
        expect(browse.body[section].map((b) => String(b._id)), section).to.deep.equal([String(free._id)]);
      }
      for (const row of Object.values(browse.body.genreRows)) {
        expect(row.map((b) => String(b._id))).to.deep.equal([String(free._id)]);
      }
    });

    it("come back once the trade is cancelled", async () => {
      const id = await propose();
      const viewer = await signUp();
      await api(responder.token).post(`/exchanges/${id}/accept`);
      await api(requester.token).post(`/exchanges/${id}/cancel`);

      const feed = await api(viewer.token).get("/feed");

      expect(feed.body.map((b) => b._id)).to.have.members([requesterBook.id, responderBook.id]);
    });

    it("cannot be put into a new proposal or a counter", async () => {
      const id = await propose();
      await api(responder.token).post(`/exchanges/${id}/accept`);
      const third = await signUp();
      const thirdBook = await offerBook(third, { title: "Third party's" });

      const offerLocked = await api(requester.token)
        .post("/exchanges")
        .send({ responderId: third.id, requesterBooks: [requesterBook.id], responderBooks: [thirdBook.id] });
      expect(offerLocked).to.have.status(400);

      const askForLocked = await api(third.token)
        .post("/exchanges")
        .send({ responderId: responder.id, requesterBooks: [thirdBook.id], responderBooks: [responderBook.id] });
      expect(askForLocked).to.have.status(400);

      const fresh = await api(third.token)
        .post("/exchanges")
        .send({ responderId: requester.id, requesterBooks: [thirdBook.id], responderBooks: [] });
      expect(fresh).to.have.status(201);
      const counter = await api(requester.token)
        .post(`/exchanges/${fresh.body._id}/counter`)
        .send({ requesterBooks: [thirdBook.id], responderBooks: [requesterBook.id] });
      expect(counter).to.have.status(400);
    });
  });

  describe("a conflicting lock on accept", () => {
    // Records every session the routes open, and whether the route itself
    // aborted the transaction rather than leaving endSession to clean it up.
    let sessions;
    let startSession;

    beforeEach(() => {
      sessions = [];
      startSession = mongoose.startSession;
      mongoose.startSession = async function (...args) {
        const session = await startSession.apply(this, args);
        const record = { session, abortedByRoute: false };
        let ending = false;
        const { abortTransaction, endSession } = session;
        session.abortTransaction = function (...a) {
          if (!ending) record.abortedByRoute = true;
          return abortTransaction.apply(this, a);
        };
        session.endSession = function (...a) {
          ending = true;
          return endSession.apply(this, a);
        };
        sessions.push(record);
        return session;
      };
    });

    afterEach(() => {
      mongoose.startSession = startSession;
    });

    it("answers 409, aborting the transaction and ending the session", async () => {
      const first = await propose();
      const second = await propose();
      await api(responder.token).post(`/exchanges/${first}/accept`);
      sessions = [];

      const conflict = await api(responder.token).post(`/exchanges/${second}/accept`);

      expect(conflict).to.have.status(409);
      expect(sessions).to.have.lengthOf(1);
      expect(sessions[0].abortedByRoute).to.equal(true);
      expect(sessions[0].session.hasEnded).to.equal(true);
      expect((await Exchange.findById(second)).status).to.equal("PENDING");
    });

    it("leaves the books free to unlock and lock again", async () => {
      const first = await propose();
      const second = await propose();
      await api(responder.token).post(`/exchanges/${first}/accept`);
      await api(responder.token).post(`/exchanges/${second}/accept`);

      const cancel = await api(requester.token).post(`/exchanges/${first}/cancel`);
      expect(cancel).to.have.status(200);
      const retry = await api(responder.token).post(`/exchanges/${second}/accept`);
      expect(retry).to.have.status(200);
    });
  });
});
