// Notification emails: a new message, a move on a trade, and a wishlisted book
// newly offered by another reader.
//
// Each is sent from inside the request that causes it (the API runs as
// serverless functions, with no worker to hand the job to), but never holds that
// request up or fails it: `notifyInBackground` starts the work without waiting
// and only logs a failure. `notificationsSettled` resolves once every started
// notification is done, for tests and for a serverless entry that must keep the
// function alive until then.
//
// A reader is emailed only when their address is confirmed, the category is on
// in their settings (`User.notifications`), the event is someone else's doing
// and no block stands between them and that reader. Every email carries a link
// that turns its category off without signing in, and a link to the settings.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { Conversation, User } from "../Data.js";
import { isBlockedBetween } from "./blocks.js";
import { readersMatching } from "./matches.js";
import { mail, resolveFrontEndBaseUrl } from "./mail.js";

export const NOTIFICATION_CATEGORIES = ["messages", "trades", "wishlist"];

const FRONTEND_BASE_URL = resolveFrontEndBaseUrl();
const frontEnd = (path) => `${FRONTEND_BASE_URL}${path}`;
const SETTINGS_PATH = "/profile#notifications";

const EPOCH = new Date(0);

// --------------------
// Settings
// --------------------

/** The reader's settings, with every category not explicitly off reading as on. */
export function notificationSettings(user) {
  return Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((category) => [category, user?.notifications?.[category] !== false])
  );
}

// --------------------
// Unsubscribe links
// --------------------
// A link names the reader and the category and is signed with an HMAC under a
// key kept on the reader's account, so it cannot be made for anyone else or
// turned to another category, and it needs no sign-in. It stays valid: an old
// email's link still unsubscribes.

async function signingKey(userId) {
  const load = () => User.findById(userId).select("+notificationKey").lean();

  const user = await load();
  if (!user || user.notificationKey) return user?.notificationKey ?? null;

  // The filter keeps a key set by a concurrent first email.
  await User.updateOne(
    { _id: userId, notificationKey: { $exists: false } },
    { $set: { notificationKey: randomBytes(32).toString("base64url") } }
  );
  return (await load())?.notificationKey ?? null;
}

const signature = (key, userId, category) =>
  createHmac("sha256", key).update(`unsubscribe:${userId}:${category}`).digest("base64url");

export async function unsubscribeToken(userId, category) {
  const key = await signingKey(userId);
  if (!key) throw new Error(`no user ${userId} to sign an unsubscribe link for`);
  return `${userId}.${category}.${signature(key, String(userId), category)}`;
}

/**
 * Turn off the category an unsubscribe token names. Returns the category, or
 * null when the token is malformed, forged or names no reader.
 */
export async function unsubscribe(token) {
  if (typeof token !== "string" || token.length > 256) return null;

  const [userId, category, mac, ...rest] = token.split(".");
  if (rest.length || !mongoose.isValidObjectId(userId) || !NOTIFICATION_CATEGORIES.includes(category)) {
    return null;
  }

  const user = await User.findById(userId).select("+notificationKey").lean();
  if (!user?.notificationKey) return null;

  const expected = Buffer.from(signature(user.notificationKey, userId, category));
  const given = Buffer.from(String(mac));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  await User.updateOne({ _id: userId }, { $set: { [`notifications.${category}`]: false } });
  return category;
}

// --------------------
// Sending
// --------------------

const pending = new Set();

/** Run `work` without waiting for it; a failure is logged, never thrown. */
export function notifyInBackground(work, what) {
  const job = Promise.resolve()
    .then(work)
    .catch((err) => console.error(`Failed to send ${what} notification:`, err))
    .finally(() => pending.delete(job));
  pending.add(job);
}

/** Resolves when every notification started so far has been sent or has failed. */
export async function notificationsSettled() {
  while (pending.size) await Promise.all([...pending]);
}

const REASONS = {
  messages: "You get this email when a reader messages you on BookBroker.",
  trades: "You get this email when a reader acts on a trade with you on BookBroker.",
  wishlist: "You get this email when a book on your BookBroker wishlist is offered.",
};

// The reader `recipientId` if they are to be emailed about `category` for
// something `actorId` did, otherwise null.
async function recipientFor(recipientId, actorId, category) {
  if (String(recipientId) === String(actorId)) return null;

  const recipient = await User.findById(recipientId)
    .select("email emailVerified notifications suspended")
    .lean();
  if (!recipient?.email || recipient.emailVerified === false || recipient.suspended) return null;
  if (!notificationSettings(recipient)[category]) return null;
  if (await isBlockedBetween(recipientId, actorId)) return null;
  return recipient;
}

