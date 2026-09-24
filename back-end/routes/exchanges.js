import express from "express";
import mongoose from "mongoose";
import Exchange from "../Exchange.js";
import { OfferedBook, User } from "../Data.js";
import { BLOCKED_TRADE_MESSAGE, isBlockedBetween } from "../lib/blocks.js";
import { isSuspended } from "../lib/suspensions.js";
import { LoginThrottle } from "../lib/loginThrottle.js";
import { notifyTrade } from "../lib/notifications.js";

const router = express.Router();

function assertParticipant(exchange, userId) {
  const uid = String(userId);
  if (String(exchange.requester) !== uid && String(exchange.responder) !== uid) {
    const err = new Error("Not authorized");
    err.status = 403;
    throw err;
  }
}

function isRequester(exchange, userId) {
  return String(exchange.requester) === String(userId);
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// The other participant's fields shown beside a trade.
const PARTICIPANT_FIELDS = "username location ratingsAvg ratingsCount";

// Readers blocked either way cannot propose, counter or accept a trade with
// each other, and nobody can with a suspended reader; declining, cancelling and
// completing stay open so a trade already under way can still be wound down.
async function canTrade(a, b) {
  return !(await isBlockedBetween(a, b)) && !(await isSuspended(a)) && !(await isSuspended(b));
}

async function assertNotBlocked(exchange) {
  if (!(await canTrade(exchange.requester, exchange.responder))) {
    throw httpError(403, BLOCKED_TRADE_MESSAGE);
  }
}

// The side that made the offer currently on the table: whoever sent the invite
// or the latest counter. Exchanges saved before proposedBy existed fall back to
// the requester while still PENDING; a legacy counter's author is unknown.
function proposerOf(exchange) {
  if (exchange.proposedBy) return String(exchange.proposedBy);
  return exchange.status === "PENDING" ? String(exchange.requester) : null;
}

// Every proposal emails the responder, so one reader cannot propose (or cancel
// and propose again) without limit.
const HOUR = 60 * 60 * 1000;
const proposalThrottle = new LoginThrottle({
  scope: "trade-proposal",
  windowMs: HOUR,
  lockoutMs: HOUR,
  accountMaxAttempts: 20,
});
export const PROPOSAL_THROTTLED_MESSAGE =
  "You have proposed a lot of trades in the last hour. Please wait a while before proposing another.";

// --------------------
// POST /exchanges  (create + send invite)
// body: { responderId, requesterBooks: [], responderBooks: [], message, expiresInHours }
// --------------------
router.post("/", async (req, res) => {
  const userId = req.user.userId;
  const { responderId, requesterBooks = [], responderBooks = [], message = "", expiresInHours = 48 } = req.body;

  try {
    // basic validation
    if (!responderId) return res.status(400).json({ message: "responderId required" });
    if (String(responderId) === String(userId)) return res.status(400).json({ message: "Cannot exchange with yourself" });
    if (!mongoose.isValidObjectId(responderId)) return res.status(400).json({ message: "Invalid responderId" });
    if (!(await canTrade(userId, responderId))) {
      return res.status(403).json({ message: BLOCKED_TRADE_MESSAGE });
    }

    // verify books belong to correct owners
    const myBooks = await OfferedBook.find({ _id: { $in: requesterBooks }, owner: userId, locked: false });
    if (myBooks.length !== requesterBooks.length) {
      return res.status(400).json({ message: "Some requesterBooks invalid / not yours / locked" });
    }

    const theirBooks = await OfferedBook.find({ _id: { $in: responderBooks }, owner: responderId, locked: false });
    if (theirBooks.length !== responderBooks.length) {
      return res.status(400).json({ message: "Some responderBooks invalid / not theirs / locked" });
    }

    const limit = await proposalThrottle.hit(userId);
    if (limit.limited) {
      res.set("Retry-After", String(limit.retryAfterSeconds));
      return res.status(429).json({ message: PROPOSAL_THROTTLED_MESSAGE });
    }

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const ex = await Exchange.create({
      requester: userId,
      responder: responderId,
      requesterBooks,
      responderBooks,
      message,
      status: "PENDING",
      proposedBy: userId,
      expiresAt,
    });

    notifyTrade(ex, "proposed", userId);
    res.status(201).json(ex);
  } catch (err) {
    console.error("CREATE EXCHANGE error:", err);
    res.status(500).json({ message: "Failed to create exchange" });
  }
});

// --------------------
// GET /exchanges  (list mine)
// --------------------
router.get("/", async (req, res) => {
  const userId = req.user.userId;

  try {
    // auto-expire
    await Exchange.updateMany(
      { status: { $in: ["PENDING", "COUNTERED"] }, expiresAt: { $ne: null, $lt: new Date() } },
      { $set: { status: "EXPIRED" } }
    );

    const exchanges = await Exchange.find({
      $or: [{ requester: userId }, { responder: userId }],
    })
      .sort({ updatedAt: -1 })
      .populate("requester", PARTICIPANT_FIELDS)
      .populate("responder", PARTICIPANT_FIELDS)
      .populate("requesterBooks")
      .populate("responderBooks");

    res.json(exchanges);
  } catch (err) {
    console.error("LIST EXCHANGES error:", err);
    res.status(500).json({ message: "Failed to fetch exchanges" });
  }
});

// --------------------
// GET /exchanges/:id
// --------------------
router.get("/:id", async (req, res) => {
  const userId = req.user.userId;
  try {
    const ex = await Exchange.findById(req.params.id);

    if (!ex) return res.status(404).json({ message: "Exchange not found" });
    assertParticipant(ex, userId);

    const full = await Exchange.findById(req.params.id)
      .populate("requester", PARTICIPANT_FIELDS)
      .populate("responder", PARTICIPANT_FIELDS)
      .populate("requesterBooks")
      .populate("responderBooks");

    res.json(full);
  } catch (err) {
    console.error("GET EXCHANGE error:", err);
    res.status(err.status || 500).json({
      message: err.status ? err.message : "Internal server error",
    });
  }
});


// --------------------
// POST /exchanges/:id/counter  (responder OR requester can counter)
// body: { requesterBooks, responderBooks, message }
// --------------------
router.post("/:id/counter", async (req, res) => {
  const userId = req.user.userId;
  const { requesterBooks = [], responderBooks = [], message = "" } = req.body;

  try {
    const ex = await Exchange.findById(req.params.id);
    if (!ex) return res.status(404).json({ message: "Exchange not found" });
    assertParticipant(ex, userId);

    if (!["PENDING", "COUNTERED"].includes(ex.status)) {
      return res.status(400).json({ message: "Cannot counter in current status" });
    }

    await assertNotBlocked(ex);

    // verify ownership + unlocked
    const myId = String(userId);
    const requesterId = String(ex.requester);
    const responderId = String(ex.responder);

    // requesterBooks must belong to requester, responderBooks must belong to responder
    const reqBooks = await OfferedBook.find({ _id: { $in: requesterBooks }, owner: requesterId, locked: false });
    const resBooks = await OfferedBook.find({ _id: { $in: responderBooks }, owner: responderId, locked: false });

    if (reqBooks.length !== requesterBooks.length) return res.status(400).json({ message: "Invalid requesterBooks" });
    if (resBooks.length !== responderBooks.length) return res.status(400).json({ message: "Invalid responderBooks" });

    ex.requesterBooks = requesterBooks;
    ex.responderBooks = responderBooks;
    ex.message = message;
    ex.status = "COUNTERED";
    ex.proposedBy = userId;
    ex.requesterConfirmedComplete = false;
    ex.responderConfirmedComplete = false;

    await ex.save();
    notifyTrade(ex, "countered", userId);
    res.json(ex);
  } catch (err) {
    console.error("COUNTER error:", err);
    res.status(err.status || 500).json({
      message: err.status ? err.message : "Internal server error",
    });
  }
});

// --------------------
// POST /exchanges/:id/accept  (locks books)
// Only the side that received the current offer may accept it.
// --------------------
router.post("/:id/accept", async (req, res) => {
  const userId = req.user.userId;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const ex = await Exchange.findById(req.params.id).session(session);
    if (!ex) throw httpError(404, "Exchange not found");
    assertParticipant(ex, userId);

    if (!["PENDING", "COUNTERED"].includes(ex.status)) {
      throw httpError(400, "Cannot accept in current status");
    }

    if (proposerOf(ex) === String(userId)) {
      throw httpError(403, "You cannot accept your own offer; the other side must accept it");
    }

    await assertNotBlocked(ex);

    // lock both sides' books if still unlocked
    const allBookIds = [...ex.requesterBooks, ...ex.responderBooks];

    const books = await OfferedBook.find({ _id: { $in: allBookIds } }).session(session);

    // ensure none is locked by another exchange
    for (const b of books) {
      if (b.locked && String(b.lockedByExchange) !== String(ex._id)) {
        throw httpError(409, "One of the books is already locked in another exchange.");
      }
    }

    await OfferedBook.updateMany(
      { _id: { $in: allBookIds }, locked: false },
      { $set: { locked: true, lockedByExchange: ex._id } },
      { session }
    );

    ex.status = "ACCEPTED";
    await ex.save({ session });

    await session.commitTransaction();
    notifyTrade(ex, "accepted", userId);
    res.json({ message: "Exchange accepted", exchangeId: ex._id });
  } catch (err) {
    await session.abortTransaction();
    if (!err.status) console.error("ACCEPT error:", err);
    res.status(err.status || 500).json({
      message: err.status ? err.message : "Internal server error",
    });
  } finally {
    session.endSession();
  }
});

