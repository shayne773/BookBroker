import { expect } from "chai";
import {
  api,
  authHeader,
  createOfferedBook,
  createUser,
  outbox,
  signUp,
} from "./helpers.js";
import { Block, OfferedBook, User, WishlistBook } from "../Data.js";
import { lookupZip, normalizeZip } from "../lib/zipCodes.js";
import { displayMiles, METERS_PER_MILE } from "../lib/nearby.js";
import { notificationsSettled, wishlistPacing } from "../lib/notifications.js";

// Where the readers in these tests live, and how far each is from Brooklyn
// (11201), where the viewer is.
const BROOKLYN = "11201";
const MANHATTAN = "10001"; // 3.75 mi
const HOBOKEN = "07030"; // 4.19 mi
const FOREST_HILLS = "11375"; // 7.76 mi
const MORRISTOWN = "07960"; // 26.97 mi: just past the default 25
const PRINCETON = "08540"; // 41.02 mi
const CHICAGO = "60614"; // 713.95 mi
const EVANSTON = "60201"; // 9.6 mi from Chicago

// A GET as `user` (a createUser document).
const get = async (user, path) => api().get(path).set(await authHeader(user));
const post = async (user, path, body) => api().post(path).set(await authHeader(user)).send(body);

const ids = (books) => books.map((b) => String(b._id));

describe("ZIP codes", () => {
  it("resolve to a place name and a GeoJSON point from the bundled table", () => {
    expect(lookupZip("11201")).to.deep.equal({
      zip: "11201",
      place: "Brooklyn, NY",
      point: { type: "Point", coordinates: [-73.99, 40.694] },
    });
    expect(lookupZip("94110").place).to.equal("San Francisco, CA");
  });

  it("accept five digits or ZIP+4, trimmed", () => {
    expect(normalizeZip(" 11201 ")).to.equal("11201");
    expect(normalizeZip("11201-1234")).to.equal("11201");
    expect(lookupZip("11201-1234").zip).to.equal("11201");
  });

  it("reject anything that is not a known US ZIP code", () => {
    for (const input of ["", "1120", "112011", "11201-12", "M5V 2T6", "SW1A 1AA", "abcde", "00000", null, 11201]) {
      expect(lookupZip(input), String(input)).to.equal(null);
    }
  });

  it("are refused at sign-up with a clear message", async () => {
    const body = { username: "newreader", email: "zip@example.com", password: "Str0ngPassw0rd" };

    const foreign = await api().post("/auth/register").send({ ...body, zip: "M5V 2T6" });
    expect(foreign).to.have.status(400);
    expect(foreign.body.message).to.equal("Enter a 5-digit US ZIP code.");

    const unknown = await api().post("/auth/register").send({ ...body, zip: "00000" });
    expect(unknown).to.have.status(400);
    expect(unknown.body.message).to.equal("We don't recognise that ZIP code. Check it and try again.");

    const missing = await api().post("/auth/register").send(body);
    expect(missing).to.have.status(400);
    expect(missing.body.message).to.equal("ZIP code is required.");
  });

  it("round distances to whole miles, and anything under a mile to 0", () => {
    expect(displayMiles(0)).to.equal(0);
    expect(displayMiles(0.99 * METERS_PER_MILE)).to.equal(0);
    expect(displayMiles(1.2 * METERS_PER_MILE)).to.equal(1);
    expect(displayMiles(3.75 * METERS_PER_MILE)).to.equal(4);
  });
});

