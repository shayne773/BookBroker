import { expect } from "chai";
import { api, authHeader, createOfferedBook, createUser, signUp } from "./helpers.js";
import { Block, OfferedBook, User } from "../Data.js";
import { parseBbox } from "../lib/map.js";
import { placeAllBooks } from "../scripts/place-books.js";
import { lookupZip, placePoint } from "../lib/zipCodes.js";

// Brooklyn has 47 ZIP codes, so its place point is none of them.
const BROOKLYN = "11201";
const PARK_SLOPE = "11215"; // also Brooklyn, NY
const MANHATTAN = "10001"; // New York, NY
const CHICAGO = "60614";
const ADAK = "99546"; // Adak, AK: west of the antimeridian's neighbourhood, at -176.6

// Views as "west,south,east,north".
const NEW_YORK_VIEW = "-74.3,40.5,-73.7,40.95";
const US_VIEW = "-125,24,-66,50";

const get = async (user, path) => api().get(path).set(await authHeader(user));
const areasIn = async (user, bbox) => (await get(user, `/map/areas?bbox=${bbox}`)).body.areas;
const areaBooks = async (user, place, offset) =>
  (await get(user, `/map/area?place=${encodeURIComponent(place)}${offset ? `&offset=${offset}` : ""}`)).body;

describe("place points", () => {
  it("are the mean of the place's ZIP code points, not any one of them", () => {
    expect(placePoint("Brooklyn, NY")).to.deep.equal([-73.955, 40.652]);
    expect(placePoint("Brooklyn, NY")).to.not.deep.equal(lookupZip(BROOKLYN).point.coordinates);
    expect(placePoint("Hoboken, NJ")).to.deep.equal(lookupZip("07030").point.coordinates);
    expect(placePoint("Nowhere, ZZ")).to.equal(null);
  });
});

describe("map views", () => {
  it("are read as west,south,east,north, split across the antimeridian", () => {
    expect(parseBbox("-74,40,-73,41")).to.deep.equal([[[-74, 40], [-73, 41]]]);
    expect(parseBbox("170,50,190,55")).to.deep.equal([
      [[170, 50], [180, 55]],
      [[-180, 50], [-170, 55]],
    ]);
    expect(parseBbox("-434,40,-433,41")).to.deep.equal([[[-74, 40], [-73, 41]]]);
    expect(parseBbox("-500,-100,500,100")).to.deep.equal([[[-180, -90], [180, 90]]]);
  });

  it("refuse anything else", async () => {
    const reader = await createUser();
    for (const bbox of [undefined, "", "1,2,3", "a,b,c,d", "1,2,,4", "10,0,0,10", "0,10,10,0"]) {
      const res = await get(reader, bbox === undefined ? "/map/areas" : `/map/areas?bbox=${bbox}`);
      expect(res, String(bbox)).to.have.status(400);
      expect(res.body.message).to.equal("bbox must be west,south,east,north in degrees.");
    }
  });
});

