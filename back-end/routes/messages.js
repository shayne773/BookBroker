import express from "express";
import mongoose from "mongoose";
import { Conversation, Message, User } from "../Data.js";
import { BLOCKED_MESSAGE_MESSAGE, isBlockedBetween } from "../lib/blocks.js";
import { isSuspended } from "../lib/suspensions.js";
import { notifyNewMessage } from "../lib/notifications.js";

// Conversations are addressed by the other participant's id, so a user can only
// ever reach the conversations they are part of.
//
// Live delivery is short polling (the API runs as serverless functions, which
// cannot hold a connection open): the client asks for messages after the newest
// one it has, and for the unread count, both of which are single indexed queries.

const router = express.Router();

const EPOCH = new Date(0);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// The other participant's id from the route.
function otherUserParam(req) {
  const other = req.params.user;
  if (!mongoose.isValidObjectId(other)) throw httpError(400, "Invalid user id");
  return other;
}

// A conversation with oneself is stored as [me, me], and only that one matches:
// `$all` with the same id twice would match any conversation the caller is in.
function findConversation(userId, otherUserId) {
  const users =
    String(userId) === String(otherUserId)
      ? [userId, userId]
      : { $all: [userId, otherUserId], $size: 2 };
  return Conversation.findOne({ users });
}

// The message `messageId` if it belongs to `conversation`, for use as a cursor.
async function messageIn(conversation, messageId) {
  if (!mongoose.isValidObjectId(messageId)) throw httpError(400, "Invalid message id");
  const message = await Message.findOne({ _id: messageId, conversation: conversation._id })
    .select("createdAt")
    .lean();
  if (!message) throw httpError(400, "Unknown message");
  return message;
}

function formatMessage(msg) {
  return {
    id: msg._id,
    sender: String(msg.user),
    content: msg.content,
    timestamp: msg.createdAt,
  };
}

function readAtFor(conversation, userId) {
  const readAt = conversation.readAt;
  const value = readAt instanceof Map ? readAt.get(String(userId)) : readAt?.[String(userId)];
  return value || EPOCH;
}

// Conversations saved before `lastMessageAt` existed get it from their newest
// message, so the unread count can rely on it. Once filled, this finds nothing.
async function backfillLastMessage(userId) {
  const stale = await Conversation.find({
    users: userId,
    lastMessageAt: { $exists: false },
  })
    .select("_id")
    .lean();

  await Promise.all(
    stale.map(async ({ _id }) => {
      const last = await Message.findOne({ conversation: _id })
        .sort({ createdAt: -1, _id: -1 })
        .select("user createdAt")
        .lean();
      if (!last) return;
      await Conversation.updateOne(
        { _id, lastMessageAt: { $exists: false } },
        { $set: { lastMessageAt: last.createdAt, lastMessageBy: last.user } }
      );
    })
  );
}

// --------------------
// GET /messages  (the inbox: one row per conversation, newest first)
// --------------------
router.get("/", async (req, res, next) => {
  try {
    const userId = req.user.userId;
    await backfillLastMessage(userId);

    const conversations = await Conversation.find({ users: userId })
      .sort({ lastMessageAt: -1 })
      .lean();

    const rows = await Promise.all(
      conversations.map(async (convo) => {
        const otherUserId = convo.users.find((u) => String(u) !== String(userId)) || convo.users[0];
        const readAt = readAtFor(convo, userId);
        const hasUnread =
          convo.lastMessageAt &&
          convo.lastMessageAt > readAt &&
          String(convo.lastMessageBy) !== String(userId);

        const [otherUser, lastMsg, unread] = await Promise.all([
          User.findById(otherUserId).select("_id username location ratingsAvg ratingsCount").lean(),
          Message.findOne({ conversation: convo._id })
            .sort({ createdAt: -1, _id: -1 })
            .select("content createdAt")
            .lean(),
          hasUnread
            ? Message.countDocuments({
                conversation: convo._id,
                createdAt: { $gt: readAt },
                user: { $ne: userId },
              })
            : 0,
        ]);

        return {
          id: convo._id,
          otherUser: otherUser
            ? {
                id: otherUser._id,
                location: otherUser.location,
                ratingsAvg: otherUser.ratingsAvg,
                ratingsCount: otherUser.ratingsCount,
                username: otherUser.username,
              }
            : {
                id: otherUserId,
                location: null,
                ratingsAvg: 0,
                ratingsCount: 0,
                username: "Unknown",
              },
          lastMessage: lastMsg?.content || "",
          lastAt: lastMsg?.createdAt || null,
          unread,
        };
      })
    );

    res.json(rows);
  } catch (err) {
    console.error("Error fetching conversations:", err);
    next(err);
  }
});