describe("books near the reader", () => {
  let viewer;
  let manhattan;
  let hoboken;
  let forestHills;
  let morristown;
  let chicago;
  let books;

  beforeEach(async () => {
    viewer = await createUser({ zip: BROOKLYN });
    manhattan = await createUser({ zip: MANHATTAN });
    hoboken = await createUser({ zip: HOBOKEN });
    forestHills = await createUser({ zip: FOREST_HILLS });
    morristown = await createUser({ zip: MORRISTOWN });
    chicago = await createUser({ zip: CHICAGO });

    // The nearest is the oldest, so "newest first" and "nearest first" disagree.
    const at = (day) => new Date(`2026-03-0${day}T12:00:00Z`);
    books = {
      manhattan: await createOfferedBook(manhattan, { title: "Hobbit MN", genre: "Fantasy", createdAt: at(1) }),
      hoboken: await createOfferedBook(hoboken, { title: "Hobbit HB", genre: "Fantasy", createdAt: at(2) }),
      forestHills: await createOfferedBook(forestHills, { title: "Hobbit FH", genre: "Fantasy", createdAt: at(3) }),
      morristown: await createOfferedBook(morristown, { title: "Hobbit MT", genre: "Fantasy", createdAt: at(4) }),
      chicago: await createOfferedBook(chicago, { title: "Hobbit CH", genre: "Poetry", createdAt: at(5) }),
    };
  });

  const NEAREST = () => [books.manhattan, books.hoboken, books.forestHills].map((b) => String(b._id));

  it("lists search results within the reader's distance, nearest first, with each distance", async () => {
    const res = await get(viewer, "/books?query=hobbit");

    expect(res).to.have.status(200);
    expect(ids(res.body)).to.deep.equal(NEAREST());
    expect(res.body.map((b) => b.distanceMiles)).to.deep.equal([4, 4, 8]);
  });

  it("lists the feed within the reader's distance, nearest first", async () => {
    const res = await get(viewer, "/feed");

    expect(ids(res.body)).to.deep.equal(NEAREST());
  });

  it("works every browse section within the reader's distance", async () => {
    const res = await get(viewer, "/browse?q=hobbit");

    expect(res).to.have.status(200);
    expect(res.body.area).to.deep.equal({ place: "Brooklyn, NY", miles: 25 });
    expect(ids(res.body.searchResults)).to.deep.equal(NEAREST());
    // Newly added keeps its own order: newest first.
    expect(ids(res.body.newlyAdded)).to.deep.equal(NEAREST().reverse());
    expect(ids(res.body.popular)).to.have.members(NEAREST());
    // Genres come only from nearby books; each row is nearest first.
    expect(res.body.genres).to.deep.equal(["Fantasy"]);
    expect(ids(res.body.genreRows.Fantasy)).to.deep.equal(NEAREST());
    for (const book of [...res.body.searchResults, ...res.body.newlyAdded, ...res.body.popular]) {
      expect(book).to.have.property("distanceMiles").that.is.a("number");
    }
  });

  it("works the public lists within the distance of a signed-in reader", async () => {
    const newest = await get(viewer, "/new");
    expect(ids(newest.body)).to.deep.equal(NEAREST().reverse());

    const genre = await get(viewer, "/genres/fantasy");
    expect(ids(genre.body)).to.deep.equal(NEAREST());

    const genres = await get(viewer, "/genres");
    expect(genres.body).to.deep.equal(["Fantasy"]);

    const popular = await get(viewer, "/popular");
    expect(ids(popular.body)).to.have.members(NEAREST());
  });

  it("ranks most wanted by want-count among nearby books only", async () => {
    const wants = async (isbn, count) => {
      for (let i = 0; i < count; i += 1) {
        const reader = await createUser({ zip: CHICAGO });
        await WishlistBook.create({ userId: reader._id, title: "x", isbn });
      }
    };
    await OfferedBook.updateOne({ _id: books.forestHills._id }, { isbn: "9780000000001" });
    await OfferedBook.updateOne({ _id: books.hoboken._id }, { isbn: "9780000000002" });
    await OfferedBook.updateOne({ _id: books.chicago._id }, { isbn: "9780000000003" });
    await wants("9780000000001", 2);
    await wants("9780000000002", 1);
    await wants("9780000000003", 5); // most wanted, but far away

    const res = await get(viewer, "/popular");

    expect(ids(res.body)).to.deep.equal([
      String(books.forestHills._id),
      String(books.hoboken._id),
      String(books.manhattan._id),
    ]);
    expect(res.body.map((b) => b.wantedBy)).to.deep.equal([2, 1, 0]);
  });

  it("widens and narrows with the reader's distance setting", async () => {
    await User.updateOne({ _id: viewer._id }, { maxDistanceMiles: 50 });
    let res = await get(viewer, "/books?query=hobbit");
    expect(ids(res.body)).to.deep.equal([...NEAREST(), String(books.morristown._id)]);

    await User.updateOne({ _id: viewer._id }, { maxDistanceMiles: 5 });
    res = await get(viewer, "/books?query=hobbit");
    expect(ids(res.body)).to.deep.equal(NEAREST().slice(0, 2));
  });

  it("opens a book beyond the distance from a direct link, saying only that it is farther", async () => {
    const res = await get(viewer, `/books/${books.chicago._id}`);

    expect(res).to.have.status(200);
    expect(res.body).to.not.have.property("distanceMiles");
    expect(res.body.distanceLabel).to.equal("More than 25 mi away");
    expect(res.body.owner).to.deep.equal({
      id: String(chicago._id),
      username: chicago.username,
      location: "Chicago, IL",
    });
  });

  it("gives a book within the distance its miles from a direct link", async () => {
    const res = await get(viewer, `/books/${books.forestHills._id}`);

    expect(res.body.distanceMiles).to.equal(8);
    expect(res.body).to.not.have.property("distanceLabel");
  });

  it("gives the miles to a shelf only within the distance, and a reader's page none", async () => {
    const near = await get(viewer, `/users/${hoboken._id}/offered`);
    expect(near.body.map((b) => b.distanceMiles)).to.deep.equal([4]);
    expect(near.body.every((b) => !("distanceLabel" in b))).to.equal(true);

    const far = await get(viewer, `/users/${chicago._id}/offered`);
    expect(far.body.map((b) => b.distanceLabel)).to.deep.equal(["More than 25 mi away"]);
    expect(far.body.every((b) => !("distanceMiles" in b))).to.equal(true);

    await User.updateOne({ _id: viewer._id }, { maxDistanceMiles: 5 });
    const past = await get(viewer, `/users/${forestHills._id}/offered`);
    expect(past.body.map((b) => b.distanceLabel)).to.deep.equal(["More than 5 mi away"]);

    for (const other of [hoboken, chicago]) {
      const profile = await get(viewer, `/users/${other._id}`);
      expect(profile).to.have.status(200);
      expect(profile.body).to.not.have.any.keys("distanceMiles", "distanceLabel");
    }
  });

  it("matches wishlisted books only within the distance, nearest first", async () => {
    await WishlistBook.create({ userId: viewer._id, title: "The Hobbit", isbn: books.hoboken.isbn });

    const res = await get(viewer, "/user/wishlist/matches");

    expect(res.body).to.have.lengthOf(1);
    expect(ids(res.body[0].offers)).to.deep.equal(NEAREST());
    expect(res.body[0].offers.map((o) => o.distanceMiles)).to.deep.equal([4, 4, 8]);
    expect(res.body[0].offers[0].owner.location).to.equal("New York, NY");
  });

  it("never sends another reader's ZIP code or position", async () => {
    await WishlistBook.create({ userId: viewer._id, title: "The Hobbit", isbn: books.hoboken.isbn });
    const others = [manhattan, hoboken, forestHills, morristown, chicago];

    const responses = [
      await get(viewer, "/browse?q=hobbit"),
      await get(viewer, "/browse"),
      await get(viewer, "/books?query=hobbit"),
      await get(viewer, "/feed"),
      await get(viewer, "/new"),
      await get(viewer, "/popular"),
      await get(viewer, "/genres/fantasy"),
      await get(viewer, "/recommendations"),
      await get(viewer, "/user/wishlist/matches"),
      await get(viewer, `/books/${books.chicago._id}`),
      await api().get(`/books/${books.chicago._id}`),
      await api().get("/new"),
      ...(await Promise.all(others.map((o) => get(viewer, `/users/${o._id}`)))),
      ...(await Promise.all(others.map((o) => get(viewer, `/users/${o._id}/offered`)))),
    ];

    for (const res of responses) {
      expect(res, res.req.path).to.have.status(200);
      const body = JSON.stringify(res.body);
      expect(body, res.req.path).to.not.match(/ownerGeo|"geo"|"zip"|coordinates/);
      for (const other of others) {
        const where = lookupZip((await User.findById(other._id).select("zip").lean()).zip);
        expect(body, res.req.path).to.not.include(`"${where.zip}"`);
        expect(body, res.req.path).to.not.include(String(where.point.coordinates[1]));
      }
    }
  });

  it("shows a reader without a ZIP every book, newest first, with no distances", async () => {
    const legacy = await createUser({ zip: null, location: "NYC" });

    const res = await get(legacy, "/books?query=hobbit");
    expect(ids(res.body)).to.have.lengthOf(5);
    expect(ids(res.body)[0]).to.equal(String(books.chicago._id));
    expect(res.body.every((b) => !("distanceMiles" in b))).to.equal(true);

    const browse = await get(legacy, "/browse");
    expect(browse.body.area).to.equal(null);
    expect(browse.body.genres).to.have.members(["Fantasy", "Poetry"]);

    const me = await get(legacy, "/user");
    expect(me.body).to.include({ location: "NYC", maxDistanceMiles: 25 });
    expect(me.body).to.not.have.property("zip");

    const book = await get(legacy, `/books/${books.chicago._id}`);
    expect(book.body).to.not.have.property("distanceMiles");
  });

  it("keeps the books of a reader without a ZIP from readers who have one, until they add it", async () => {
    const legacy = await createUser({ zip: null });
    const book = await createOfferedBook(legacy, { title: "Hobbit legacy" });
    expect(ids((await get(viewer, "/books?query=hobbit")).body)).to.not.include(String(book._id));

    const res = await post(legacy, "/user/edit", { user: { zip: BROOKLYN } });
    expect(res).to.have.status(200);
    expect(res.body.user).to.include({ zip: BROOKLYN, location: "Brooklyn, NY" });

    const found = (await get(viewer, "/books?query=hobbit")).body;
    expect(ids(found)[0]).to.equal(String(book._id));
    expect(found[0].distanceMiles).to.equal(0);
  });
});

