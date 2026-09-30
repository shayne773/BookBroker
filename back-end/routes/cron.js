// Scheduled jobs. Vercel Cron (the "crons" list in vercel.json) calls each path
// with `Authorization: Bearer <CRON_SECRET>`, CRON_SECRET being an environment
// variable of the project; without it set, every call is refused.
import { timingSafeEqual } from "node:crypto";
import express from "express";
import { resolveTradeDeadlines } from "../lib/tradeDeadlines.js";
import { deleteUnattachedBlobs } from "../lib/photos.js";

const router = express.Router();

export function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(req.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

router.use(requireCronSecret);

// Daily: expires unanswered offers and completes trades one side confirmed
// long enough ago (lib/tradeDeadlines.js).
router.get("/trade-deadlines", async (req, res, next) => {
  try {
    res.json(await resolveTradeDeadlines());
  } catch (err) {
    next(err);
  }
});

// Daily: deletes this namespace's blobs over a day old that no book shows:
// uploads never attached, and removed photos whose deletion failed (lib/photos.js).
router.get("/photo-cleanup", async (req, res, next) => {
  try {
    res.json({ unattached: await deleteUnattachedBlobs() });
  } catch (err) {
    next(err);
  }
});

export default router;
