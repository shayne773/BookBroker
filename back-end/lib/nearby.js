// Distance between readers. Trades happen in person, so a reader who has set a
// ZIP code sees only books within their distance (User.maxDistanceMiles) of it,
// each labelled with how far away it is; a book beyond it is hidden rather than
// ranked lower. A reader without a ZIP (an account from before ZIP codes) sees
// every book, with no distances, until they add one.
//
// A book's position is its owner's, copied onto the book as `ownerGeo` so the
// queries run on OfferedBook's 2dsphere index. Positions are ZIP code points,
// and no response carries another reader's ZIP or point: only their place name
// and a distance rounded to whole miles.
import { DEFAULT_DISTANCE_MILES, OfferedBook, User } from "../Data.js";

export const METERS_PER_MILE = 1609.344;
// The radius MongoDB's spherical geometry uses, so a distance worked out here
// agrees with one from $geoNear.
const EARTH_RADIUS_METERS = 6378100;

/**
 * The reader's area: `{ point, miles, place }`, or null when they have no ZIP
 * (or no account).
 */
export async function readerArea(userId) {
  if (!userId) return null;
  const user = await User.findById(userId).select("geo maxDistanceMiles location").lean();
  if (!user?.geo?.coordinates?.length) return null;
  return {
    point: user.geo,
    miles: user.maxDistanceMiles ?? DEFAULT_DISTANCE_MILES,
    place: user.location ?? "",
  };
}

/** Meters between two GeoJSON points along the Earth's surface. */
export function metersBetween(a, b) {
  const [lon1, lat1] = a.coordinates.map((d) => (d * Math.PI) / 180);
  const [lon2, lat2] = b.coordinates.map((d) => (d * Math.PI) / 180);
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The only form in which a distance leaves the server: whole miles, with
// anything under a mile as 0 ("less than 1 mi").
export function displayMiles(meters) {
  const miles = meters / METERS_PER_MILE;
  return miles < 1 ? 0 : Math.round(miles);
}

// displayMiles as an aggregation expression over a distance in meters.
export function displayMilesExpr(meters) {
  const miles = { $divide: [meters, METERS_PER_MILE] };
  return { $cond: [{ $lt: [miles, 1] }, 0, { $round: [miles, 0] }] };
}

/**
 * How far a book or reader at `point` is from `area`, in display miles, or
 * null when either position is unknown.
 */
export function distanceFrom(area, point) {
  if (!area || !point?.coordinates?.length) return null;
  return displayMiles(metersBetween(area.point, point));
}

/** Whether `area` reaches `point`. A reader without an area is unrestricted. */
export function withinReach(area, point) {
  if (!area) return true;
  if (!point?.coordinates?.length) return false;
  return metersBetween(area.point, point) <= area.miles * METERS_PER_MILE;
}

/** An OfferedBook filter for books within `area`; empty without one. */
export function withinArea(area) {
  if (!area) return {};
  const radians = (area.miles * METERS_PER_MILE) / EARTH_RADIUS_METERS;
  return { ownerGeo: { $geoWithin: { $centerSphere: [area.point.coordinates, radians] } } };
}

/**
 * A pipeline's first stage: the books matching `query` within `area`, each
 * with its `distance` in meters. $geoNear must open a pipeline, and its query
 * is not cast, so ids in it must be ObjectIds (marketFilter's are).
 */
export function geoNearStage(area, query) {
  return {
    $geoNear: {
      near: area.point,
      key: "ownerGeo",
      distanceField: "distance",
      maxDistance: area.miles * METERS_PER_MILE,
      spherical: true,
      query,
    },
  };
}

// A pipeline's last stages: the distance as display miles (when there is one)
// and the owner's point removed. Every book listed from a pipeline ends here.
export function presentStages(area) {
  return [
    ...(area ? [{ $set: { distanceMiles: displayMilesExpr("$distance") } }] : []),
    { $unset: ["distance", "ownerGeo"] },
  ];
}

/**
 * Points every book of `userId` at `geo`, their new position; `geo` null takes
 * the position away. Called whenever a reader's ZIP changes.
 */
export async function moveOwnerBooks(userId, geo) {
  await OfferedBook.updateMany(
    { owner: userId },
    geo ? { $set: { ownerGeo: geo } } : { $unset: { ownerGeo: 1 } }
  );
}