describe("changing ZIP code and distance", () => {
  it("moves the reader's books, and places the ones offered afterwards", async () => {
    const viewer = await createUser({ zip: BROOKLYN });
    const owner = await signUp({ zip: CHICAGO });
    const before = await createOfferedBook({ _id: owner.id }, { title: "Hobbit before" });
    expect((await get(viewer, "/books?query=hobbit")).body).to.deep.equal([]);

    const res = await api(owner.token).post("/user/edit").send({ user: { zip: HOBOKEN } });
    expect(res).to.have.status(200);
    expect(res.body.user).to.include({ zip: HOBOKEN, location: "Hoboken, NJ" });
    expect(res.body.user).to.not.have.property("geo");

    const offered = await api(owner.token)
      .post("/user/add-offered-book")
      .send({ title: "Hobbit after", author: "Tolkien", isbn: "9780261102217", cover: "https://example.com/c.jpg" });
    expect(offered).to.have.status(201);

    const found = (await get(viewer, "/books?query=hobbit")).body;
    expect(found.map((b) => b.title)).to.have.members(["Hobbit before", "Hobbit after"]);
    expect(found.every((b) => b.distanceMiles === 4)).to.equal(true);

    const stored = await OfferedBook.find({ owner: owner.id }).select("+ownerGeo").lean();
    for (const book of stored) {
      expect(book.ownerGeo).to.deep.equal(lookupZip(HOBOKEN).point);
    }
    expect(String(before._id)).to.be.oneOf(stored.map((b) => String(b._id)));
  });

  it("saves a distance from the choices and refuses any other", async () => {
    const reader = await signUp();

    const saved = await api(reader.token).post("/user/edit").send({ user: { maxDistanceMiles: 50 } });
    expect(saved).to.have.status(200);
    expect(saved.body.user.maxDistanceMiles).to.equal(50);

    for (const bad of [30, "50", 0, -5]) {
      const res = await api(reader.token).post("/user/edit").send({ user: { maxDistanceMiles: bad } });
      expect(res, String(bad)).to.have.status(400);
      expect(res.body.message).to.equal("Choose a distance of 5, 10, 25, 50, 100 miles.");
    }
    expect((await api(reader.token).get("/user")).body.maxDistanceMiles).to.equal(50);
  });

  it("allows three ZIP code changes a day, then refuses with a clear message", async () => {
    const reader = await signUp();

    for (const zip of [MANHATTAN, HOBOKEN, BROOKLYN]) {
      const res = await api(reader.token).post("/user/edit").send({ user: { zip } });
      expect(res, zip).to.have.status(200);
    }

    const same = await api(reader.token).post("/user/edit").send({ user: { zip: BROOKLYN, maxDistanceMiles: 50 } });
    expect(same).to.have.status(200);

    const res = await api(reader.token).post("/user/edit").send({ user: { zip: CHICAGO, maxDistanceMiles: 100 } });
    expect(res).to.have.status(429);
    expect(res.body.message).to.equal("You can change your ZIP code 3 times a day. Please try again tomorrow.");
    expect(Number(res.headers["retry-after"])).to.be.above(0);
    const me = (await api(reader.token).get("/user")).body;
    expect(me).to.include({ zip: BROOKLYN, maxDistanceMiles: 50 });

    const other = await signUp({ zip: MANHATTAN });
    expect(await api(other.token).post("/user/edit").send({ user: { zip: HOBOKEN } })).to.have.status(200);
  });

  it("refuses a ZIP code it cannot place, and leaves the old one", async () => {
    const reader = await signUp();

    const res = await api(reader.token).post("/user/edit").send({ user: { zip: "99999" } });
    expect(res).to.have.status(400);
    expect(res.body.message).to.equal("We don't recognise that ZIP code. Check it and try again.");
    expect((await api(reader.token).get("/user")).body.zip).to.equal(BROOKLYN);
  });
});

