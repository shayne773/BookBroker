import { expect } from "chai";
import mongoose from "mongoose";
import { api, authHeader, createOfferedBook, createUser } from "./helpers.js";
import { WishlistBook } from "../Data.js";

// A visitor without an account browses the market: the book lists, book pages,
// readers' public profiles and the map. They have no ZIP, so they see every
// book on the market with no distances, and nothing private reaches them.
describe("browsing without an account", () => {
  let brooklyn;
  let chicago;
  let nearBook;
  let farBook;

  beforeEach(async () => {
    brooklyn = await createUser({ zip: "11201", email: "brooklyn.reader@example.com" });
    chicago = await createUser({ zip: "60614", email: "chicago.reader@example.com" });
    nearBook = await createOfferedBook(brooklyn, { title: "Near Book", author: "Ann Near", genre: "Mystery" });
    farBook = await createOfferedBook(chicago, { title: "Far Book", author: "Bo Far", genre: "Mystery" });
    await createOfferedBook(chicago, { title: "Locked Book", locked: true });
    await WishlistBook.create({ userId: chicago._id, title: "Wanted", isbn: "9780261103344" });
  });

  const titles = (books) => books.map((b) => b.title).sort();

  // Nothing that could place or contact a reader: no email address, ZIP code,
  // position or distance.
  const expectNothingPrivate = (body) => {
    const text = JSON.stringify(body);
    for (const secret of [brooklyn.email, chicago.email, "11201", "60614"]) {
      expect(text).to.not.include(secret);
    }
    expect(text).to.not.match(/"(email|zip|geo|ownerGeo|ownerPlace|ownerPlacePoint|password|distanceMiles|distanceLabel|coordinates)"/);
  };

  it("reads every list on the market, at any distance, without distances", async () => {
    for (const path of ["/feed", "/new", "/popular", "/genres/Mystery", "/books?query=book"]) {
      const res = await api().get(path);
      expect(res, path).to.have.status(200);
      expect(titles(res.body), path).to.deep.equal(["Far Book", "Near Book"]);
      expectNothingPrivate(res.body);
    }

    expect((await api().get("/genres")).body).to.include("Mystery");
  });

  it("reads the browse page, with no area of their own", async () => {
    const res = await api().get("/browse?q=far");

    expect(res).to.have.status(200);
    expect(res.body.area).to.equal(null);
    expect(titles(res.body.searchResults)).to.deep.equal(["Far Book"]);
    expect(titles(res.body.newlyAdded)).to.deep.equal(["Far Book", "Near Book"]);
    expectNothingPrivate(res.body);
  });

  it("opens a book page, naming its owner by their place only", async () => {
    const res = await api().get(`/books/${farBook._id}`);

    expect(res).to.have.status(200);
    expect(res.body.owner).to.deep.equal({
      id: String(chicago._id),
      username: chicago.username,
      location: chicago.location,
    });
    expectNothingPrivate(res.body);
  });

  it("opens a reader's public profile, wishlist and offerings", async () => {
    const profile = await api().get(`/users/${chicago._id}`);
    expect(profile).to.have.status(200);
    expect(profile.body).to.include({ username: chicago.username, blockedByMe: false });
    expectNothingPrivate(profile.body);

    const wishlist = await api().get(`/users/${chicago._id}/wishlist`);
    expect(wishlist).to.have.status(200);
    expect(titles(wishlist.body)).to.deep.equal(["Wanted"]);

    const offered = await api().get(`/users/${chicago._id}/offered`);
    expect(offered).to.have.status(200);
    expect(titles(offered.body)).to.deep.equal(["Far Book"]);
    expectNothingPrivate(offered.body);
  });

  it("reads a token that names no session as a visitor on these pages", async () => {
    const res = await api("not-a-session").get("/feed");

    expect(res).to.have.status(200);
    expect(titles(res.body)).to.deep.equal(["Far Book", "Near Book"]);
  });

  it("leaves a signed-in reader's distance as it was", async () => {
    const viewer = await createUser({ zip: "11201" });

    const res = await api().get("/feed").set(await authHeader(viewer));

    expect(titles(res.body)).to.deep.equal(["Near Book"]);
    expect(res.body[0]).to.have.property("distanceMiles", 0);
  });

  it("refuses every read of a reader's own data", async () => {
    for (const path of [
      "/user",
      "/user/wishlist",
      "/user/offered",
      "/user/wishlist/matches",
      "/user/wishlist/9780261103344",
      "/user/blocks",
      "/recommendations",
      "/messages",
      "/messages/unread",
      `/messages/${chicago._id}`,
      "/exchanges",
      `/exchanges/${new mongoose.Types.ObjectId()}`,
      "/google-books/search?q=hobbit",
      "/admin/reports",
    ]) {
      expect(await api().get(path), path).to.have.status(401);
    }
  });

  it("refuses every write", async () => {
    const exchange = new mongoose.Types.ObjectId();
    const writes = [
      ["post", "/user/add-wishlist-book", { title: "Dune", isbn: "9780441013593" }],
      ["post", "/user/add-offered-book", { title: "Dune", isbn: "9780441013593" }],
      ["post", "/user/edit", { location: "Anywhere" }],
      ["post", "/user/notifications", { messages: false }],
      ["post", "/user/delete", {}],
      ["delete", `/user/wishlist/${new mongoose.Types.ObjectId()}`],
      ["delete", `/user/offered/${nearBook._id}`],
      ["post", `/messages/${chicago._id}`, { content: "Hello" }],
      ["post", `/messages/${chicago._id}/read`, {}],
      ["post", "/exchanges", { recipient: String(chicago._id), recipientBook: String(farBook._id) }],
      ["post", `/exchanges/${exchange}/counter`, {}],
      ["post", `/exchanges/${exchange}/accept`, {}],
      ["post", `/exchanges/${exchange}/decline`, {}],
      ["post", `/exchanges/${exchange}/cancel`, {}],
      ["post", `/exchanges/${exchange}/confirm-complete`, {}],
      ["post", `/exchanges/${exchange}/rate`, { rating: 5 }],
      ["post", `/users/${chicago._id}/report`, { reason: "SPAM" }],
      ["post", `/users/${chicago._id}/block`, {}],
      ["delete", `/users/${chicago._id}/block`],
    ];

    for (const [method, path, body] of writes) {
      const request = api()[method](path);
      const res = body ? await request.send(body) : await request;
      expect(res, `${method.toUpperCase()} ${path}`).to.have.status(401);
    }
  });
});