// --------------------
// POST /exchanges/:id/decline
// --------------------
router.post("/:id/decline", async (req, res) => {
  const userId = req.user.userId;

  try {
    const ex = await Exchange.findById(req.params.id);
    if (!ex) return res.status(404).json({ message: "Exchange not found" });
    assertParticipant(ex, userId);

    if (!["PENDING", "COUNTERED"].includes(ex.status)) {
      return res.status(400).json({ message: "Cannot decline in current status" });
    }

    ex.status = "DECLINED";
    await ex.save();
    notifyTrade(ex, "declined", userId);
    res.json({ message: "Exchange declined" });
  } catch (err) {
    console.error("DECLINE error:", err);
    res.status(err.status || 500).json({
      message: err.status ? err.message : "Internal server error",
    });
  }
});

// --------------------
// POST /exchanges/:id/cancel
// Either participant can cancel an offer, or an ACCEPTED trade the other side
// has not yet confirmed complete; cancelling an accepted trade unlocks both
// sides' books with it.
// --------------------
router.post("/:id/cancel", async (req, res) => {
  const userId = req.user.userId;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const ex = await Exchange.findById(req.params.id).session(session);
    if (!ex) throw httpError(404, "Exchange not found");
    assertParticipant(ex, userId);

    if (!["PENDING", "COUNTERED", "ACCEPTED"].includes(ex.status)) {
      throw httpError(400, "Cannot cancel in current status");
    }

    if (ex.status === "ACCEPTED") {
      const otherConfirmed = isRequester(ex, userId)
        ? ex.responderConfirmedComplete
        : ex.requesterConfirmedComplete;
      if (otherConfirmed) {
        throw httpError(409, "The other participant has already confirmed completion");
      }

      await OfferedBook.updateMany(
        { lockedByExchange: ex._id },
        { $set: { locked: false, lockedByExchange: null } },
        { session }
      );
    }

    ex.status = "CANCELLED";
    await ex.save({ session });

    await session.commitTransaction();
    notifyTrade(ex, "cancelled", userId);
    res.json({ message: "Exchange cancelled" });
  } catch (err) {
    await session.abortTransaction();
    if (!err.status) console.error("CANCEL error:", err);
    res.status(err.status || 500).json({
      message: err.status ? err.message : "Internal server error",
    });
  } finally {
    session.endSession();
  }
});