describe("recommendations", () => {
  let viewer;

  beforeEach(async () => {
    viewer = await createUser({ zip: BROOKLYN });
    // Taste: Le Guin and Fantasy from the wishlist, Poetry from the shelf.
    await WishlistBook.create({ userId: viewer._id, title: "Earthsea", author: "Ursula K. Le Guin", genre: "Fantasy", isbn: "1" });
    await createOfferedBook(viewer, { title: "My poems", author: "Unknown", genre: "Poetry" });
  });

  it("ranks nearby books by shared authors and genres, then want-count, then distance", async () => {
    const near = await createUser({ zip: MANHATTAN });
    const nearer = await createUser({ zip: BROOKLYN });
    const far = await createUser({ zip: PRINCETON });

    const both = await createOfferedBook(near, { title: "Author and genre", author: "Ursula K. Le Guin", genre: "Fantasy" });
    const coAuthor = await createOfferedBook(near, { title: "Co-written", author: "Someone Else, Ursula K. Le Guin", genre: "History" });
    const genreNear = await createOfferedBook(nearer, { title: "Genre, nearer", author: "A", genre: "poetry" });
    const genreFar = await createOfferedBook(near, { title: "Genre, farther", author: "B", genre: "Fantasy" });
    const wanted = await createOfferedBook(near, { title: "No match, wanted", author: "C", genre: "Cooking", isbn: "42" });
    const nothing = await createOfferedBook(near, { title: "No match", author: "D", genre: "Cooking", isbn: "43" });
    await createOfferedBook(far, { title: "Out of reach", author: "Ursula K. Le Guin", genre: "Fantasy" });
    await WishlistBook.create({ userId: far._id, title: "No match, wanted", isbn: "42" });

    const res = await get(viewer, "/recommendations");

    expect(res).to.have.status(200);
    expect(res.body.map((b) => b.title)).to.deep.equal([
      both.title,
      coAuthor.title,
      genreNear.title,
      genreFar.title,
      wanted.title,
      nothing.title,
    ]);
    expect(res.body[0]).to.include({ distanceMiles: 4 });
    expect(res.body[0]).to.not.have.property("tasteScore");
  });

  it("reads authors and genres beginning with $ as text, not as expressions", async () => {
    await WishlistBook.create({ userId: viewer._id, title: "Odd", author: "$$x", genre: "$title", isbn: "3" });
    const near = await createUser({ zip: MANHATTAN });
    const match = await createOfferedBook(near, { title: "Odd match", author: "$$x", genre: "Cooking" });
    const other = await createOfferedBook(near, { title: "$title", author: "E", genre: "History" });

    const res = await get(viewer, "/recommendations");

    expect(res).to.have.status(200);
    expect(res.body.map((b) => b.title)).to.deep.equal([match.title, other.title]);
  });

  it("leaves out the reader's own books and those the market hides from them", async () => {
    const blocked = await createUser({ zip: BROOKLYN });
    const suspended = await createUser({ zip: BROOKLYN, suspended: true });
    const trading = await createUser({ zip: BROOKLYN });
    await Block.create({ blocker: blocked._id, blocked: viewer._id });
    await createOfferedBook(blocked, { title: "Blocked" });
    await createOfferedBook(suspended, { title: "Suspended" });
    await createOfferedBook(trading, { title: "Locked", locked: true });

    const res = await get(viewer, "/recommendations");

    expect(res.body).to.deep.equal([]);
  });

  it("ranks the whole market for a reader without a ZIP, newest first among equals", async () => {
    const legacy = await createUser({ zip: null });
    await WishlistBook.create({ userId: legacy._id, title: "x", author: "Ursula K. Le Guin", isbn: "2" });
    const far = await createUser({ zip: CHICAGO });
    const older = await createOfferedBook(far, { title: "Older", author: "Z", createdAt: new Date("2026-01-01") });
    const newer = await createOfferedBook(far, { title: "Newer", author: "Z", createdAt: new Date("2026-02-01") });
    const match = await createOfferedBook(far, { title: "Match", author: "Ursula K. Le Guin", createdAt: new Date("2025-01-01") });

    const res = await get(legacy, "/recommendations");

    const theirs = new Set([match, newer, older].map((b) => String(b._id)));
    expect(ids(res.body).filter((id) => theirs.has(id))).to.deep.equal([...theirs]);
    expect(res.body.every((b) => !("distanceMiles" in b))).to.equal(true);
  });

  it("is one endpoint: the old ones are gone", async () => {
    expect(await get(viewer, "/user/get-recommended-books")).to.have.status(404);
    expect((await get(viewer, "/browse")).body).to.not.have.property("recommended");
  });
});

