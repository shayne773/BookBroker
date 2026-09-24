import { expect } from "chai";
import { api, signUp, offerBook } from "./helpers.js";
import { Block, OfferedBook, User, WishlistBook } from "../Data.js";

describe("wishlist matches", () => {
  let reader;
  let owner;

  beforeEach(async () => {
    reader = await signUp();
    owner = await signUp({ zip: "11375" });
  });

  const wish = (user, fields = {}) =>
    WishlistBook.create({
      userId: user.id,
      title: "The Hobbit",
      author: "J. R. R. Tolkien",
      isbn: "9780261102217",
      ...fields,
    });

  const matches = (user = reader) => api(user.token).get("/user/wishlist/matches");

  it("lists other readers' offers of a wishlisted book, matched on ISBN, with their owner", async () => {
    const wanted = await wish(reader);
    const offer = await offerBook(owner, { title: "A different edition title" });
    await User.updateOne({ _id: owner.id }, { $set: { ratingsAvg: 4.5, ratingsCount: 2 } });

    const res = await matches();

    expect(res).to.have.status(200);
    expect(res.body).to.have.lengthOf(1);
    expect(res.body[0].wishlistBook._id).to.equal(String(wanted._id));
    expect(res.body[0].offers.map((o) => o._id)).to.deep.equal([String(offer._id)]);
    expect(res.body[0].offers[0].owner).to.deep.equal({
      _id: owner.id,
      username: owner.username,
      location: "Forest Hills, NY",
      ratingsAvg: 4.5,
      ratingsCount: 2,
    });
  });

  it("does not match on title when the ISBN differs", async () => {
    await wish(reader);
    await offerBook(owner, { isbn: "9780000000001" });

    const res = await matches();

    expect(res.body).to.deep.equal([]);
  });

  it("leaves out wishlist books nobody is offering", async () => {
    await wish(reader);
    const second = await wish(reader, { title: "Dune", isbn: "9780441013593" });
    await offerBook(owner, { title: "Dune", isbn: "9780441013593" });

    const res = await matches();

    expect(res.body.map((m) => m.wishlistBook._id)).to.deep.equal([String(second._id)]);
  });

  it("gathers every reader offering the same book, newest first at the same distance", async () => {
    await wish(reader);
    const another = await signUp({ zip: "11375" });
    const older = await offerBook(owner, { createdAt: new Date("2026-01-01") });
    const newer = await offerBook(another, { createdAt: new Date("2026-02-01") });

    const res = await matches();

    expect(res.body[0].offers.map((o) => o._id)).to.deep.equal([String(newer._id), String(older._id)]);
  });

  it("leaves out the reader's own offers", async () => {
    await wish(reader);
    await offerBook(reader);

    const res = await matches();

    expect(res.body).to.deep.equal([]);
  });

  it("leaves out books locked in an accepted trade", async () => {
    await wish(reader);
    await offerBook(owner, { locked: true });

    const res = await matches();

    expect(res.body).to.deep.equal([]);
  });

  it("leaves out books of a reader blocked in either direction", async () => {
    await wish(reader);
    await offerBook(owner);

    await Block.create({ blocker: reader.id, blocked: owner.id });
    expect((await matches()).body).to.deep.equal([]);

    await Block.deleteMany({});
    await Block.create({ blocker: owner.id, blocked: reader.id });
    expect((await matches()).body).to.deep.equal([]);
  });

  it("answers an empty list when the wishlist carries no ISBN", async () => {
    await wish(reader, { isbn: "" });
    await offerBook(owner, { isbn: "" });

    const res = await matches();

    expect(res).to.have.status(200);
    expect(res.body).to.deep.equal([]);
  });

  it("is not shadowed by GET /user/wishlist/:isbn", async () => {
    const res = await matches();

    expect(res.body).to.be.an("array");
  });

  it("needs a signed-in reader", async () => {
    const res = await api().get("/user/wishlist/matches");

    expect(res).to.have.status(401);
  });

  it("finds offers through the ISBN index", async () => {
    await OfferedBook.syncIndexes();

    const plan = await OfferedBook.find({ isbn: { $in: ["9780261102217"] }, locked: false })
      .explain("queryPlanner");

    expect(JSON.stringify(plan)).to.include("isbn_1_locked_1");
  });
});
