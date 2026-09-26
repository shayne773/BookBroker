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

const DAY = 24 * 60 * 60 * 1000;
export const PROPOSAL_TIMEOUT_MS = 14 * DAY;
export const COMPLETION_TIMEOUT_MS = 7 * DAY;

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
    { $set: { status: "EXPIRED" }, $inc: { __v: 1 } },
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
        { $set: { status: "COMPLETED", autoCompleted: true }, $inc: { __v: 1 } },
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
  // Trades from before the deadlines existed get theirs from now on.
  await Exchange.updateMany(
    within(scope, { status: OPEN_OFFER, expiresAt: null }),
    { $set: { expiresAt: proposalExpiry(now) }, $inc: { __v: 1 } }
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
