import express from "express";
import mongoose from "mongoose";
import { Report, User, SUSPENSION_NOTE_MAX_LENGTH } from "../Data.js";
import { endUserSessions } from "../lib/sessions.js";

// The admin page's API: reading reports and suspending readers. Mounted in
// app.js behind authMiddleware and requireAdmin (lib/admin.js), so every route
// here is for admins only.

const router = express.Router();

const REPORTS_LIMIT = 200;

// What the reports page shows of a reader: the reported one also carries their
// suspension, so the page can offer to lift it.
const REPORTER_FIELDS = "_id username";
const REPORTED_FIELDS = "_id username suspended suspension";

function validId(res, id, what) {
  if (mongoose.isValidObjectId(id)) return true;
  res.status(400).json({ message: `Invalid ${what} id` });
  return false;
}

// GET /admin/reports?status=open|reviewed  newest first; open by default.
router.get("/reports", async (req, res, next) => {
  const status = req.query.status ?? "open";
  if (status !== "open" && status !== "reviewed") {
    return res.status(400).json({ message: "status must be open or reviewed" });
  }

  try {
    const reports = await Report.find({ reviewedAt: status === "open" ? null : { $ne: null } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(REPORTS_LIMIT)
      .populate("reporter", REPORTER_FIELDS)
      .populate("reported", REPORTED_FIELDS)
      .populate("reviewedBy", REPORTER_FIELDS)
      .lean();

    res.json(reports);
  } catch (err) {
    next(err);
  }
});

// Marking a report reviewed twice keeps the first review.
router.post("/reports/:id/review", async (req, res, next) => {
  if (!validId(res, req.params.id, "report")) return;

  try {
    await Report.updateOne(
      { _id: req.params.id, reviewedAt: null },
      { $set: { reviewedAt: new Date(), reviewedBy: req.user.userId } }
    );

    const report = await Report.findById(req.params.id).select("reviewedAt reviewedBy").lean();
    if (!report) return res.status(404).json({ message: "Report not found" });

    res.json(report);
  } catch (err) {
    next(err);
  }
});

// The reader named by :id, answering 400 for a malformed id or the admin's own
// and 404 for no such reader.
async function targetReader(req, res) {
  if (!validId(res, req.params.id, "user")) return null;
  if (req.params.id === req.user.userId) {
    res.status(400).json({ message: "You can't suspend your own account." });
    return null;
  }

  const user = await User.findById(req.params.id).select("_id");
  if (!user) res.status(404).json({ message: "User not found" });
  return user;
}

// body: { note?: string }. Ends every session of the reader at once, so the
// suspension applies to a browser that is already signed in. Suspending again
// replaces the note.
router.post("/users/:id/suspend", async (req, res, next) => {
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  if (note.length > SUSPENSION_NOTE_MAX_LENGTH) {
    return res
      .status(400)
      .json({ message: `Keep the note under ${SUSPENSION_NOTE_MAX_LENGTH} characters.` });
  }

  try {
    const user = await targetReader(req, res);
    if (!user) return;

    const suspension = { at: new Date(), by: req.user.userId, note };
    await User.updateOne({ _id: user._id }, { $set: { suspended: true, suspension } });
    await endUserSessions(user._id);

    res.json({ suspended: true, suspension });
  } catch (err) {
    next(err);
  }
});

// Lifts a suspension; the reader signs in again as usual.
router.delete("/users/:id/suspend", async (req, res, next) => {
  try {
    const user = await targetReader(req, res);
    if (!user) return;

    await User.updateOne({ _id: user._id }, { $set: { suspended: false }, $unset: { suspension: 1 } });
    res.json({ suspended: false });
  } catch (err) {
    next(err);
  }
});

export default router;
