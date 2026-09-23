import { expect } from "chai";
import mongoose from "mongoose";
import { api, signUp, offerBook, TEST_PASSWORD } from "./helpers.js";
import { User, WishlistBook } from "../Data.js";

describe("auth", () => {
  it("POST /auth/register then /auth/login returns a token for the user", async () => {
    const user = await signUp({ username: "ada" });

    expect(user.token).to.be.a("string").that.is.not.empty;
    expect(user.username).to.equal("ada");
  });

  it("POST /auth/register starts a reader unrated, with no legacy ratings field", async () => {
    const user = await signUp();

    const stored = await User.findById(user.id).lean();

    expect(stored).to.include({ ratingsAvg: 0, ratingsCount: 0 });
    expect(stored).to.not.have.property("ratings");
  });

  it("POST /auth/register rejects an email that is already registered", async () => {
    const user = await signUp();

    const res = await api()
      .post("/auth/register")
      .send({ username: "again", email: user.email, password: TEST_PASSWORD, location: "Queens" });

    expect(res).to.have.status(400);
  });

  it("POST /auth/login rejects a wrong password", async () => {
    const user = await signUp();

    const res = await api().post("/auth/login").send({ email: user.email, password: "wrong" });

    expect(res).to.have.status(400);
    expect(res.body).to.not.have.property("token");
  });

  it("a protected route answers 401 without a token", async () => {
    const res = await api().get("/books");

    expect(res).to.have.status(401);
  });

  it("a protected route answers 401 for a token it did not sign", async () => {
    const res = await api("not-a-real-token").get("/books");

    expect(res).to.have.status(401);
  });
});

describe("books", () => {
  let me;
  let other;

  beforeEach(async () => {
    me = await signUp();
    other = await signUp();
  });

  it("GET /books returns other users' books, not my own", async () => {
    await offerBook(me, { title: "Mine" });
    await offerBook(other, { title: "Theirs" });

    const res = await api(me.token).get("/books");

    expect(res).to.have.status(200);
    expect(res).to.be.json;
    expect(res.body.map((b) => b.title)).to.deep.equal(["Theirs"]);
  });

  it("GET /books?query= filters by title or author", async () => {
    await offerBook(other, { title: "Dune", author: "Frank Herbert" });
    await offerBook(other, { title: "Emma", author: "Jane Austen" });

    const res = await api(me.token).get("/books?query=austen");

    expect(res).to.have.status(200);
    expect(res.body.map((b) => b.title)).to.deep.equal(["Emma"]);
  });

  it("GET /books/:id returns the book with its owner", async () => {
    const book = await offerBook(other);

    const res = await api().get(`/books/${book.id}`);

    expect(res).to.have.status(200);
    expect(res).to.be.json;
    expect(res.body).to.include({ _id: book.id, title: "The Hobbit" });
    expect(res.body.owner).to.deep.equal({ id: other.id, username: other.username });
  });

  it("GET /books/:id answers 404 for an id that matches no book", async () => {
    const res = await api().get(`/books/${new mongoose.Types.ObjectId()}`);

    expect(res).to.have.status(404);
  });

  it("GET /genres lists the distinct genres on offer", async () => {
    await offerBook(other, { genre: "Adventure" });
    await offerBook(other, { genre: "Adventure" });
    await offerBook(other, { genre: "Mystery" });

    const res = await api().get("/genres");

    expect(res).to.have.status(200);
    expect(res.body).to.have.members(["Adventure", "Mystery"]);
  });

  it("GET /genres/:genre returns only books of that genre, case-insensitively", async () => {
    await offerBook(other, { title: "Treasure Island", genre: "Adventure" });
    await offerBook(other, { title: "Gaudy Night", genre: "Mystery" });

    const res = await api().get("/genres/adventure");

    expect(res).to.have.status(200);
    expect(res.body.map((b) => b.title)).to.deep.equal(["Treasure Island"]);
  });

  it("GET /feed returns the newest books from other users", async () => {
    await offerBook(me, { title: "Mine" });
    await offerBook(other, { title: "Older", createdAt: new Date("2020-01-01") });
    await offerBook(other, { title: "Newer", createdAt: new Date("2024-01-01") });

    const res = await api(me.token).get("/feed");

    expect(res).to.have.status(200);
    expect(res.body.map((b) => b.title)).to.deep.equal(["Newer", "Older"]);
    expect(res.body[0]).to.include.keys("title", "author", "owner", "isbn");
  });
});

