import { expect } from "chai";
import { api, authHeader, createOfferedBook, createUser } from "./helpers.js";
import { Block, OfferedBook, User, WishlistBook } from "../Data.js";
import { NEAREST_PLACES_LIMIT, parseNear, parseSearch, searchFilter } from "../lib/mapSearch.js";
import { lookupZip, placePoint } from "../lib/zipCodes.js";

const BROOKLYN = "11201";
const PARK_SLOPE = "11215"; // also Brooklyn, NY
const MANHATTAN = "10001"; // New York, NY
const HOBOKEN = "07030"; // Hoboken, NJ
const CHICAGO = "60614";

const US_VIEW = "-125,24,-66,50";
const DAY = 24 * 60 * 60 * 1000;

const get = async (user, path) => api().get(path).set(await authHeader(user));
const query = (search) => new URLSearchParams(search).toString();
const titles = async (filter) => (await OfferedBook.find(filter).select("title").lean()).map((b) => b.title).sort();

describe("reading a map search", () => {
  it("keeps only the terms given, trimmed", () => {
    expect(parseSearch({})).to.deep.equal({ search: {} });
    expect(
      parseSearch({
        q: "  dune ",
        genre: "Science Fiction",
        author: "Herbert",
        from: "1960",
        to: "1970",
        listed: "week",
        wishlist: "1",
        bbox: "ignored",
      })
    ).to.deep.equal({
      search: { q: "dune", genre: "Science Fiction", author: "Herbert", from: "1960", to: "1970", listed: "week", wishlist: true },
    });
    expect(parseSearch({ q: "   ", genre: "", from: "", listed: "", wishlist: "" })).to.deep.equal({ search: {} });
  });

  it("refuses terms it cannot read", () => {
    for (const bad of [
      { q: ["a", "b"] },
      { genre: "x".repeat(101) },
      { from: "70" },
      { to: "1970s" },
      { from: "1990", to: "1980" },
      { listed: "year" },
      { listed: ["week"] },
      { wishlist: "yes" },
    ]) {
      expect(parseSearch(bad), JSON.stringify(bad)).to.have.property("error").that.is.a("string");
    }
  });

  it("reads where the map is looking, wrapping a longitude panned round the world", () => {
    expect(parseNear("-73.9,40.7")).to.deep.equal([-73.9, 40.7]);
    expect(parseNear("286.1,40.7")[0]).to.be.closeTo(-73.9, 1e-9);
    for (const bad of [undefined, "", "1", "a,b", "1,", "0,91"]) expect(parseNear(bad), String(bad)).to.equal(null);
  });
});