async function send(recipient, category, { subject, sentence, action, path }) {
  await mail.sendNotification({
    to: recipient.email,
    subject,
    sentence,
    action,
    link: frontEnd(path),
    reason: REASONS[category],
    unsubscribeLink: frontEnd(
      `/unsubscribe?token=${encodeURIComponent(await unsubscribeToken(recipient._id, category))}`
    ),
    settingsLink: frontEnd(SETTINGS_PATH),
  });
}

const usernameOf = async (userId) =>
  (await User.findById(userId).select("username").lean())?.username || "A reader";

// --------------------
// Events
// --------------------

/**
 * `message` was just sent in `conversation`. Its recipient is emailed once per
 * conversation until they have read it: `notifiedAt` records the message they
 * were emailed about, and the next email waits until their `readAt` reaches it.
 */
export function notifyNewMessage({ conversation, message, recipientId }) {
  notifyInBackground(async () => {
    const senderId = message.user;
    const recipient = await recipientFor(recipientId, senderId, "messages");
    if (!recipient) return;

    const rid = String(recipientId);
    const claimed = await Conversation.updateOne(
      {
        _id: conversation._id,
        $expr: {
          $lte: [{ $ifNull: [`$notifiedAt.${rid}`, EPOCH] }, { $ifNull: [`$readAt.${rid}`, EPOCH] }],
        },
      },
      { $set: { [`notifiedAt.${rid}`]: message.createdAt } }
    );
    if (!claimed.modifiedCount) return;

    const sender = await usernameOf(senderId);
    await send(recipient, "messages", {
      subject: `New message from ${sender}`,
      sentence: `${sender} sent you a message.`,
      action: "Read message",
      path: `/messages/${senderId}`,
    });
  }, "new message");
}

const TRADE_EVENTS = {
  proposed: { subject: (who) => `${who} proposed a trade`, sentence: (who) => `${who} proposed a trade with you.` },
  countered: { subject: (who) => `${who} countered your trade`, sentence: (who) => `${who} sent a counter-offer on your trade.` },
  accepted: { subject: (who) => `${who} accepted your trade`, sentence: (who) => `${who} accepted your trade.` },
  declined: { subject: (who) => `${who} declined your trade`, sentence: (who) => `${who} declined your trade.` },
  cancelled: { subject: (who) => `${who} cancelled your trade`, sentence: (who) => `${who} cancelled your trade.` },
  completed: { subject: () => "Your trade is complete", sentence: (who) => `${who} confirmed the trade, so it is complete.` },
};

/** `actorId` just did `event` (a key of TRADE_EVENTS) on `exchange`; the other side hears of it. */
export function notifyTrade(exchange, event, actorId) {
  notifyInBackground(async () => {
    const recipientId =
      String(exchange.requester) === String(actorId) ? exchange.responder : exchange.requester;
    const recipient = await recipientFor(recipientId, actorId, "trades");
    if (!recipient) return;

    const who = await usernameOf(actorId);
    await send(recipient, "trades", {
      subject: TRADE_EVENTS[event].subject(who),
      sentence: TRADE_EVENTS[event].sentence(who),
      action: "View trade",
      path: `/exchanges/${exchange._id}`,
    });
  }, `trade ${event}`);
}

/**
 * `offer` was just put on the market. Each reader it matches (lib/matches.js)
 * is emailed once about it.
 */
export function notifyWishlistMatch(offer) {
  notifyInBackground(async () => {
    const readerIds = await readersMatching(offer);
    if (!readerIds.length) return;

    const owner = await usernameOf(offer.owner);
    const title = offer.title || "A book";
    // One job per reader, so one refused address does not stop the others.
    for (const readerId of readerIds) {
      notifyInBackground(async () => {
        const recipient = await recipientFor(readerId, offer.owner, "wishlist");
        if (!recipient) return;
        await send(recipient, "wishlist", {
          subject: `${title} is available`,
          sentence: `${owner} is offering ${title}, a book on your wishlist.`,
          action: "View book",
          path: `/books/${offer._id}`,
        });
      }, "wishlist match");
    }
  }, "wishlist match");
}
