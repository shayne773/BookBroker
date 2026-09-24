// src/Data.js
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * IMPORTANT:
 * - No mongoose.connect() in this file.
 * - This file only defines schemas/models + helper functions.
 * - The connection is created in app.js.
 */

// --------------------
// Schemas
// --------------------

const SUSPENSION_NOTE_MAX_LENGTH = 1000;

// User schema
const userSchema = new Schema({
  username: { type: String, required: true },
  // Always stored through normalizeEmail (lib/validation.js), so every lookup is an
  // exact match on this plain unique index. The case-insensitive index below makes
  // the database itself refuse an address differing only in capitalization.
  email:    { type: String, required: true, unique: true },
  password: { type: String, required: true },
  location: String,
  // Sign-up stores false until the emailed link is used. Accounts created before
  // email confirmation existed have no such field and read as confirmed: the
  // default applies when they are loaded, and the login check only refuses an
  // explicit false, so no backfill is needed.
  emailVerified: { type: Boolean, default: true },
  // A new address asked for on the profile. `email` stays in effect for sign-in
  // and password reset until the link mailed here is followed.
  pendingEmail: { type: String },
  // Running totals kept by POST /exchanges/:id/rate; a user who predates them reads as unrated.
  // They are the only rating: the old `ratings` field, which sign-up set to 5, is no longer
  // read or written, though documents created before its removal may still carry it.
  ratingsCount: { type: Number, default: 0 },
  ratingsAvg:   { type: Number, default: 0 },

  // Set by an admin (routes/admin.js). A suspended reader cannot sign in, their
  // offers are off the market and nobody can message them or propose a trade to
  // them (lib/suspensions.js). `suspension` keeps when, by whom and why.
  suspended: { type: Boolean, default: false },
  suspension: {
    at: Date,
    by: { type: Schema.Types.ObjectId, ref: "User" },
    note: { type: String, maxlength: SUSPENSION_NOTE_MAX_LENGTH },
  },
  // Which notification emails the reader wants (lib/notifications.js). Every
  // category is on until the reader turns it off, including for accounts that
  // predate the setting: the defaults apply when a document is loaded, and the
  // senders only skip an explicit false.
  notifications: {
    messages: { type: Boolean, default: true },
    trades:   { type: Boolean, default: true },
    wishlist: { type: Boolean, default: true },
  },
  // Signs the reader's unsubscribe links; created with the first one. Never sent
  // to a client.
  notificationKey: { type: String, select: false },

  // Optional arrays if you want them (not required to make wishlist/offered work)
  wishlist: [{ type: Schema.Types.ObjectId, ref: "WishlistBook" }],
  offered:  [{ type: Schema.Types.ObjectId, ref: "OfferedBook" }],
});

// Unique under a strength-2 collation, so `Bob@x.com` cannot be stored beside
// `bob@x.com` even by a write that skips normalization. Queries do not use it (they
// would have to name the same collation); they use the plain `email_1` index above.
// A second index on the same key needs its own name. It is only ever added, so
// Mongoose's autoIndex builds it on an existing collection without dropping anything.
userSchema.index(
  { email: 1 },
  { name: "email_case_insensitive", unique: true, collation: { locale: "en", strength: 2 } }
);

// The suspended accounts are few, and every market listing looks them up.
userSchema.index({ suspended: 1 }, { partialFilterExpression: { suspended: true } });

// Wishlist book schema
const wishlistBookSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  title: String,
  author: String,
  publisher: String,
  year: String,
  cover: String,
  isbn: String,
  genre: String,
  desc: String,
});

// A reader's wishlist is read whole, for their shelf and for their matches.
wishlistBookSchema.index({ userId: 1 });
// A new offer looks up the readers who wishlisted its ISBN.
wishlistBookSchema.index({ isbn: 1 });

// Offered book schema
const offeredBookSchema = new Schema({
  owner: { type: Schema.Types.ObjectId, ref: "User", required: true },
  title: String,
  author: String,
  publisher: String,
  year: String,
  cover: String,
  isbn: String,
  genre: String,
  desc: String,
  locked: { type: Boolean, default: false },
  lockedByExchange: { type: mongoose.Schema.Types.ObjectId, ref: "Exchange", default: null },
  createdAt: { type: Date, default: Date.now },
});

// Wishlist matching looks offers up by ISBN among the books still on the market.
offeredBookSchema.index({ isbn: 1, locked: 1 });