describe("wishlist emails by distance", () => {
  const ISBN = "9780261102217";
  const offer = (user) =>
    api(user.token)
      .post("/user/add-offered-book")
      .send({ title: "The Hobbit", author: "Tolkien", isbn: ISBN, cover: "https://example.com/c.jpg" });
  const wish = (user) => WishlistBook.create({ userId: user.id, title: "The Hobbit", isbn: ISBN });
  const emailedTo = async (user) => {
    await notificationsSettled();
    return outbox.filter((m) => m.to === user.email && m.subject === "The Hobbit is available");
  };

  it("go only to readers whose distance reaches the offer", async () => {
    const owner = await signUp({ zip: CHICAGO });
    const neighbour = await signUp({ zip: EVANSTON });
    const faraway = await signUp({ zip: BROOKLYN });
    const legacy = await signUp();
    await User.updateOne({ _id: legacy.id }, { $unset: { zip: 1, geo: 1 } });
    for (const reader of [neighbour, faraway, legacy]) await wish(reader);

    expect(await offer(owner)).to.have.status(201);

    expect(await emailedTo(neighbour)).to.have.length(1);
    expect(await emailedTo(faraway)).to.have.length(0);
    // Without a ZIP a reader sees every match, so they hear of every one.
    expect(await emailedTo(legacy)).to.have.length(1);
  });

  it("follow each reader's own distance", async () => {
    const owner = await signUp({ zip: PRINCETON });
    const wide = await signUp({ zip: BROOKLYN });
    const narrow = await signUp({ zip: BROOKLYN });
    await User.updateOne({ _id: wide.id }, { maxDistanceMiles: 50 });
    await wish(wide);
    await wish(narrow);

    await offer(owner);

    expect(await emailedTo(wide)).to.have.length(1);
    expect(await emailedTo(narrow)).to.have.length(0);
  });

  it("leave out readers beyond reach before the per-offer limit picks whom to email", async () => {
    const owner = await signUp({ zip: CHICAGO });
    const faraway = [await signUp({ zip: BROOKLYN }), await signUp({ zip: MANHATTAN })];
    const neighbour = await signUp({ zip: EVANSTON });
    for (const reader of [...faraway, neighbour]) await wish(reader);

    const maxReaders = wishlistPacing.maxReaders;
    wishlistPacing.maxReaders = 1;
    try {
      await offer(owner);
      expect(await emailedTo(neighbour)).to.have.length(1);
    } finally {
      wishlistPacing.maxReaders = maxReaders;
    }
  });

  it("do not go out for an offer from a reader without a ZIP to readers who have one", async () => {
    const owner = await signUp();
    await User.updateOne({ _id: owner.id }, { $unset: { zip: 1, geo: 1 } });
    const reader = await signUp({ zip: BROOKLYN });
    await wish(reader);

    await offer(owner);

    expect(await emailedTo(reader)).to.have.length(0);
  });
});
