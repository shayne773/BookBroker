import { expect } from "chai";
import { api, signUp, offerBook } from "./helpers.js";
import { OfferedBook, User } from "../Data.js";

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
});