// --------------------
// POST /exchanges/:id/confirm-complete
// When both confirm => COMPLETED + delete traded OfferedBooks + update ratings totals
// --------------------
router.post("/:id/confirm-complete", async (req, res) => {
  const userId = req.user.userId;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const ex = await Exchange.findById(req.params.id).session(session);
    if (!ex) throw httpError(404, "Exchange not found");
    assertParticipant(ex, userId);

    if (ex.status !== "ACCEPTED") {
      throw httpError(400, "Exchange must be ACCEPTED to complete");
    }

    if (isRequester(ex, userId)) ex.requesterConfirmedComplete = true;
    else ex.responderConfirmedComplete = true;

    // if both confirmed -> finalize
    if (ex.requesterConfirmedComplete && ex.responderConfirmedComplete) {
      ex.status = "COMPLETED";

      const tradedBookIds = [...ex.requesterBooks, ...ex.responderBooks];

      // delete traded books (so they no longer show in marketplace)
      await OfferedBook.deleteMany({ _id: { $in: tradedBookIds } }, { session });

      // (optional) unlock any other books that were locked by this exchange (usually none left)
      await OfferedBook.updateMany(
        { lockedByExchange: ex._id },
        { $set: { locked: false, lockedByExchange: null } },
        { session }
      );
    }

    await ex.save({ session });

    await session.commitTransaction();
    if (ex.status === "COMPLETED") notifyTrade(ex, "completed", userId);
    res.json({ message: "Completion recorded", status: ex.status });
  } catch (err) {
    await session.abortTransaction();
    if (!err.status) console.error("CONFIRM COMPLETE error:", err);
    res.status(err.status || 500).json({
      message: err.status ? err.message : "Internal server error",
    });
  } finally {
    session.endSession();
  }
});

