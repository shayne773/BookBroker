// Deleting an account (POST /user/delete). It is permanent: there is no undo and
// no grace period, and the address is free to sign up again as a new account.
//
// What goes: the user, their offered books (so they leave every listing, the
// map and other readers' matches), their wishlist, the blocks they placed, their
// sessions and emailed-link tokens, their notification state and every throttle
// counter kept for them. Their open offers and accepted trades not yet complete
// are cancelled, which releases the other side's books, and the other reader
// gets the usual "cancelled" email.
//
// What stays, for the other readers and for admins: completed trades, ratings
// (so nobody's average moves), conversations and messages, blocks others placed
// on them, and reports by or about them. Wherever those name the deleted reader
// the user no longer exists, and the front end shows "Deleted reader".
import mongoose from "mongoose";
import Exchange from "../Exchange.js";
import { Block, Conversation, OfferedBook, User, WishlistBook, WishlistNotice } from "../Data.js";
import { AuthToken } from "./authTokens.js";
import { forgetAccountThrottles } from "./loginThrottle.js";
import { notifyTrade } from "./notifications.js";
import { Session } from "./sessions.js";
import { resolveTradeDeadlines } from "./tradeDeadlines.js";

const UNFINISHED = ["PENDING", "COUNTERED", "ACCEPTED"];

/** Delete the account `userId` and everything that belongs to it alone. */
export async function deleteAccount(userId) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const theirTrades = { $or: [{ requester: uid }, { responder: uid }] };

  // A trade past its deadline has already expired or completed; it is settled
  // that way first rather than cancelled here.
  await resolveTradeDeadlines(theirTrades);

  let cancelled = [];
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      cancelled = [];
      const user = await User.findById(uid).select("email").session(session).lean();
      if (!user) return;

      // Each update bumps the version (optimisticConcurrency in Exchange.js),
      // so a route saving one of these trades at the same moment fails.
      cancelled = await Exchange.find({ ...theirTrades, status: { $in: UNFINISHED } })
        .select("_id requester responder")
        .session(session)
        .lean();
      const ids = cancelled.map((ex) => ex._id);
      await Exchange.updateMany(
        { _id: { $in: ids }, status: { $in: UNFINISHED } },
        { $set: { status: "CANCELLED" }, $inc: { __v: 1 } },
        { session }
      );
      await OfferedBook.updateMany(
        { lockedByExchange: { $in: ids } },
        { $set: { locked: false, lockedByExchange: null } },
        { session }
      );

      await OfferedBook.deleteMany({ owner: uid }, { session });
      await WishlistBook.deleteMany({ userId: uid }, { session });
      await Block.deleteMany({ blocker: uid }, { session });
      await Session.deleteMany({ user: uid }, { session });
      await AuthToken.deleteMany({ user: uid }, { session });
      // Keyed "<readerId>:<isbn>"; an anchored prefix is served by the _id index.
      await WishlistNotice.deleteMany({ _id: new RegExp(`^${uid}:`) }, { session });
      await Conversation.updateMany(
        { users: uid },
        { $unset: { [`readAt.${uid}`]: "", [`seenAt.${uid}`]: "", [`notifiedAt.${uid}`]: "" } },
        { session }
      );
      await forgetAccountThrottles({ userId: uid, email: user.email }, session);
      await User.deleteOne({ _id: uid }, { session });
    });
  } finally {
    await session.endSession();
  }

  for (const exchange of cancelled) notifyTrade(exchange, "cancelled", uid);
}