// Conversations + Messages
// `lastMessageAt` / `lastMessageBy` copy the newest message so the unread count
// is one indexed query over conversations, and `readAt` maps each participant's
// id to the time of the newest message they have seen (routes/messages.js).
// `seenAt` maps the id to when they last marked the conversation read, by the
// clock. `notifiedAt` maps a participant's id to the message they were last
// emailed about; no other email goes out until `readAt` reaches it.
const conversationSchema = new Schema({
  users: [{ type: Schema.Types.ObjectId, ref: "User" }],
  lastMessageAt: { type: Date },
  lastMessageBy: { type: Schema.Types.ObjectId, ref: "User" },
  readAt: { type: Map, of: Date, default: {} },
  seenAt: { type: Map, of: Date, default: {} },
  notifiedAt: { type: Map, of: Date, default: {} },
});
conversationSchema.index({ users: 1, lastMessageAt: -1 });

const messageSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User" },
  conversation: { type: Schema.Types.ObjectId, ref: "Conversation" },
  createdAt: { type: Date, default: Date.now },
  content: String,
});
// Serves the thread, its incremental fetch (createdAt, then _id to break ties)
// and the per-conversation unread count.
messageSchema.index({ conversation: 1, createdAt: 1, _id: 1 });

// Wishlist notices
// One per reader and ISBN, keyed "<readerId>:<isbn>", holding when the reader was
// last emailed that the ISBN is offered (lib/notifications.js). The TTL index
// drops a notice once it no longer holds anything back.
const WISHLIST_NOTICE_INTERVAL_SECONDS = 30 * 24 * 60 * 60;
const wishlistNoticeSchema = new Schema(
  {
    _id: { type: String },
    sentAt: { type: Date, required: true },
  },
  { versionKey: false }
);
wishlistNoticeSchema.index({ sentAt: 1 }, { expireAfterSeconds: WISHLIST_NOTICE_INTERVAL_SECONDS });

// Blocks and reports
// A block works both ways: neither reader can message or propose a trade to the
// other, and neither sees the other's offers. Only the blocker can lift it.
const blockSchema = new Schema({
  blocker: { type: Schema.Types.ObjectId, ref: "User", required: true },
  blocked: { type: Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
});

// One block per pair and direction; the second index serves the reverse lookup.
blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
blockSchema.index({ blocked: 1 });

const REPORT_REASONS = ["SPAM", "HARASSMENT", "SCAM", "NO_SHOW", "INAPPROPRIATE", "OTHER"];
const REPORT_DETAILS_MAX_LENGTH = 1000;

// Reviewed on the admin reports page (routes/admin.js): a report is open until
// an admin marks it reviewed.
const reportSchema = new Schema({
  reporter: { type: Schema.Types.ObjectId, ref: "User", required: true },
  reported: { type: Schema.Types.ObjectId, ref: "User", required: true },
  reason: { type: String, enum: REPORT_REASONS, required: true },
  details: { type: String, default: "", maxlength: REPORT_DETAILS_MAX_LENGTH },
  createdAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
});

reportSchema.index({ reported: 1, createdAt: -1 });
reportSchema.index({ reviewedAt: 1, createdAt: -1 });

// --------------------
// Models (default connection)
// --------------------
const User = mongoose.models.User || mongoose.model("User", userSchema);
const WishlistBook =
  mongoose.models.WishlistBook || mongoose.model("WishlistBook", wishlistBookSchema);
const OfferedBook =
  mongoose.models.OfferedBook || mongoose.model("OfferedBook", offeredBookSchema);
const Conversation =
  mongoose.models.Conversation || mongoose.model("Conversation", conversationSchema);
const Message =
  mongoose.models.Message || mongoose.model("Message", messageSchema);
const WishlistNotice =
  mongoose.models.WishlistNotice || mongoose.model("WishlistNotice", wishlistNoticeSchema);
const Block = mongoose.models.Block || mongoose.model("Block", blockSchema);
const Report = mongoose.models.Report || mongoose.model("Report", reportSchema);

// --------------------
// (Optional) Legacy inject model helper
// --------------------
let BookModel = null;
function injectBookModel(model) {
  BookModel = model;
}
async function getBook(id) {
  if (!BookModel) throw new Error("Book model not injected");
  return await BookModel.findById(id);
}
async function getBooks(limit = 100) {
  if (!BookModel) throw new Error("Book model not injected");
  return await BookModel.find().limit(limit);
}
async function getGenres(limit = 10) {
  if (!BookModel) throw new Error("Book model not injected");
  const books = await BookModel.find().select("genre -_id");
  const uniqueGenres = [...new Set(books.map((b) => b.genre).filter(Boolean))];
  return uniqueGenres.slice(0, limit);
}

// --------------------
// Exports
// --------------------
export {
  User,
  WishlistBook,
  OfferedBook,
  Conversation,
  Message,
  WishlistNotice,
  WISHLIST_NOTICE_INTERVAL_SECONDS,
  Block,
  Report,
  REPORT_REASONS,
  REPORT_DETAILS_MAX_LENGTH,
  SUSPENSION_NOTE_MAX_LENGTH,

  // optional legacy exports
  injectBookModel,
  getBook,
  getBooks,
  getGenres,
};
