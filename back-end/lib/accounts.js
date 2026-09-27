// Deleting an account (POST /user/delete). It is permanent: there is no undo and
// no grace period, and the address is free to sign up again as a new account.
//
// What goes: the user, their offered books (so they leave every listing, the
// map and other readers' matches), their wishlist, the blocks they placed, their
// sessions and emailed-link tokens and their notification state. An accepted
// trade the other reader has already confirmed completes, as it would at its
// deadline (lib/tradeDeadlines.js): its books leave the market and the other
// reader is emailed that it completed because this reader deleted their account
// (not that they confirmed it). Their other open offers and accepted trades
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
import { notifyTrade } from "./notifications.js";
import { Session } from "./sessions.js";
import { removeTradedBooks, resolveTradeDeadlines } from "./tradeDeadlines.js";

const UNFINISHED = ["PENDING", "COUNTERED", "ACCEPTED"];

// The trade is accepted and the side other than `uid` has confirmed it done.
const confirmedByOther = (exchange, uid) =>
  exchange.status === "ACCEPTED" &&
  (exchange.requester.equals(uid) ? exchange.responderConfirmedComplete : exchange.requesterConfirmedComplete);

/** Delete the account `userId` and everything that belongs to it alone. */
export async function deleteAccount(userId) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  const theirTrades = { $or: [{ requester: uid }, { responder: uid }] };

  // A trade past its deadline has already expired or completed; it is settled
  // that way first rather than cancelled here.
  await resolveTradeDeadlines(theirTrades);

  let cancelled = [];
  let completed = [];
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      cancelled = [];
      completed = [];
      const user = await User.exists({ _id: uid }).session(session);
      if (!user) return;

      // Each update bumps the version (optimisticConcurrency in Exchange.js),
      // so a route saving one of these trades at the same moment fails.
      const unfinished = await Exchange.find({ ...theirTrades, status: { $in: UNFINISHED } })
        .select("_id status requester responder requesterBooks responderBooks requesterConfirmedComplete responderConfirmedComplete")
        .session(session)
        .lean();
      completed = unfinished.filter((ex) => confirmedByOther(ex, uid));
      cancelled = unfinished.filter((ex) => !confirmedByOther(ex, uid));

      await Exchange.updateMany(
        { _id: { $in: completed.map((ex) => ex._id) }, status: "ACCEPTED" },
        { $set: { status: "COMPLETED" }, $inc: { __v: 1 } },
        { session }
      );
      for (const exchange of completed) await removeTradedBooks(exchange, session);

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
      await User.deleteOne({ _id: uid }, { session });
    });
  } finally {
    await session.endSession();
  }

  for (const exchange of completed) notifyTrade(exchange, "completedByDeletion", uid);
  for (const exchange of cancelled) notifyTrade(exchange, "cancelled", uid);
}
