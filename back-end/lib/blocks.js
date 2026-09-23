// Blocks between readers (see the Block model in Data.js). A block works both
// ways, so every check here looks at both directions: the reader who blocked and
// the reader who was blocked are kept apart alike.
import mongoose from "mongoose";
import { Block } from "../Data.js";

export const BLOCKED_MESSAGE_MESSAGE = "You can't message this reader.";
export const BLOCKED_TRADE_MESSAGE = "You can't trade with this reader.";

const toObjectId = (id) =>
  id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id));

const eitherWay = (a, b) => ({
  $or: [
    { blocker: a, blocked: b },
    { blocker: b, blocked: a },
  ],
});

// Ids of every reader `userId` has blocked or been blocked by, as ObjectIds so
// they also work inside an aggregation $match, which does not cast.
export async function blockedUserIds(userId) {
  const uid = toObjectId(userId);
  const blocks = await Block.find({ $or: [{ blocker: uid }, { blocked: uid }] })
    .select("blocker blocked")
    .lean();
  return blocks.map((b) => (b.blocker.equals(uid) ? b.blocked : b.blocker));
}

export async function isBlockedBetween(a, b) {
  return Boolean(await Block.exists(eitherWay(toObjectId(a), toObjectId(b))));
}

// The OfferedBook filter for books `userId` may see on the market: not locked
// into an accepted trade, not owned by anyone blocked either way, and, unless
// `includeOwn`, not their own. Without a user it is every book on the market.
export async function marketFilter(userId, { includeOwn = false } = {}) {
  if (!userId) return { locked: false };

  const hidden = await blockedUserIds(userId);
  if (!includeOwn) hidden.push(toObjectId(userId));
  return hidden.length ? { locked: false, owner: { $nin: hidden } } : { locked: false };
}
