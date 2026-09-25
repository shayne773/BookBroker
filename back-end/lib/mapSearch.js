// Searching the map (routes/map.js). A search is a keyword and filters, read
// from the query string by parseSearch; searchFilter turns it into the one
// OfferedBook filter every map endpoint uses, always on top of the reader's
// market (lib/blocks.js), so the markers' counts, a place's books and the
// nearest places all count the same books.
//
// The map's queries are bounded by their own indexes (the view's box on
// ownerPlacePoint, one place on ownerPlace), so a filter that cannot use an
// index, like a keyword, only narrows what those already bound.
import { OfferedBook } from "../Data.js";
import { marketFilter } from "./blocks.js";
import { areasWithin } from "./map.js";
import { wishlistIsbns } from "./matches.js";
import { beyondReachLabel, displayMiles, geoNearStage, metersBetween } from "./nearby.js";
import { safeRegex } from "./validation.js";

const TEXT_MAX_LENGTH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

// How recently a book was listed, for `listed`.
export const LISTED_WITHIN_DAYS = { week: 7, month: 30 };

// The query-string keys a search is made of; the front end keeps the same ones
// in the map page's own URL.
const TEXT_KEYS = ["q", "genre", "author"];
const YEAR_KEYS = ["from", "to"];

/**
 * The search in `query` (a request's query string): `{ search }`, with only
 * the terms given, or `{ error }` saying what is wrong with it.
 *
 * - `q`: a keyword, matched in the title, author, publisher or ISBN
 * - `genre`: one genre, exactly (the map offers the genres on the market)
 * - `author`: matched anywhere in the author
 * - `from`, `to`: publication years, inclusive
 * - `listed`: "week" or "month", how recently the book was listed
 * - `wishlist`: "1" for only the books matching the reader's wishlist
 */
export function parseSearch(query) {
  const search = {};

  for (const key of TEXT_KEYS) {
    const value = query[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > TEXT_MAX_LENGTH) {
      return { error: `${key} must be text of at most ${TEXT_MAX_LENGTH} characters.` };
    }
    if (value.trim()) search[key] = value.trim();
  }

  for (const key of YEAR_KEYS) {
    const value = query[key];
    if (value === undefined || value === "") continue;
    if (typeof value !== "string" || !/^\d{4}$/.test(value)) {
      return { error: "Publication years must be four digits." };
    }
    search[key] = value;
  }
  if (search.from && search.to && search.from > search.to) {
    return { error: "The first publication year must not be after the last." };
  }

  const { listed, wishlist } = query;
  if (listed !== undefined && listed !== "") {
    if (typeof listed !== "string" || !Object.hasOwn(LISTED_WITHIN_DAYS, listed)) return { error: "listed must be week or month." };
    search.listed = listed;
  }
  if (wishlist !== undefined && wishlist !== "") {
    if (wishlist !== "1") return { error: "wishlist must be 1." };
    search.wishlist = true;
  }

  return { search };
}

/**
 * The OfferedBook filter for the books `userId` finds with `search`: their
 * market (not their own, locked, or a blocked or suspended reader's) narrowed
 * by every term of the search at once. User text reaches $regex only escaped.
 */
export async function searchFilter(userId, search = {}, { now = new Date() } = {}) {
  const terms = [];

  if (search.q) {
    const pattern = safeRegex(search.q);
    const anyField = [{ title: pattern }, { author: pattern }, { publisher: pattern }, { isbn: pattern }];
    // An ISBN is often written with hyphens or spaces the stored one lacks.
    const isbn = search.q.replace(/[\s-]/g, "");
    if (isbn !== search.q && /^\d+[\dXx]?$/.test(isbn)) anyField.push({ isbn: safeRegex(isbn) });
    terms.push({ $or: anyField });
  }
  if (search.genre) terms.push({ genre: search.genre });
  if (search.author) terms.push({ author: safeRegex(search.author) });
  // Years are stored as four digits (lib/googleBooks.js), so they compare as
  // text; the bounds also leave out a book with no year.
  if (search.from || search.to) {
    terms.push({ year: { $gte: search.from ?? "0000", $lte: search.to ?? "9999" } });
  }
  if (search.listed) {
    terms.push({ createdAt: { $gte: new Date(now.getTime() - LISTED_WITHIN_DAYS[search.listed] * DAY_MS) } });
  }
  if (search.wishlist) terms.push({ isbn: { $in: await wishlistIsbns(userId) } });

  const market = await marketFilter(userId);
  return terms.length ? { ...market, $and: terms } : market;
}

// The whole world as areasWithin's boxes.
const WORLD = [[[-180, -90], [180, 90]]];

// At most this many places are listed nearest first.
export const NEAREST_PLACES_LIMIT = 50;

/**
 * The places with books matching `match`, nearest first, from `origin`
 * (`[longitude, latitude]`: the reader's own point, or where they are looking
 * when they have no ZIP): `{ places, placeCount, bookCount }`, `places` being
 * at most NEAREST_PLACES_LIMIT `{ place, point, count }`, and the counts
 * covering every place.
 *
 * With the reader's `area`, a place with a matching book within their distance
 * comes first, said to be as far as its nearest such book (in the whole miles
 * that book is labelled with); every other place is only "More than N mi away",
 * ordered by its place point. So nothing here is more exact than what the map
 * and the book lists already show. Without an area there are no distances.
 */
export async function nearestPlaces({ match, area, origin }) {
  const [areas, reached] = await Promise.all([
    areasWithin(WORLD, match),
    area
      ? OfferedBook.aggregate([
          geoNearStage(area, match),
          { $group: { _id: "$ownerPlace", distance: { $min: "$distance" } } },
        ])
      : [],
  ]);

  const nearestBook = new Map(reached.map(({ _id, distance }) => [_id, distance]));
  const from = { coordinates: origin };
  const ranked = areas.map((found) => {
    const distance = nearestBook.get(found.place);
    if (distance !== undefined) return { found: { ...found, distanceMiles: displayMiles(distance) }, rank: [0, distance] };
    return {
      found: area ? { ...found, distanceLabel: beyondReachLabel(area) } : found,
      rank: [1, metersBetween(from, { coordinates: found.point })],
    };
  });
  ranked.sort(
    (a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.found.place.localeCompare(b.found.place)
  );

  return {
    places: ranked.slice(0, NEAREST_PLACES_LIMIT).map(({ found }) => found),
    placeCount: areas.length,
    bookCount: areas.reduce((sum, { count }) => sum + count, 0),
  };
}

/**
 * The genres of the books matching `match` that the map can show, in
 * alphabetical order: the choices for a search's `genre`.
 */
export async function genresOnMap(match) {
  const genres = await OfferedBook.aggregate([
    { $match: { ...match, ownerPlacePoint: { $exists: true }, genre: { $nin: [null, "", "Unknown"] } } },
    { $group: { _id: "$genre" } },
    { $sort: { _id: 1 } },
    { $limit: 200 },
  ]);
  return genres.map(({ _id }) => _id);
}

/** The `near` query parameter, "longitude,latitude", as `[longitude, latitude]`, or null. */
export function parseNear(input) {
  if (typeof input !== "string") return null;
  const parts = input.split(",");
  if (parts.length !== 2 || parts.some((part) => part.trim() === "")) return null;
  const [longitude, latitude] = parts.map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(latitude) > 90) return null;
  // A view panned round the world reports a longitude past ±180.
  const wrapped = Math.abs(longitude) <= 180 ? longitude : ((((longitude + 180) % 360) + 360) % 360) - 180;
  return [wrapped, latitude];
}