describe("the map", () => {
  let viewer;
  let brooklyn;
  let parkSlope;
  let manhattan;
  let chicago;

  beforeEach(async () => {
    viewer = await createUser({ zip: BROOKLYN });
    brooklyn = await createUser({ zip: BROOKLYN });
    parkSlope = await createUser({ zip: PARK_SLOPE });
    manhattan = await createUser({ zip: MANHATTAN });
    chicago = await createUser({ zip: CHICAGO });

    await createOfferedBook(brooklyn, { title: "Brooklyn 1" });
    await createOfferedBook(brooklyn, { title: "Brooklyn 2" });
    await createOfferedBook(parkSlope, { title: "Park Slope" });
    await createOfferedBook(manhattan, { title: "Manhattan" });
    await createOfferedBook(chicago, { title: "Chicago", cover: "https://example.com/c.jpg" });
  });

  it("needs a signed-in reader", async () => {
    expect(await api().get(`/map/areas?bbox=${US_VIEW}`)).to.have.status(401);
    expect(await api().get("/map/area?place=Brooklyn%2C%20NY")).to.have.status(401);
    expect(await api().get("/map")).to.have.status(401);
  });

  it("counts the books in view by place, each at its place's point", async () => {
    expect(await areasIn(viewer, NEW_YORK_VIEW)).to.deep.equal([
      { place: "Brooklyn, NY", point: placePoint("Brooklyn, NY"), count: 3 },
      { place: "New York, NY", point: placePoint("New York, NY"), count: 1 },
    ]);

    const us = await areasIn(viewer, US_VIEW);
    expect(us.map((a) => [a.place, a.count])).to.deep.equal([
      ["Brooklyn, NY", 3],
      ["Chicago, IL", 1],
      ["New York, NY", 1],
    ]);
  });

  it("shows places at any distance, across the antimeridian too", async () => {
    const adak = await createUser({ zip: ADAK });
    await createOfferedBook(adak, { title: "Aleutian" });

    for (const bbox of ["170,50,190,55", "-190,50,-170,55", "-180,-90,180,90"]) {
      const places = (await areasIn(viewer, bbox)).map((a) => a.place);
      expect(places, bbox).to.include("Adak, AK");
    }
    expect((await areasIn(viewer, "170,50,175,55")).map((a) => a.place)).to.deep.equal([]);
  });

  it("lists a place's books newest first, with the distance labels used everywhere else", async () => {
    const brooklynBooks = await areaBooks(viewer, "Brooklyn, NY");
    expect(brooklynBooks.place).to.equal("Brooklyn, NY");
    expect(brooklynBooks.books.map((b) => b.title)).to.deep.equal(["Park Slope", "Brooklyn 2", "Brooklyn 1"]);
    expect(brooklynBooks.books.map((b) => b.distanceMiles)).to.deep.equal([2, 0, 0]);
    expect(brooklynBooks.nextOffset).to.equal(null);

    const [far] = (await areaBooks(viewer, "Chicago, IL")).books;
    expect(far).to.include({ title: "Chicago", distanceLabel: "More than 25 mi away" });
    expect(far).to.not.have.property("distanceMiles");
    expect(Object.keys(far)).to.have.members(["_id", "title", "author", "year", "cover", "distanceLabel"]);

    expect((await areaBooks(viewer, "Nowhere, ZZ")).books).to.deep.equal([]);
  });

  it("pages a place's books", async () => {
    for (let i = 0; i < 20; i += 1) {
      await createOfferedBook(manhattan, { title: `More ${i}`, createdAt: new Date(Date.now() + i * 1000) });
    }

    const first = await areaBooks(viewer, "New York, NY");
    expect(first.books).to.have.lengthOf(20);
    expect(first.books[0].title).to.equal("More 19");
    expect(first.nextOffset).to.equal(20);

    const second = await areaBooks(viewer, "New York, NY", first.nextOffset);
    expect(second.books.map((b) => b.title)).to.deep.equal(["Manhattan"]);
    expect(second.nextOffset).to.equal(null);

    for (const offset of ["-1", "x", "1.5", "99999"]) {
      expect(await get(viewer, `/map/area?place=New%20York%2C%20NY&offset=${offset}`), offset).to.have.status(400);
    }
    expect(await get(viewer, "/map/area")).to.have.status(400);
  });

  it("leaves out the reader's own, locked, blocked and suspended readers' books, and books without a place", async () => {
    await createOfferedBook(viewer, { title: "Mine" });
    await createOfferedBook(brooklyn, { title: "Locked", locked: true });
    const blocked = await createUser({ zip: BROOKLYN });
    await createOfferedBook(blocked, { title: "Blocked" });
    await Block.create({ blocker: viewer._id, blocked: blocked._id });
    const blocker = await createUser({ zip: BROOKLYN });
    await createOfferedBook(blocker, { title: "Blocker" });
    await Block.create({ blocker: blocker._id, blocked: viewer._id });
    const suspended = await createUser({ zip: BROOKLYN, suspended: true });
    await createOfferedBook(suspended, { title: "Suspended" });
    const legacy = await createUser({ zip: null, location: "Brooklyn, NY" });
    await createOfferedBook(legacy, { title: "No ZIP" });

    const [area] = await areasIn(viewer, NEW_YORK_VIEW);
    expect(area).to.deep.include({ place: "Brooklyn, NY", count: 3 });
    const listed = (await areaBooks(viewer, "Brooklyn, NY")).books.map((b) => b.title);
    expect(listed).to.have.members(["Park Slope", "Brooklyn 2", "Brooklyn 1"]);
  });

  it("follows a reader who changes ZIP code, and places the books they offer", async () => {
    const mover = await signUp({ zip: CHICAGO });
    await createOfferedBook({ _id: mover.id }, { title: "Moved" });
    expect((await api(mover.token).post("/user/edit").send({ user: { zip: MANHATTAN } }))).to.have.status(200);
    const offered = await api(mover.token)
      .post("/user/add-offered-book")
      .send({ title: "Offered", author: "Tolkien", isbn: "9780261102217", cover: "https://example.com/c.jpg" });
    expect(offered).to.have.status(201);

    const [, newYork] = await areasIn(viewer, NEW_YORK_VIEW);
    expect(newYork).to.deep.equal({ place: "New York, NY", point: placePoint("New York, NY"), count: 3 });
    expect((await areasIn(viewer, US_VIEW)).find((a) => a.place === "Chicago, IL").count).to.equal(1);
  });

  it("opens on the reader's place and distance, or on nothing without a ZIP", async () => {
    await User.updateOne({ _id: viewer._id }, { maxDistanceMiles: 50 });
    expect((await get(viewer, "/map")).body).to.deep.equal({
      home: { place: "Brooklyn, NY", point: placePoint("Brooklyn, NY"), miles: 50 },
    });

    const legacy = await createUser({ zip: null, location: "NYC" });
    expect((await get(legacy, "/map")).body).to.deep.equal({ home: null });
  });

  it("never sends a reader's ZIP code or position", async () => {
    const responses = [
      await get(viewer, "/map"),
      await get(viewer, `/map/areas?bbox=${NEW_YORK_VIEW}`),
      await get(viewer, `/map/areas?bbox=${US_VIEW}`),
      await get(viewer, "/map/area?place=Brooklyn%2C%20NY"),
      await get(viewer, "/map/area?place=New%20York%2C%20NY"),
      await get(viewer, "/map/area?place=Chicago%2C%20IL"),
    ];

    // Every reader here is in a place with many ZIP codes, so no place point is
    // any reader's own.
    const readers = [viewer, brooklyn, parkSlope, manhattan, chicago];
    const zips = await User.find({ _id: { $in: readers.map((r) => r._id) } }).select("zip").lean();
    for (const res of responses) {
      expect(res, res.req.path).to.have.status(200);
      const body = JSON.stringify(res.body);
      expect(body, res.req.path).to.not.match(/ownerGeo|ownerPlace|"geo"|"zip"|coordinates|"owner"/);
      for (const { zip } of zips) {
        const [longitude, latitude] = lookupZip(zip).point.coordinates;
        expect(body, res.req.path).to.not.include(`"${zip}"`);
        expect(body, res.req.path).to.not.include(String(latitude));
        expect(body, res.req.path).to.not.include(String(longitude));
      }
    }
  });

  it("keeps the place fields out of the other book lists", async () => {
    const book = await OfferedBook.findOne({ title: "Brooklyn 1" });
    for (const path of ["/new", "/browse", `/books/${book._id}`]) {
      const body = JSON.stringify((await get(viewer, path)).body);
      expect(body, path).to.not.match(/ownerPlace/);
    }
  });
});

describe("placing existing books", () => {
  it("gives every book its owner's place, and takes it from books whose owner has no ZIP", async () => {
    const owner = await createUser({ zip: PARK_SLOPE });
    const legacy = await createUser({ zip: null });
    const before = await OfferedBook.create({ owner: owner._id, ownerGeo: lookupZip(PARK_SLOPE).point, title: "Old" });
    const stray = await OfferedBook.create({ owner: legacy._id, ownerPlace: "Brooklyn, NY", title: "Stray" });

    expect(await placeAllBooks()).to.equal(2);

    const placed = await OfferedBook.findById(before._id).select("+ownerGeo +ownerPlace +ownerPlacePoint").lean();
    expect(placed).to.deep.include({
      ownerGeo: lookupZip(PARK_SLOPE).point,
      ownerPlace: "Brooklyn, NY",
      ownerPlacePoint: placePoint("Brooklyn, NY"),
    });
    const unplaced = await OfferedBook.findById(stray._id).select("+ownerGeo +ownerPlace +ownerPlacePoint").lean();
    expect(unplaced).to.not.have.any.keys("ownerGeo", "ownerPlace", "ownerPlacePoint");
  });
});