describe("user shelves", () => {
  let me;
  let other;

  beforeEach(async () => {
    me = await signUp();
    other = await signUp();
  });

  it("POST /user/add-wishlist-book adds to my wishlist, read back by GET /user/wishlist", async () => {
    const add = await api(me.token)
      .post("/user/add-wishlist-book")
      .send({ title: "Middlemarch", author: "George Eliot", isbn: "9780141439549" });

    expect(add).to.have.status(201);
    expect(add.body).to.have.property("message", "successfully added wishlist book");

    const list = await api(me.token).get("/user/wishlist");

    expect(list).to.have.status(200);
    expect(list.body).to.have.lengthOf(1);
    expect(list.body[0]).to.include({ title: "Middlemarch", userId: me.id });
  });

  it("POST /user/add-wishlist-book rejects a book without an isbn", async () => {
    const res = await api(me.token)
      .post("/user/add-wishlist-book")
      .send({ title: "Middlemarch", author: "George Eliot" });

    expect(res).to.have.status(400);
    expect(await WishlistBook.countDocuments()).to.equal(0);
  });

  it("POST /user/add-offered-book adds to my offered shelf, read back by GET /user/offered", async () => {
    const add = await api(me.token)
      .post("/user/add-offered-book")
      .send({ title: "Beloved", author: "Toni Morrison", isbn: "9781400033416" });

    expect(add).to.have.status(201);
    expect(add.body).to.have.property("message", "successfully added offered book");

    const list = await api(me.token).get("/user/offered");

    expect(list).to.have.status(200);
    expect(list.body).to.have.lengthOf(1);
    expect(list.body[0]).to.include({ title: "Beloved", owner: me.id });
  });

  it("GET /users/:id/wishlist returns that user's wishlist", async () => {
    await WishlistBook.create({ userId: other.id, title: "Persuasion", isbn: "1" });
    await WishlistBook.create({ userId: me.id, title: "Not theirs", isbn: "2" });

    const res = await api(me.token).get(`/users/${other.id}/wishlist`);

    expect(res).to.have.status(200);
    expect(res.body.map((b) => b.title)).to.deep.equal(["Persuasion"]);
  });

  it("GET /users/:id/offered returns that user's books that are not locked in a trade", async () => {
    await offerBook(other, { title: "Available" });
    await offerBook(other, { title: "Locked", locked: true });

    const res = await api(me.token).get(`/users/${other.id}/offered`);

    expect(res).to.have.status(200);
    expect(res.body.map((b) => b.title)).to.deep.equal(["Available"]);
  });

  it("DELETE /user/offered/:id removes my own book", async () => {
    const book = await offerBook(me);

    const res = await api(me.token).delete(`/user/offered/${book.id}`);

    expect(res).to.have.status(200);
    const list = await api(me.token).get("/user/offered");
    expect(list.body).to.be.empty;
  });

  it("DELETE /user/offered/:id will not remove someone else's book", async () => {
    const book = await offerBook(other);

    const res = await api(me.token).delete(`/user/offered/${book.id}`);

    expect(res).to.have.status(404);
    const list = await api(other.token).get("/user/offered");
    expect(list.body).to.have.lengthOf(1);
  });
});

describe("most wanted", () => {
  let me;
  let seller;

  beforeEach(async () => {
    me = await signUp();
    seller = await signUp();
  });

  // Puts the same book on each reader's wishlist.
  async function wish(readers, fields) {
    for (const reader of readers) await WishlistBook.create({ userId: reader.id, ...fields });
  }

  // An offered book listed `minutesAgo` minutes in the past.
  const listed = (fields, minutesAgo) =>
    offerBook(seller, { ...fields, createdAt: new Date(Date.now() - minutesAgo * 60000) });

  const titles = (res) => res.body.map((b) => b.title);

  it("ranks a book wishlisted by more readers above one wishlisted by fewer", async () => {
    const [a, b, c] = [await signUp(), await signUp(), await signUp()];
    await listed({ title: "Emma", author: "Jane Austen", isbn: "111" }, 3);
    await listed({ title: "Dune", author: "Frank Herbert", isbn: "" }, 2);
    await listed({ title: "Newest, unwanted", isbn: "333" }, 1);
    await wish([a], { title: "Emma", author: "Jane Austen", isbn: "111" });
    // No ISBN on either side: matched on title and author, ignoring case.
    await wish([a, b, c], { title: "dune", author: "FRANK HERBERT" });

    const popular = await api().get("/popular");
    expect(popular).to.have.status(200);
    expect(titles(popular)).to.deep.equal(["Dune", "Emma", "Newest, unwanted"]);

    const browse = await api(me.token).get("/browse");
    expect(browse.body.popular.map((b) => b.title)).to.deep.equal(["Dune", "Emma", "Newest, unwanted"]);
  });

  it("matches on ISBN when both sides have one, not on title", async () => {
    const [a, b] = [await signUp(), await signUp()];
    await listed({ title: "Emma", author: "Jane Austen", isbn: "111" }, 2);
    await listed({ title: "Persuasion", author: "Jane Austen", isbn: "222" }, 1);
    // Same title and author as Emma, but a different edition's ISBN.
    await wish([a, b], { title: "Emma", author: "Jane Austen", isbn: "999" });
    await wish([a], { title: "Some other title", isbn: "111" });

    const res = await api().get("/popular");

    expect(titles(res)).to.deep.equal(["Emma", "Persuasion"]);
  });

  it("leaves out books locked in an accepted trade", async () => {
    const reader = await signUp();
    await listed({ title: "Locked", isbn: "111", locked: true }, 2);
    await listed({ title: "Free", isbn: "222" }, 1);
    await wish([reader], { title: "Locked", isbn: "111" });

    expect(titles(await api().get("/popular"))).to.deep.equal(["Free"]);
    const browse = await api(me.token).get("/browse");
    expect(browse.body.popular.map((b) => b.title)).to.deep.equal(["Free"]);
  });

  it("falls back to newest listings when nothing is wishlisted", async () => {
    await listed({ title: "Oldest", isbn: "1" }, 3);
    await listed({ title: "Newest", isbn: "3" }, 1);
    await listed({ title: "Middle", isbn: "2" }, 2);

    const res = await api().get("/popular");

    expect(res).to.have.status(200);
    expect(titles(res)).to.deep.equal(["Newest", "Middle", "Oldest"]);
  });
});