// --------------------
// GET /messages/unread  ({ conversations }: how many have a message the caller has not read)
// --------------------
router.get("/unread", async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const me = new mongoose.Types.ObjectId(userId);
    await backfillLastMessage(userId);

    const conversations = await Conversation.countDocuments({
      users: me,
      lastMessageBy: { $ne: me },
      $expr: { $gt: ["$lastMessageAt", { $ifNull: [`$readAt.${userId}`, EPOCH] }] },
    });

    res.json({ conversations });
  } catch (err) {
    console.error("Error counting unread conversations:", err);
    next(err);
  }
});

// --------------------
// GET /messages/:user?after=<messageId>
// The thread with :user, oldest first. With `after`, only the messages newer
// than that one, which is what the client polls with.
// --------------------
router.get("/:user", async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const otherUserId = otherUserParam(req);
    const { after } = req.query;
    if (after !== undefined && typeof after !== "string") {
      throw httpError(400, "Invalid message id");
    }

    const conversation = await findConversation(userId, otherUserId);
    if (!conversation) {
      // Nothing said yet: an empty thread, as long as there is someone to talk to.
      if (!(await User.exists({ _id: otherUserId }))) throw httpError(404, "User not found");
      return res.json([]);
    }

    const filter = { conversation: conversation._id };
    if (after) {
      const cursor = await messageIn(conversation, after);
      filter.$or = [
        { createdAt: { $gt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $gt: cursor._id } },
      ];
    }

    const messages = await Message.find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .select("user content createdAt")
      .lean();

    res.json(messages.map(formatMessage));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("Error fetching messages:", err);
    next(err);
  }
});

// --------------------
// POST /messages/:user/read   body: { upTo?: messageId }
// Marks the conversation read up to `upTo` (the newest message the client has
// fetched), or up to its newest message. The marker only ever moves forward.
// `seenAt` records when, which holds back message emails for a while.
// --------------------
router.post("/:user/read", async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const otherUserId = otherUserParam(req);
    const upTo = req.body?.upTo;

    const conversation = await findConversation(userId, otherUserId);
    if (!conversation) throw httpError(404, "Conversation not found");

    const readAt = upTo
      ? (await messageIn(conversation, upTo)).createdAt
      : conversation.lastMessageAt || new Date();

    await Conversation.updateOne(
      { _id: conversation._id },
      { $max: { [`readAt.${userId}`]: readAt, [`seenAt.${userId}`]: new Date() } }
    );

    res.status(204).end();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("Error marking conversation read:", err);
    next(err);
  }
});

// --------------------
// POST /messages/:user   body: { content }
// --------------------
router.post("/:user", async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const otherUserId = otherUserParam(req);

    // A block, in either direction, stops messages both ways; a suspended
    // reader cannot be written to at all.
    if (
      (await isBlockedBetween(userId, otherUserId)) ||
      (String(userId) !== String(otherUserId) && (await isSuspended(otherUserId)))
    ) {
      throw httpError(403, BLOCKED_MESSAGE_MESSAGE);
    }

    const { content } = req.body || {};

    if (typeof content !== "string") throw httpError(400, "Message content is required");
    if (!content.trim()) return res.status(200).json({ message: "Empty message ignored" });

    const conversation =
      (await findConversation(userId, otherUserId)) ||
      (await Conversation.create({ users: [otherUserId, userId] }));

    const message = await Message.create({
      content,
      conversation: conversation._id,
      user: userId,
      createdAt: new Date(),
    });

    // The sender has read their own message. `lastMessage*` only moves forward,
    // so a slower concurrent send cannot wind it back.
    await Promise.all([
      Conversation.updateOne(
        {
          _id: conversation._id,
          $or: [
            { lastMessageAt: { $exists: false } },
            { lastMessageAt: { $lte: message.createdAt } },
          ],
        },
        { $set: { lastMessageAt: message.createdAt, lastMessageBy: userId } }
      ),
      Conversation.updateOne(
        { _id: conversation._id },
        { $max: { [`readAt.${userId}`]: message.createdAt } }
      ),
    ]);

    notifyNewMessage({ conversation, message, recipientId: otherUserId });

    res.status(200).json({ messageId: message._id, message: formatMessage(message) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error("Error sending message:", err);
    next(err);
  }
});

export default router;
