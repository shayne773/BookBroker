import { expect } from "chai";
import mongoose from "mongoose";
import { api, signUp, offerBook } from "./helpers.js";
import { Block, Report } from "../Data.js";

describe("blocking", () => {
  let me;
  let them;

  beforeEach(async () => {
    me = await signUp();
    them = await signUp();
  });

  const block = (by, target) => api(by.token).post(`/users/${target.id}/block`);
  const unblock = (by, target) => api(by.token).delete(`/users/${target.id}/block`);

  describe("placing and lifting a block", () => {
    it("blocks a reader, lists them for unblocking, and unblocks them", async () => {
      const res = await block(me, them);
      expect(res).to.have.status(200);
      expect(res.body.blockedByMe).to.equal(true);

      const list = await api(me.token).get("/user/blocks");
      expect(list).to.have.status(200);
      expect(list.body).to.have.lengthOf(1);
      expect(list.body[0]).to.include({ _id: them.id, username: them.username });

      const profile = await api(me.token).get(`/users/${them.id}`);
      expect(profile.body.blockedByMe).to.equal(true);

      const lifted = await unblock(me, them);
      expect(lifted).to.have.status(200);
      expect((await api(me.token).get("/user/blocks")).body).to.deep.equal([]);
      expect((await api(me.token).get(`/users/${them.id}`)).body.blockedByMe).to.equal(false);
    });

    it("blocking twice leaves one block", async () => {
      await block(me, them);
      const again = await block(me, them);

      expect(again).to.have.status(200);
      expect(await Block.countDocuments()).to.equal(1);
    });

    it("never tells the blocked reader they were blocked", async () => {
      await block(me, them);

      const profile = await api(them.token).get(`/users/${me.id}`);

      expect(profile).to.have.status(200);
      expect(profile.body.blockedByMe).to.equal(false);
      expect((await api(them.token).get("/user/blocks")).body).to.deep.equal([]);
    });

    it("only the blocker can lift a block", async () => {
      await block(me, them);

      await unblock(them, me);

      expect(await Block.countDocuments()).to.equal(1);
    });

    it("refuses to block yourself, a malformed id or an unknown reader", async () => {
      expect(await block(me, me)).to.have.status(400);
      expect(await api(me.token).post("/users/nope/block")).to.have.status(400);
      expect(await block(me, { id: String(new mongoose.Types.ObjectId()) })).to.have.status(404);
      expect(await Block.countDocuments()).to.equal(0);
    });

    it("needs a signed-in reader", async () => {
      expect(await api().post(`/users/${them.id}/block`)).to.have.status(401);
      expect(await api().get("/user/blocks")).to.have.status(401);
    });
  });

  // Every rule below is checked with the block placed by either reader.
  const directions = [
    ["when I blocked them", () => block(me, them)],
    ["when they blocked me", () => block(them, me)],
  ];

  for (const [when, placeBlock] of directions) {
    describe(`messages, ${when}`, () => {
      it("refuses a message either way, and allows it again once unblocked", async () => {
        await placeBlock();

        const mine = await api(me.token).post(`/messages/${them.id}`).send({ content: "Hi" });
        const theirs = await api(them.token).post(`/messages/${me.id}`).send({ content: "Hi" });

        expect(mine).to.have.status(403);
        expect(theirs).to.have.status(403);

        await Block.deleteMany({});
        const after = await api(me.token).post(`/messages/${them.id}`).send({ content: "Hi" });
        expect(after).to.have.status(200);
      });
    });

    describe(`trades, ${when}`, () => {
      let myBook;
      let theirBook;

      beforeEach(async () => {
        myBook = await offerBook(me, { title: "Mine" });
        theirBook = await offerBook(them, { title: "Theirs" });
      });

      const propose = (from, to, fromBook, toBook) =>
        api(from.token)
          .post("/exchanges")
          .send({ responderId: to.id, requesterBooks: [fromBook.id], responderBooks: [toBook.id] });

      it("refuses a proposal either way", async () => {
        await placeBlock();

        expect(await propose(me, them, myBook, theirBook)).to.have.status(403);
        expect(await propose(them, me, theirBook, myBook)).to.have.status(403);
      });

      it("refuses to counter or accept an offer made before the block, but lets it be declined", async () => {
        const proposed = await propose(me, them, myBook, theirBook);
        expect(proposed).to.have.status(201);
        const id = proposed.body._id;

        await placeBlock();

        const counter = await api(them.token)
          .post(`/exchanges/${id}/counter`)
          .send({ requesterBooks: [myBook.id], responderBooks: [theirBook.id] });
        expect(counter).to.have.status(403);
        expect(await api(them.token).post(`/exchanges/${id}/accept`)).to.have.status(403);
        expect(await api(them.token).post(`/exchanges/${id}/decline`)).to.have.status(200);
      });
    });

    describe(`offers, ${when}`, () => {
      let theirBook;
      let myBook;

      beforeEach(async () => {
        theirBook = await offerBook(them, { title: "Their Hobbit", genre: "Adventure" });
        myBook = await offerBook(me, { title: "My Hobbit", genre: "Adventure" });
        await placeBlock();
      });

      const ids = (books) => books.map((b) => String(b._id));

      it("hides each other's books from the feed and search", async () => {
        expect(ids((await api(me.token).get("/feed")).body)).to.not.include(theirBook.id);
        expect(ids((await api(them.token).get("/feed")).body)).to.not.include(myBook.id);
        expect(ids((await api(me.token).get("/books?query=hobbit")).body)).to.not.include(theirBook.id);
        expect(ids((await api(them.token).get("/books?query=hobbit")).body)).to.not.include(myBook.id);
      });

      it("hides each other's books from every browse section", async () => {
        const res = await api(me.token).get("/browse?q=hobbit");

        expect(res).to.have.status(200);
        const { searchResults, popular, newlyAdded, genreRows } = res.body;
        const all = [searchResults, popular, newlyAdded, ...Object.values(genreRows)].flat();
        expect(ids(all)).to.not.include(theirBook.id);
        expect(ids((await api(me.token).get("/recommendations")).body)).to.not.include(theirBook.id);
      });

      it("hides each other's books from the public lists when signed in", async () => {
        for (const path of ["/new", "/popular", "/genres/adventure"]) {
          const res = await api(me.token).get(path);
          expect(res, path).to.have.status(200);
          expect(ids(res.body), path).to.not.include(theirBook.id);
          expect(ids(res.body), path).to.include(myBook.id);
        }
      });

      it("hides the book page and the offered shelf both ways", async () => {
        expect(await api(me.token).get(`/books/${theirBook.id}`)).to.have.status(404);
        expect(await api(them.token).get(`/books/${myBook.id}`)).to.have.status(404);
        expect((await api(me.token).get(`/users/${them.id}/offered`)).body).to.deep.equal([]);
        expect((await api(them.token).get(`/users/${me.id}/offered`)).body).to.deep.equal([]);
      });

      it("leaves other readers' view of both untouched", async () => {
        const other = await signUp();

        const feed = ids((await api(other.token).get("/feed")).body);

        expect(feed).to.include.members([theirBook.id, myBook.id]);
        expect(await api(other.token).get(`/books/${theirBook.id}`)).to.have.status(200);
      });
    });
  }

  it("a signed-out caller still sees the public lists", async () => {
    const book = await offerBook(them);
    await block(me, them);

    const res = await api().get("/new");

    expect(res.body.map((b) => String(b._id))).to.include(book.id);
  });
});