// --------------------
// POST /exchanges/:id/rate
// body: { rating: 1..5 }
// requester sets requesterRating, responder sets responderRating
// also updates target user's ratings average (simple version)
// --------------------
router.post("/:id/rate", async (req, res) => {
  const userId = req.user.userId;
  const { rating } = req.body;

  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ message: "rating must be 1..5" });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const ex = await Exchange.findById(req.params.id).session(session);
    if (!ex) return res.status(404).json({ message: "Exchange not found" });
    assertParticipant(ex, userId);

    if (ex.status !== "COMPLETED") {
      return res.status(400).json({ message: "Can only rate after COMPLETED" });
    }

    const requesterId = String(ex.requester);
    const responderId = String(ex.responder);

    let targetUserId;
    if (String(userId) === requesterId) {
      if (ex.requesterRating) return res.status(400).json({ message: "Already rated" });
      ex.requesterRating = rating;
      targetUserId = responderId;
    } else {
      if (ex.responderRating) return res.status(400).json({ message: "Already rated" });
      ex.responderRating = rating;
      targetUserId = requesterId;
    }

    // simple ratings update: store count + average on User (recommended)
    const target = await User.findById(targetUserId).session(session);
    if (!target) return res.status(404).json({ message: "Target user not found" });

    const prevCount = target.ratingsCount || 0;
    const prevAvg = target.ratingsAvg || 0;

    const newCount = prevCount + 1;
    const newAvg = (prevAvg * prevCount + rating) / newCount;

    target.ratingsCount = newCount;
    target.ratingsAvg = newAvg;

    await target.save({ session });
    await ex.save({ session });

    await session.commitTransaction();
    res.json({ message: "Rating saved" });
  } catch (err) {
    await session.abortTransaction();
    console.error("RATE error:", err);
    res.status(err.status || 500).json({
      message: err.status ? err.message : "Internal server error",
    });
  } finally {
    session.endSession();
  }
});

export default router;
