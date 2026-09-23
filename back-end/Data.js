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

// User schema
const userSchema = new Schema({
  username: { type: String, required: true },
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

  // Optional arrays if you want them (not required to make wishlist/offered work)
  wishlist: [{ type: Schema.Types.ObjectId, ref: "WishlistBook" }],
  offered:  [{ type: Schema.Types.ObjectId, ref: "OfferedBook" }],
});

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
const conversationSchema = new Schema({
  users: [{ type: Schema.Types.ObjectId, ref: "User" }],
  lastMessageAt: { type: Date },
  lastMessageBy: { type: Schema.Types.ObjectId, ref: "User" },
  readAt: { type: Map, of: Date, default: {} },
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

// Stored for later review; nothing in the app reads them back.
const reportSchema = new Schema({
  reporter: { type: Schema.Types.ObjectId, ref: "User", required: true },
  reported: { type: Schema.Types.ObjectId, ref: "User", required: true },
  reason: { type: String, enum: REPORT_REASONS, required: true },
  details: { type: String, default: "", maxlength: REPORT_DETAILS_MAX_LENGTH },
  createdAt: { type: Date, default: Date.now },
});

reportSchema.index({ reported: 1, createdAt: -1 });

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
  Block,
  Report,
  REPORT_REASONS,
  REPORT_DETAILS_MAX_LENGTH,

  // optional legacy exports
  injectBookModel,
  getBook,
  getBooks,
  getGenres,
};