describe("the map search filter", () => {
  let reader;
  let owner;

  beforeEach(async () => {
    reader = await createUser();
    owner = await createUser({ zip: PARK_SLOPE });
    const book = (fields) => createOfferedBook(owner, fields);
    await book({ title: "Dune", author: "Frank Herbert", publisher: "Chilton", year: "1965", genre: "Science Fiction", isbn: "9780441013593" });
    await book({ title: "Emma", author: "Jane Austen", publisher: "John Murray", year: "1815", genre: "Classics", isbn: "9780141439587" });
    await book({ title: "Neuromancer", author: "William Gibson", publisher: "Ace", year: "1984", genre: "Science Fiction", isbn: "9780441569595", createdAt: new Date(Date.now() - 20 * DAY) });
    await book({ title: "Old Stock", author: "Anon", publisher: "Nobody", year: "", genre: "Classics", isbn: "", createdAt: new Date(Date.now() - 90 * DAY) });
    await book({ title: "C++ (2nd ed.)", author: "Bjarne Stroustrup", publisher: "Addison-Wesley", year: "1991", genre: "Computers", isbn: "9780201539929" });
  });

  const find = async (search, options) => titles(await searchFilter(reader._id, search, options));

  it("is the reader's whole market without a search", async () => {
    await createOfferedBook(reader, { title: "Mine" });
    expect(await find({})).to.deep.equal(["C++ (2nd ed.)", "Dune", "Emma", "Neuromancer", "Old Stock"]);
  });

  it("matches a keyword in the title, author, publisher or ISBN, ignoring case", async () => {
    expect(await find({ q: "dune" })).to.deep.equal(["Dune"]);
    expect(await find({ q: "AUSTEN" })).to.deep.equal(["Emma"]);
    expect(await find({ q: "chilton" })).to.deep.equal(["Dune"]);
    expect(await find({ q: "0441" })).to.deep.equal(["Dune", "Neuromancer"]);
    expect(await find({ q: "978-0-14-143958-7" })).to.deep.equal(["Emma"]);
    expect(await find({ q: "nothing like it" })).to.deep.equal([]);
  });

  it("escapes the keyword and the author, so they match only as written", async () => {
    expect(await find({ q: "C++ (2nd" })).to.deep.equal(["C++ (2nd ed.)"]);
    expect(await find({ q: ".*" })).to.deep.equal([]);
    expect(await find({ author: "^B" })).to.deep.equal([]);
    expect(await find({ author: "(a+)+$" })).to.deep.equal([]);
  });

  it("filters by genre exactly", async () => {
    expect(await find({ genre: "Science Fiction" })).to.deep.equal(["Dune", "Neuromancer"]);
    expect(await find({ genre: "Science" })).to.deep.equal([]);
  });

  it("filters by author, anywhere in it", async () => {
    expect(await find({ author: "gibson" })).to.deep.equal(["Neuromancer"]);
  });

  it("filters by publication years, inclusive, leaving out books without one", async () => {
    expect(await find({ from: "1965", to: "1984" })).to.deep.equal(["Dune", "Neuromancer"]);
    expect(await find({ from: "1985" })).to.deep.equal(["C++ (2nd ed.)"]);
    expect(await find({ to: "1900" })).to.deep.equal(["Emma"]);
  });

  it("filters by how recently a book was listed", async () => {
    expect(await find({ listed: "week" })).to.deep.equal(["C++ (2nd ed.)", "Dune", "Emma"]);
    expect(await find({ listed: "month" })).to.deep.equal(["C++ (2nd ed.)", "Dune", "Emma", "Neuromancer"]);
    expect(await find({ listed: "week" }, { now: new Date(Date.now() + 30 * DAY) })).to.deep.equal([]);
  });

  it("filters to the books matching the reader's wishlist, and to none without one", async () => {
    expect(await find({ wishlist: true })).to.deep.equal([]);
    await WishlistBook.create({ userId: reader._id, title: "Emma", isbn: "9780141439587" });
    await WishlistBook.create({ userId: reader._id, title: "Untracked", isbn: "" });
    expect(await find({ wishlist: true })).to.deep.equal(["Emma"]);
  });

  it("combines every term", async () => {
    expect(await find({ genre: "Science Fiction", from: "1980" })).to.deep.equal(["Neuromancer"]);
    expect(await find({ genre: "Science Fiction", listed: "week" })).to.deep.equal(["Dune"]);
    expect(await find({ q: "a", author: "austen", genre: "Classics", to: "1900" })).to.deep.equal(["Emma"]);
    await WishlistBook.create({ userId: reader._id, title: "Dune", isbn: "9780441013593" });
    // The keyword's ISBN and the wishlist's ISBNs are separate conditions.
    expect(await find({ q: "0441", wishlist: true })).to.deep.equal(["Dune"]);
    expect(await find({ q: "Emma", wishlist: true })).to.deep.equal([]);
  });

  it("never lets a search reach the reader's own, locked, blocked or suspended readers' books", async () => {
    await createOfferedBook(reader, { title: "Dune (mine)", genre: "Science Fiction" });
    await createOfferedBook(owner, { title: "Dune (locked)", genre: "Science Fiction", locked: true });
    const blocked = await createUser();
    await createOfferedBook(blocked, { title: "Dune (blocked)", genre: "Science Fiction" });
    await Block.create({ blocker: blocked._id, blocked: reader._id });
    const suspended = await createUser({ suspended: true });
    await createOfferedBook(suspended, { title: "Dune (suspended)", genre: "Science Fiction" });

    expect(await find({ q: "dune", genre: "Science Fiction" })).to.deep.equal(["Dune"]);
  });
});

