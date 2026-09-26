// Trade deadlines: an offer nobody answers expires, and an accepted trade that
// only one side has confirmed completes on its own.
//
// - PENDING or COUNTERED: `expiresAt` is PROPOSAL_TIMEOUT_MS after the invite or
//   the latest counter. Past it the trade becomes EXPIRED and any book it locked
//   is released. No email.
// - ACCEPTED: the first confirmation sets `autoCompletesAt`, COMPLETION_TIMEOUT_MS
//   later. Past it, with the other side still silent, the trade completes as a
//   two-sided confirmation does (its books leave the market), is marked
//   `autoCompleted`, and the silent side gets the "completed" email.
// Either way the trade records the days its deadline allowed, `deadlineDays`,
// which is how the front end says why it closed.
//
// Nothing runs at the deadline itself: the daily cron (routes/cron.js) sweeps
// every trade that is due, and the exchange routes resolve the trades they are
// about to show or act on first, so none is ever seen or changed past its
// deadline. Each transition is a conditional update that re-checks the deadline
// and bumps the version (Exchange.js sets optimisticConcurrency), so resolving
// twice is harmless and a route acting on the same trade at the same moment
// either wins or fails; it never overwrites the outcome.
import mongoose from "mongoose";
import Exchange from "../Exchange.js";
import { OfferedBook } from "../Data.js";
import { notifyTrade } from "./notifications.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const PROPOSAL_TIMEOUT_DAYS = 14;
const COMPLETION_TIMEOUT_DAYS = 7;
export const PROPOSAL_TIMEOUT_MS = PROPOSAL_TIMEOUT_DAYS * DAY;
export const COMPLETION_TIMEOUT_MS = COMPLETION_TIMEOUT_DAYS * DAY;

// Each call handles at most BATCH_SIZE * MAX_BATCHES trades of each kind, so
// the cron fits well inside the function's 30 s; what is left waits for the
// next run, or for the routes to resolve it when a participant looks.
const BATCH_SIZE = 50;
const MAX_BATCHES = 10;

const OPEN_OFFER = { $in: ["PENDING", "COUNTERED"] };

export const proposalExpiry = (from = new Date()) => new Date(from.getTime() + PROPOSAL_TIMEOUT_MS);
export const completionDeadline = (from = new Date()) => new Date(from.getTime() + COMPLETION_TIMEOUT_MS);

// `filter` narrowed to `scope`; either may carry its own $or.
const within = (scope, filter) => (Object.keys(scope).length ? { $and: [scope, filter] } : filter);

const dueExpiry = (now) => ({ status: OPEN_OFFER, expiresAt: { $ne: null, $lte: now } });

// Exactly one side has confirmed: both would already have completed the trade.
const dueCompletion = (now) => ({
  status: "ACCEPTED",
  autoCompletesAt: { $ne: null, $lte: now },
  $or: [
    { requesterConfirmedComplete: true, responderConfirmedComplete: false },
    { requesterConfirmedComplete: false, responderConfirmedComplete: true },
  ],
});

/**
 * Takes a finished trade's books off the market, inside `session`: the traded
 * books are deleted and any other book it still locks is released.
 */
export async function removeTradedBooks(exchange, session) {
  await OfferedBook.deleteMany({ _id: { $in: [...exchange.requesterBooks, ...exchange.responderBooks] } }, { session });
  await releaseBooks(exchange._id, session);
}

export function releaseBooks(exchangeId, session) {
  return OfferedBook.updateMany(
    { lockedByExchange: exchangeId },
    { $set: { locked: false, lockedByExchange: null } },
    { session }
  );
}

async function expire(id, now) {
  const expired = await Exchange.findOneAndUpdate(
    { _id: id, ...dueExpiry(now) },
    { $set: { status: "EXPIRED", deadlineDays: PROPOSAL_TIMEOUT_DAYS }, $inc: { __v: 1 } },
    { new: true }
  );
  if (!expired) return false;
  await releaseBooks(expired._id);
  return true;
}

async function autoComplete(id, now) {
  const session = await mongoose.startSession();
  let completed = null;
  try {
    await session.withTransaction(async () => {
      completed = await Exchange.findOneAndUpdate(
        { _id: id, ...dueCompletion(now) },
        { $set: { status: "COMPLETED", autoCompleted: true, deadlineDays: COMPLETION_TIMEOUT_DAYS }, $inc: { __v: 1 } },
        { new: true, session }
      );
      if (completed) await removeTradedBooks(completed, session);
    });
  } finally {
    await session.endSession();
  }
  if (!completed) return false;

  // The side that confirmed "did" the completion; the silent side hears of it.
  const confirmer = completed.requesterConfirmedComplete ? completed.requester : completed.responder;
  notifyTrade(completed, "completed", confirmer);
  return true;
}

// Runs `transition` on each trade matching `filter`, a batch at a time. A trade
// that fails is logged and skipped, and stays due for the next call.
async function drain(filter, sort, transition, now) {
  let done = 0;
  const failed = [];
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const due = await Exchange.find(failed.length ? { $and: [filter, { _id: { $nin: failed } }] } : filter)
      .sort(sort)
      .limit(BATCH_SIZE)
      .select("_id")
      .lean();
    for (const { _id } of due) {
      try {
        if (await transition(_id, now)) done += 1;
      } catch (err) {
        console.error(`Failed to resolve the deadline of exchange ${_id}:`, err);
        failed.push(_id);
      }
    }
    if (due.length < BATCH_SIZE) break;
  }
  return done;
}

/**
 * Expires or completes every trade within `scope` (a filter on Exchange, such
 * as one reader's trades or one trade) whose deadline has passed at `now`.
 * Returns how many of each it changed.
 */
export async function resolveTradeDeadlines(scope = {}, now = new Date()) {
  // An offer from before this rule (no deadline, or the old 48 hours) gets at
  // least PROPOSAL_TIMEOUT_MS from its latest proposal or counter, its last
  // change, which `updatedAt` still records because this update leaves it be.
  // An offer made since already has that deadline, give or take the moment
  // between setting it and saving, which the minute of slack allows for.
  const proposalDeadline = { $add: ["$updatedAt", PROPOSAL_TIMEOUT_MS] };
  await Exchange.updateMany(
    within(scope, {
      status: OPEN_OFFER,
      $expr: { $lt: ["$expiresAt", { $subtract: [proposalDeadline, MINUTE] }] },
    }),
    [{ $set: { expiresAt: proposalDeadline } }],
    { timestamps: false }
  );
  await Exchange.updateMany(
    within(scope, {
      status: "ACCEPTED",
      autoCompletesAt: null,
      $or: [{ requesterConfirmedComplete: true }, { responderConfirmedComplete: true }],
    }),
    { $set: { autoCompletesAt: completionDeadline(now) }, $inc: { __v: 1 } }
  );

  const expired = await drain(within(scope, dueExpiry(now)), { expiresAt: 1 }, expire, now);
  const completed = await drain(within(scope, dueCompletion(now)), { autoCompletesAt: 1 }, autoComplete, now);
  return { expired, completed };
}