describe("reporting", () => {
  let me;
  let them;

  beforeEach(async () => {
    me = await signUp();
    them = await signUp();
  });

  const report = (body, target = them) => api(me.token).post(`/users/${target.id}/report`).send(body);

  it("stores a report with its reason and details", async () => {
    const res = await report({ reason: "SCAM", details: "  Took my book and vanished.  " });

    expect(res).to.have.status(201);
    const stored = await Report.find().lean();
    expect(stored).to.have.lengthOf(1);
    expect(String(stored[0].reporter)).to.equal(me.id);
    expect(String(stored[0].reported)).to.equal(them.id);
    expect(stored[0]).to.include({ reason: "SCAM", details: "Took my book and vanished." });
  });

  it("takes the details as optional", async () => {
    const res = await report({ reason: "SPAM" });

    expect(res).to.have.status(201);
    expect((await Report.findOne().lean()).details).to.equal("");
  });

  it("refuses a reason outside the fixed list, or none", async () => {
    expect(await report({ reason: "BORING" })).to.have.status(400);
    expect(await report({})).to.have.status(400);
    expect(await Report.countDocuments()).to.equal(0);
  });

  it("refuses details over the length limit", async () => {
    const res = await report({ reason: "OTHER", details: "x".repeat(1001) });

    expect(res).to.have.status(400);
  });

  it("refuses to report yourself or an unknown reader", async () => {
    expect(await report({ reason: "SPAM" }, me)).to.have.status(400);
    expect(await report({ reason: "SPAM" }, { id: String(new mongoose.Types.ObjectId()) })).to.have.status(404);
  });

  it("limits how many reports one reader can file in an hour", async () => {
    for (let i = 0; i < 10; i++) {
      expect(await report({ reason: "SPAM" })).to.have.status(201);
    }

    const limited = await report({ reason: "SPAM" });

    expect(limited).to.have.status(429);
    expect(await Report.countDocuments()).to.equal(10);
  });

  it("needs a signed-in reader", async () => {
    const res = await api().post(`/users/${them.id}/report`).send({ reason: "SPAM" });

    expect(res).to.have.status(401);
  });
});
