// The map (routes/map.js) counts books by their owner's public place name,
// positioned at that place's point (placePoint in lib/zipCodes.js), so it shows
// nothing about where a reader is beyond the place name every book already
// carries. The books behind a place are listed with the distance labels used
// everywhere else (lib/nearby.js).
import { OfferedBook } from "../Data.js";
import { distanceFields } from "./nearby.js";

export const BBOX_MESSAGE = "bbox must be west,south,east,north in degrees.";
export const AREA_PAGE_SIZE = 20;
// Paging goes by offset; a place with more books than this is not paged further.
const MAX_OFFSET = 1000;

/**
 * The boxes (`[[west, south], [east, north]]`) covering `bbox`, the map's view
 * as "west,south,east,north" in degrees, or null when it is malformed. A view
 * across the antimeridian becomes two boxes; one wider than the world, one.
 */
export function parseBbox(bbox) {
  if (typeof bbox !== "string") return null;
  const parts = bbox.split(",");
  if (parts.length !== 4 || parts.some((part) => part.trim() === "")) return null;
  let [west, south, east, north] = parts.map(Number);
  if (![west, south, east, north].every(Number.isFinite) || west > east || south > north) return null;

  south = Math.max(south, -90);
  north = Math.min(north, 90);
  if (east - west >= 360) return [[[-180, south], [180, north]]];

  // A view that has panned round the world starts past ±180; bring it back.
  const turns = Math.floor((west + 180) / 360);
  west -= turns * 360;
  east -= turns * 360;
  if (east <= 180) return [[[west, south], [east, north]]];
  return [
    [[west, south], [180, north]],
    [[-180, south], [east - 360, north]],
  ];
}

/**
 * The places within `boxes` with books matching `match`: `{ place, point,
 * count }` each, `point` being `[longitude, latitude]`. Nothing else about the
 * books leaves this query.
 */
export function areasWithin(boxes, match) {
  const within = boxes.map((box) => ({ ownerPlacePoint: { $geoWithin: { $box: box } } }));
  return OfferedBook.aggregate([
    { $match: { ...match, ...(within.length === 1 ? within[0] : { $or: within }) } },
    { $group: { _id: "$ownerPlace", point: { $first: "$ownerPlacePoint" }, count: { $sum: 1 } } },
    { $project: { _id: 0, place: "$_id", point: 1, count: 1 } },
    { $sort: { place: 1 } },
  ]);
}

/**
 * One page of the books matching `match` in `place`, newest first:
 * `{ books, nextOffset }`, `nextOffset` null on the last page. Each book says
 * how far it is from `area` (the reader's, lib/nearby.js) as it would anywhere
 * else: in miles within the reader's distance, only "More than N mi away"
 * beyond it.
 */
export async function booksInPlace({ place, match, area, offset = 0 }) {
  const found = await OfferedBook.find({ ...match, ownerPlace: place })
    .select("title author year cover +ownerGeo")
    .sort({ createdAt: -1, _id: -1 })
    .skip(offset)
    .limit(AREA_PAGE_SIZE + 1)
    .lean();

  const more = found.length > AREA_PAGE_SIZE && offset + AREA_PAGE_SIZE <= MAX_OFFSET;
  const books = found.slice(0, AREA_PAGE_SIZE).map(({ ownerGeo, ...book }) => ({
    ...book,
    ...distanceFields(area, ownerGeo),
  }));
  return { books, nextOffset: more ? offset + AREA_PAGE_SIZE : null };
}

/** The `offset` query parameter as a whole number of books to skip, or null. */
export function parseOffset(input) {
  if (input === undefined) return 0;
  if (typeof input !== "string" || !/^\d{1,5}$/.test(input)) return null;
  const offset = Number(input);
  return offset <= MAX_OFFSET ? offset : null;
}