describe("searching the map", () => {
  let viewer;
  let brooklyn;
  let parkSlope;
  let manhattan;
  let hoboken;
  let chicago;

  beforeEach(async () => {
    viewer = await createUser({ zip: BROOKLYN });
    brooklyn = await createUser({ zip: BROOKLYN });
    parkSlope = await createUser({ zip: PARK_SLOPE });
    manhattan = await createUser({ zip: MANHATTAN });
    hoboken = await createUser({ zip: HOBOKEN });
    chicago = await createUser({ zip: CHICAGO });

    await createOfferedBook(brooklyn, { title: "Brooklyn Mystery", genre: "Mystery" });
    await createOfferedBook(brooklyn, { title: "Brooklyn Poems", genre: "Poetry" });
    await createOfferedBook(parkSlope, { title: "Park Slope Mystery", genre: "Mystery" });
    await createOfferedBook(manhattan, { title: "Manhattan Mystery", genre: "Mystery" });
    await createOfferedBook(hoboken, { title: "Hoboken Poems", genre: "Poetry" });
    await createOfferedBook(chicago, { title: "Chicago Mystery", genre: "Mystery" });
    await createOfferedBook(chicago, { title: "Chicago Mystery 2", genre: "Mystery" });
  });

  const areas = async (user, search) => (await get(user, `/map/areas?bbox=${US_VIEW}&${query(search)}`)).body.areas;
  const nearest = async (user, search, near) =>
    (await get(user, `/map/nearest?${query(search)}${near ? `&near=${near}` : ""}`)).body;
  const placeBooks = async (user, place, search) =>
    (await get(user, `/map/area?place=${encodeURIComponent(place)}&${query(search)}`)).body.books;

  it("counts only the matching books on the markers, and leaves places with none off the map", async () => {
    expect((await areas(viewer, { genre: "Mystery" })).map((a) => [a.place, a.count])).to.deep.equal([
      ["Brooklyn, NY", 2],
      ["Chicago, IL", 2],
      ["New York, NY", 1],
    ]);
    expect(await areas(viewer, { q: "nothing like it" })).to.deep.equal([]);
  });

  it("agrees on the matching books between the markers, a place's panel and the nearest places", async () => {
    for (const search of [{}, { genre: "Mystery" }, { q: "poems" }, { q: "brooklyn", genre: "Poetry" }]) {
      const onMap = await areas(viewer, search);
      const { places, placeCount, bookCount } = await nearest(viewer, search);
      expect(places.map((p) => [p.place, p.count]).sort(), JSON.stringify(search)).to.deep.equal(
        onMap.map((a) => [a.place, a.count])
      );
      expect(placeCount).to.equal(onMap.length);
      expect(bookCount).to.equal(onMap.reduce((sum, a) => sum + a.count, 0));
      for (const { place, count } of onMap) {
        expect(await placeBooks(viewer, place, search), `${place} ${JSON.stringify(search)}`).to.have.lengthOf(count);
      }
    }
    expect((await placeBooks(viewer, "Brooklyn, NY", { genre: "Mystery" })).map((b) => b.title)).to.deep.equal([
      "Park Slope Mystery",
      "Brooklyn Mystery",
    ]);
  });

  it("lists the matching places nearest the reader first, with the distances the book lists give", async () => {
    const { places } = await nearest(viewer, {});
    expect(places.map((p) => p.place)).to.deep.equal(["Brooklyn, NY", "New York, NY", "Hoboken, NJ", "Chicago, IL"]);

    const [brooklynPlace, newYork, hobokenPlace, chicagoPlace] = places;
    expect(brooklynPlace).to.deep.equal({ place: "Brooklyn, NY", point: placePoint("Brooklyn, NY"), count: 3, distanceMiles: 0 });
    // A place is as far as its nearest matching book, as that book is labelled.
    const [manhattanBook] = await placeBooks(viewer, "New York, NY", {});
    expect(newYork.distanceMiles).to.equal(manhattanBook.distanceMiles).and.to.be.above(0);
    expect(hobokenPlace.distanceMiles).to.be.at.least(newYork.distanceMiles);
    expect(chicagoPlace).to.deep.equal({
      place: "Chicago, IL",
      point: placePoint("Chicago, IL"),
      count: 2,
      distanceLabel: "More than 25 mi away",
    });

    // The search moves which places are nearest.
    expect((await nearest(viewer, { genre: "Poetry" })).places.map((p) => p.place)).to.deep.equal([
      "Brooklyn, NY",
      "Hoboken, NJ",
    ]);
  });

  it("orders the places beyond the reader's distance by their place points", async () => {
    const la = await createUser({ zip: "90012" });
    await createOfferedBook(la, { title: "Los Angeles Mystery", genre: "Mystery" });
    const boston = await createUser({ zip: "02108" });
    await createOfferedBook(boston, { title: "Boston Mystery", genre: "Mystery" });
    await User.updateOne({ _id: viewer._id }, { maxDistanceMiles: 5 });

    const { places } = await nearest(viewer, { genre: "Mystery" });
    expect(places.map((p) => [p.place, p.distanceMiles ?? p.distanceLabel])).to.deep.equal([
      ["Brooklyn, NY", 0],
      ["New York, NY", places[1].distanceMiles],
      ["Boston, MA", "More than 5 mi away"],
      ["Chicago, IL", "More than 5 mi away"],
      ["Los Angeles, CA", "More than 5 mi away"],
    ]);
    expect(places[1].distanceMiles).to.be.a("number");
  });

  it("measures from where the map is looking for a reader without a ZIP, with no distances", async () => {
    const legacy = await createUser({ zip: null });
    const fromChicago = await nearest(legacy, { genre: "Mystery" }, "-87.6,41.9");
    expect(fromChicago.places).to.deep.equal([
      { place: "Chicago, IL", point: placePoint("Chicago, IL"), count: 2 },
      { place: "New York, NY", point: placePoint("New York, NY"), count: 1 },
      { place: "Brooklyn, NY", point: placePoint("Brooklyn, NY"), count: 2 },
    ]);
    const fromNewYork = await nearest(legacy, { genre: "Mystery" }, "-73.98,40.76");
    expect(fromNewYork.places.map((p) => p.place)).to.deep.equal(["New York, NY", "Brooklyn, NY", "Chicago, IL"]);

    // A reader with a ZIP is always measured from their own point.
    const fromViewer = await nearest(viewer, { genre: "Mystery" }, "-87.6,41.9");
    expect(fromViewer.places[0].place).to.equal("Brooklyn, NY");
  });

  it("says plainly when nothing matches anywhere", async () => {
    expect(await nearest(viewer, { q: "nothing like it" })).to.deep.equal({ places: [], placeCount: 0, bookCount: 0 });
  });

  it("lists at most a bounded number of places, counting them all", async () => {
    // One book in each of more places than are listed.
    const places = new Set();
    for (let zip = 10002; places.size < NEAREST_PLACES_LIMIT + 2; zip += 1) {
      const where = lookupZip(String(zip));
      if (!where || places.has(where.place) || !placePoint(where.place)) continue;
      places.add(where.place);
      await createOfferedBook(await createUser({ zip: String(zip) }), { title: "Everywhere" });
    }

    const found = await nearest(viewer, { q: "everywhere" });
    expect(found.places).to.have.lengthOf(NEAREST_PLACES_LIMIT);
    expect(found.placeCount).to.equal(NEAREST_PLACES_LIMIT + 2);
    expect(found.bookCount).to.equal(NEAREST_PLACES_LIMIT + 2);
  });

  it("keeps the reader's own, locked, blocked and suspended readers' books out of every result", async () => {
    await createOfferedBook(viewer, { title: "Mine", genre: "Mystery" });
    await createOfferedBook(brooklyn, { title: "Locked", genre: "Mystery", locked: true });
    const blocked = await createUser({ zip: HOBOKEN });
    await createOfferedBook(blocked, { title: "Blocked", genre: "Mystery" });
    await Block.create({ blocker: viewer._id, blocked: blocked._id });
    const suspended = await createUser({ zip: HOBOKEN, suspended: true });
    await createOfferedBook(suspended, { title: "Suspended", genre: "Mystery" });

    const search = { genre: "Mystery" };
    const expected = [
      ["Brooklyn, NY", 2],
      ["Chicago, IL", 2],
      ["New York, NY", 1],
    ];
    expect((await areas(viewer, search)).map((a) => [a.place, a.count])).to.deep.equal(expected);
    expect((await nearest(viewer, search)).places.map((p) => [p.place, p.count]).sort()).to.deep.equal(expected);
    expect((await placeBooks(viewer, "Brooklyn, NY", search)).map((b) => b.title)).to.not.include.members([
      "Mine",
      "Locked",
    ]);
    expect(await placeBooks(viewer, "Hoboken, NJ", search)).to.deep.equal([]);
  });

  it("offers the genres on the reader's market", async () => {
    await createOfferedBook(chicago, { title: "Unknown genre", genre: "Unknown" });
    await createOfferedBook(viewer, { title: "Mine", genre: "Travel" });
    await createOfferedBook(chicago, { title: "Locked", genre: "Horror", locked: true });
    expect((await get(viewer, "/map/genres")).body).to.deep.equal({ genres: ["Mystery", "Poetry"] });
  });

  it("refuses a search it cannot read, on every endpoint", async () => {
    for (const path of [
      `/map/areas?bbox=${US_VIEW}&from=1990&to=1980`,
      "/map/area?place=Brooklyn%2C%20NY&listed=year",
      "/map/nearest?wishlist=yes",
      "/map/nearest?near=north",
    ]) {
      const res = await get(viewer, path);
      expect(res, path).to.have.status(400);
      expect(res.body.message, path).to.be.a("string");
    }
  });

  it("needs a signed-in reader", async () => {
    expect(await api().get("/map/nearest")).to.have.status(401);
    expect(await api().get("/map/genres")).to.have.status(401);
  });

  it("never sends a reader's ZIP code or position in the nearest places", async () => {
    const body = JSON.stringify(await nearest(viewer, {}, "-80,40"));
    expect(body).to.not.match(/ownerGeo|ownerPlace|"geo"|"zip"|coordinates|"owner"/);
    for (const zip of [BROOKLYN, PARK_SLOPE, MANHATTAN, CHICAGO]) {
      const [longitude, latitude] = lookupZip(zip).point.coordinates;
      expect(body).to.not.include(`"${zip}"`);
      expect(body).to.not.include(String(latitude));
      expect(body).to.not.include(String(longitude));
    }
  });
});
