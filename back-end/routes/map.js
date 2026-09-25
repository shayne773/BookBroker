import express from "express";
import { marketFilter } from "../lib/blocks.js";
import { areasWithin, BBOX_MESSAGE, booksInPlace, parseBbox, parseOffset } from "../lib/map.js";
import { readerArea } from "../lib/nearby.js";

// The map page's API. Mounted in app.js behind authMiddleware. Books are shown
// by their owner's place (lib/map.js), at any distance: the map is for
// exploring, and each book still carries the distance label it has elsewhere.

const router = express.Router();

const PLACE_MAX_LENGTH = 100;

// The books the map counts and lists for the caller: their market, which leaves
// out their own, locked, blocked and suspended readers' books (lib/blocks.js).
// Filters on the map will narrow this further from the query string.
const mapFilter = (req) => marketFilter(req.user.userId);

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

// GET /map/areas?bbox=west,south,east,north  every place in view with books,
// as { place, point, count }.
router.get("/areas", async (req, res, next) => {
  const boxes = parseBbox(req.query.bbox);
  if (!boxes) return res.status(400).json({ message: BBOX_MESSAGE });

  try {
    res.json({ areas: await areasWithin(boxes, await mapFilter(req)) });
  } catch (err) {
    next(err);
  }
});

// GET /map/area?place=Brooklyn%2C%20NY&offset=0  a page of the place's books,
// newest first: { place, books, nextOffset }.
router.get("/area", async (req, res, next) => {
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

export default router;
