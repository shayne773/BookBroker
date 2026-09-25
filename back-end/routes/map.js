import express from "express";
import { marketFilter } from "../lib/blocks.js";
import { areasWithin, BBOX_MESSAGE, booksInPlace, parseBbox, parseOffset } from "../lib/map.js";
import { genresOnMap, nearestPlaces, parseNear, parseSearch, searchFilter } from "../lib/mapSearch.js";
import { readerArea } from "../lib/nearby.js";

// The map page's API. Mounted in app.js behind authMiddleware. Books are shown
// by their owner's place (lib/map.js), at any distance: the map is for
// exploring, and each book still carries the distance label it has elsewhere.

const router = express.Router();

const PLACE_MAX_LENGTH = 100;

// Where the map looks when a reader without a ZIP gives no `near`: the middle
// of the contiguous United States.
const US_MIDDLE = [-98.6, 39.8];

// The books the map counts and lists for the caller: their market, which leaves
// out their own, locked, blocked and suspended readers' books (lib/blocks.js),
// narrowed by the search in the query string (lib/mapSearch.js). Every route
// below that counts or lists books goes through it, so they agree.
const mapFilter = (req) => searchFilter(req.user.userId, req.search);

// Reads the search from the query string into `req.search`, or answers 400.
const withSearch = (req, res, next) => {
  const { search, error } = parseSearch(req.query);
  if (error) return res.status(400).json({ message: error });
  req.search = search;
  next();
};

// GET /map  where the map opens: `home` is the caller's place, their own ZIP
// point (the one their distances are measured from, sent only to them) and
// their distance in miles, or null for a reader without a ZIP.
router.get("/", async (req, res, next) => {
  try {
    const area = await readerArea(req.user.userId);
    res.json({ home: area ? { place: area.place, point: area.point.coordinates, miles: area.miles } : null });
  } catch (err) {
    next(err);
  }
});

// GET /map/areas?bbox=west,south,east,north&<search>  every place in view with
// books matching the search, as { place, point, count }.
router.get("/areas", withSearch, async (req, res, next) => {
  const boxes = parseBbox(req.query.bbox);
  if (!boxes) return res.status(400).json({ message: BBOX_MESSAGE });

  try {
    res.json({ areas: await areasWithin(boxes, await mapFilter(req)) });
  } catch (err) {
    next(err);
  }
});

// GET /map/area?place=Brooklyn%2C%20NY&offset=0&<search>  a page of the place's
// books matching the search, newest first: { place, books, nextOffset }.
router.get("/area", withSearch, async (req, res, next) => {
  const { place } = req.query;
  const offset = parseOffset(req.query.offset);
  if (typeof place !== "string" || !place.trim() || place.length > PLACE_MAX_LENGTH) {
    return res.status(400).json({ message: "Name a place." });
  }
  if (offset === null) return res.status(400).json({ message: "offset must be a whole number." });

  try {
    const [match, area] = await Promise.all([mapFilter(req), readerArea(req.user.userId)]);
    res.json({ place, ...(await booksInPlace({ place, match, area, offset })) });
  } catch (err) {
    next(err);
  }
});

// GET /map/nearest?<search>&near=longitude,latitude  the places with books
// matching the search, nearest the caller first: { places, placeCount,
// bookCount }, each place { place, point, count } with its distance as the
// book lists give one (lib/mapSearch.js). Distances run from the caller's own
// point; `near`, where their map is looking, is used only without a ZIP.
router.get("/nearest", withSearch, async (req, res, next) => {
  const near = req.query.near === undefined ? US_MIDDLE : parseNear(req.query.near);
  if (!near) return res.status(400).json({ message: "near must be longitude,latitude in degrees." });

  try {
    const [match, area] = await Promise.all([mapFilter(req), readerArea(req.user.userId)]);
    res.json(await nearestPlaces({ match, area, origin: area ? area.point.coordinates : near }));
  } catch (err) {
    next(err);
  }
});

// GET /map/genres  the genres on the caller's market that the map can show,
// alphabetically: what a search can choose its `genre` from.
router.get("/genres", async (req, res, next) => {
  try {
    res.json({ genres: await genresOnMap(await marketFilter(req.user.userId)) });
  } catch (err) {
    next(err);
  }
});

export default router;
