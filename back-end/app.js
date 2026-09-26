import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { body, matchedData, validationResult } from "express-validator";
import exchangesRouter from "./routes/exchanges.js";
import messagesRouter from "./routes/messages.js";
import adminRouter from "./routes/admin.js";
import mapRouter from "./routes/map.js";
import cronRouter from "./routes/cron.js";
import { isAdmin, requireAdmin } from "./lib/admin.js";
import { isSuspended, SUSPENDED_LOGIN_MESSAGE } from "./lib/suspensions.js";
import { buildCorsOptions } from "./lib/cors.js";
import { trustProxySetting } from "./lib/proxy.js";
import { LOGIN_THROTTLED_MESSAGE, LoginThrottle } from "./lib/loginThrottle.js";
import { consumeToken, hasLiveToken, issueToken, revokeTokens, TOKEN_PURPOSES } from "./lib/authTokens.js";
import { mail, resolveFrontEndBaseUrl } from "./lib/mail.js";
import { createSession, endSession, endUserSessions, useSession } from "./lib/sessions.js";
import { captureCover } from "./lib/covers.js";
import { runInBackground } from "./lib/background.js";
import { wishlistMatches } from "./lib/matches.js";
import { listBooks, mostWanted, NEWEST_FIRST, readerTaste, recommendations } from "./lib/listings.js";
import { bookPosition, distanceFields, moveOwnerBooks, readerArea, withinArea } from "./lib/nearby.js";
import { lookupZip } from "./lib/zipCodes.js";
import {
  NOTIFICATION_CATEGORIES,
  notificationSettings,
  notifyWishlistMatch,
  unsubscribe,
} from "./lib/notifications.js";
import {
  isBlockedBetween,
  marketFilter,
} from "./lib/blocks.js";
import {
  BOOK_SEARCH_UNAVAILABLE,
  BOOK_SEARCH_UNAVAILABLE_MESSAGE,
  GoogleBooksUnavailableError,
  searchGoogleBooks,
} from "./lib/googleBooks.js";
import {
  emailOnlyValidators,
  loginValidators,
  registerValidators,
  resetPasswordValidators,
  safeRegex,
  userEditValidators,
  validationProblem,
} from "./lib/validation.js";

dotenv.config();

import {
  User,
  WishlistBook,
  OfferedBook,
  Block,
  Report,
  REPORT_REASONS,
  REPORT_DETAILS_MAX_LENGTH,
} from "./Data.js";

const app = express();

app.set("trust proxy", trustProxySetting());

const loginThrottle = new LoginThrottle();

const INVALID_CREDENTIALS_MESSAGE = "Invalid credentials";

// Emailed links point at the front end; read once so a production process
// without FRONTEND_BASE_URL refuses to start instead of mailing dead links.
const FRONTEND_BASE_URL = resolveFrontEndBaseUrl();

const HOUR = 60 * 60 * 1000;

// Limits on the endpoints that send mail on request, so neither can be used
// to flood an inbox or to run up the sending quota. Every request counts, per
// address and per client, whether or not the address has an account.
const mailThrottles = (endpoint) => ({
  address: new LoginThrottle({
    scope: `${endpoint}:address`,
    windowMs: HOUR,
    lockoutMs: HOUR,
    accountMaxAttempts: 3,
  }),
  client: new LoginThrottle({
    scope: `${endpoint}:client`,
    windowMs: HOUR,
    lockoutMs: HOUR,
    accountMaxAttempts: 10,
  }),
});
const resendConfirmationThrottles = mailThrottles("resend-confirmation");
const forgotPasswordThrottles = mailThrottles("forgot-password");
const changeEmailThrottles = mailThrottles("change-email");

const MAIL_THROTTLED_MESSAGE = "Too many requests. Please try again later.";

// Reports are stored for review by hand, so one reader cannot bury them in volume.
const reportThrottle = new LoginThrottle({
  scope: "report",
  windowMs: HOUR,
  lockoutMs: HOUR,
  accountMaxAttempts: 10,
});

// Every Google Books call spends one of the key's shared daily requests, so
// each signed-in reader gets a budget of lookups; identical queries are also
// cached in lib/googleBooks.js.
const googleBooksThrottle = new LoginThrottle({
  scope: "google-books",
  windowMs: HOUR / 4,
  lockoutMs: HOUR / 4,
  accountMaxAttempts: 60,
});
const GOOGLE_BOOKS_THROTTLED_MESSAGE =
  "Too many book searches. Please try again in a few minutes.";

// Distances are measured from a reader's ZIP, so moving it at will would let a
// reader work out where others are from the distances shown at each ZIP.
const ZIP_CHANGES_PER_DAY = 3;
const zipChangeThrottle = new LoginThrottle({
  scope: "zip-change",
  windowMs: 24 * HOUR,
  lockoutMs: 24 * HOUR,
  accountMaxAttempts: ZIP_CHANGES_PER_DAY,
});
const ZIP_CHANGE_THROTTLED_MESSAGE = `You can change your ZIP code ${ZIP_CHANGES_PER_DAY} times a day. Please try again tomorrow.`;

// Answers 429 and returns true when the caller or the address is over its limit.
async function mailRequestLimited(throttles, req, res, email) {
  let limit = await throttles.client.hit(req.ip);
  if (!limit.limited) limit = await throttles.address.hit(email);
  if (!limit.limited) return false;

  res.set("Retry-After", String(limit.retryAfterSeconds));
  res.status(429).json({ message: MAIL_THROTTLED_MESSAGE });
  return true;
}

const EMAIL_NOT_CONFIRMED = "EMAIL_NOT_CONFIRMED";
const ACCOUNT_SUSPENDED = "ACCOUNT_SUSPENDED";
const TOKEN_INVALID = "TOKEN_INVALID";

const frontEndLink = (path, token) =>
  `${FRONTEND_BASE_URL}${path}?token=${encodeURIComponent(token)}`;

// Mail goes out after the response is decided, not before: a slow or failing
// provider neither holds up the request nor, for the endpoints that must answer
// identically for unknown addresses, makes a known address take longer.
function sendInBackground(send, what) {
  runInBackground(send, `send ${what}`);
}

async function sendEmailConfirmation(user) {
  const token = await issueToken(TOKEN_PURPOSES.confirmEmail, user._id);
  sendInBackground(
    mail.sendEmailConfirmation(user.email, frontEndLink("/confirm-email", token)),
    "email confirmation"
  );
}

// A pending email counts only while the link mailed to it can still be used.
// Once that token has expired or been spent, the stale address is dropped; the
// filter on its value keeps a newer request made meanwhile.
async function withLivePendingEmail(user) {
  if (!user?.pendingEmail) return user;
  if (await hasLiveToken(TOKEN_PURPOSES.changeEmail, user._id)) return user;

  await User.updateOne(
    { _id: user._id, pendingEmail: user.pendingEmail },
    { $unset: { pendingEmail: 1 } }
  );
  user.pendingEmail = undefined;
  return user;
}

// --------------------
// Middleware
// --------------------
const corsOptions = buildCorsOptions();
app.use(cors(corsOptions));
app.options("*", cors(corsOptions)); // allow preflight
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const bearerToken = (req) => {
  const header = req.header("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
};

// Every authenticated request looks its session up (lib/sessions.js), which
// also slides the session's expiry forward.
const authMiddleware = async (req, res, next) => {
  // ✅ always allow preflight through
  if (req.method === "OPTIONS") return next();

  const token = bearerToken(req);

  if (!token) {
    return res.status(401).json({ message: "Access denied. No token provided." });
  }

  try {
    const session = await useSession(token);
    if (!session) {
      return res.status(401).json({ message: "Your session has ended. Please sign in again." });
    }
    req.user = { userId: String(session.user) };
    next();
  } catch (err) {
    next(err);
  }
};

// For the public book routes: a signed-in caller is identified so their blocks
// apply; anyone else, including a token that no longer names a session, reads
// as signed out rather than being refused.
const optionalAuth = async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) return next();

  try {
    const session = await useSession(token);
    if (session) req.user = { userId: String(session.user) };
    next();
  } catch (err) {
    next(err);
  }
};

// The fields of another reader that the app shows wherever it names them.
// `location` is their place name; their ZIP and point never leave the server.
const PUBLIC_USER_FIELDS = "_id username location ratingsAvg ratingsCount";

// The caller's own settings, on top of the public fields, for their profile.
const OWN_USER_FIELDS = `${PUBLIC_USER_FIELDS} email pendingEmail zip maxDistanceMiles`;

//exchange routes
app.use("/exchanges", authMiddleware, exchangesRouter);

// Books by place, for the map page.
app.use("/map", authMiddleware, mapRouter);

// Reports and suspensions, for the accounts named by ADMIN_EMAILS only.
app.use("/admin", authMiddleware, requireAdmin, adminRouter);

// Scheduled jobs, for Vercel Cron only (CRON_SECRET).
app.use("/cron", cronRouter);

// --------------------
// PUBLIC ROUTES
// --------------------

app.post("/auth/register", registerValidators, async (req, res, next) => {
  const problem = validationProblem(req);
  if (problem) return res.status(400).json(problem);

  // matchedData returns only the validated + sanitized fields: the email is
  // already normalized and the strings are trimmed.
  const { username, email, password, zip } = matchedData(req);
  const where = lookupZip(zip);

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      username,
      email,
      password: hashedPassword,
      zip: where.zip,
      location: where.place,
      geo: where.point,
      emailVerified: false,
    });
    await user.save();

    await sendEmailConfirmation(user);

    res.status(201).json({
      message: "Account created. Check your email for a link to confirm your address.",
    });
  } catch (err) {
    // The unique index on email catches a signup that lost the race above.
    if (err?.code === 11000) {
      return res.status(400).json({ message: "User already exists" });
    }
    next(err);
  }
});

app.post("/auth/login", loginValidators, async (req, res, next) => {
  // A malformed body is answered exactly like a wrong password, so the caller
  // learns nothing from the shape of the response.
  if (validationProblem(req)) {
    return res.status(400).json({ message: INVALID_CREDENTIALS_MESSAGE });
  }

  const { email, password } = matchedData(req);

  try {
    const limit = await loginThrottle.check(email);
    if (limit.limited) {
      res.set("Retry-After", String(limit.retryAfterSeconds));
      return res.status(429).json({ message: LOGIN_THROTTLED_MESSAGE });
    }

    const user = await User.findOne({ email });

    const isMatch = user?.password
      ? await bcrypt.compare(password, user.password)
      : false;

    if (!isMatch) {
      // Failures are recorded for unknown emails too, so lockout behaviour is
      // identical whether or not the account exists.
      await loginThrottle.recordFailure(email);
      return res.status(400).json({ message: INVALID_CREDENTIALS_MESSAGE });
    }

    await loginThrottle.recordSuccess(email);

    // Only an explicit false: accounts from before confirmation existed have
    // no flag and count as confirmed. Checked after the password, so the
    // answer tells nothing to someone who does not know it.
    if (user.emailVerified === false) {
      return res.status(403).json({
        message: "Please confirm your email address before signing in.",
        code: EMAIL_NOT_CONFIRMED,
      });
    }

    const token = await createSession(user._id);

    // Also only after the password, for the same reason. Checked afresh after
    // the session exists: a suspension that lands during bcrypt has already
    // ended the reader's sessions, so this one must not survive it.
    if (await isSuspended(user._id)) {
      await endSession(token);
      return res.status(403).json({ message: SUSPENDED_LOGIN_MESSAGE, code: ACCOUNT_SUSPENDED });
    }

    res.json({ token, user: { id: user._id, username: user.username } });
  } catch (err) {
    next(err);
  }
});

app.post("/auth/confirm-email", async (req, res, next) => {
  try {
    const userId = await consumeToken(TOKEN_PURPOSES.confirmEmail, req.body?.token);
    const updated = userId
      ? await User.updateOne({ _id: userId }, { $set: { emailVerified: true } })
      : null;

    if (!updated?.matchedCount) {
      return res.status(400).json({
        message: "This confirmation link has expired or has already been used.",
        code: TOKEN_INVALID,
      });
    }

    res.json({ message: "Email confirmed. You can sign in now." });
  } catch (err) {
    next(err);
  }
});

app.post("/auth/confirm-email-change", async (req, res, next) => {
  try {
    const userId = await consumeToken(TOKEN_PURPOSES.changeEmail, req.body?.token);
    const user = userId ? await User.findById(userId) : null;

    if (!user?.pendingEmail) {
      return res.status(400).json({
        message: "This confirmation link has expired or has already been used.",
        code: TOKEN_INVALID,
      });
    }

    // Another account may have taken the address since the link was sent.
    const owner = await User.findOne({ email: user.pendingEmail });
    if (owner && !owner._id.equals(user._id)) {
      await User.updateOne({ _id: user._id }, { $unset: { pendingEmail: 1 } });
      return res.status(409).json({ message: "Email already in use" });
    }

    user.email = user.pendingEmail;
    user.pendingEmail = undefined;
    try {
      await user.save();
    } catch (err) {
      if (err?.code !== 11000) throw err;
      return res.status(409).json({ message: "Email already in use" });
    }

    // Reset links went to the old address; none of them may outlive the change.
    await revokeTokens(TOKEN_PURPOSES.resetPassword, user._id);

    res.json({ message: "Email changed. Use your new address to sign in." });
  } catch (err) {
    next(err);
  }
});

// Answers the same whether or not the address has an account, or is already
// confirmed, so it cannot be used to find out who has signed up.
app.post("/auth/resend-confirmation", emailOnlyValidators, async (req, res, next) => {
  const problem = validationProblem(req);
  if (problem) return res.status(400).json(problem);

  const { email } = matchedData(req);

  try {
    if (await mailRequestLimited(resendConfirmationThrottles, req, res, email)) return;

    const user = await User.findOne({ email });
    if (user && user.emailVerified === false) await sendEmailConfirmation(user);

    res.json({
      message: "If that address has an account waiting to be confirmed, we have sent it a new link.",
    });
  } catch (err) {
    next(err);
  }
});

// Answers the same whether or not the address has an account.
app.post("/auth/forgot-password", emailOnlyValidators, async (req, res, next) => {
  const problem = validationProblem(req);
  if (problem) return res.status(400).json(problem);

  const { email } = matchedData(req);

  try {
    if (await mailRequestLimited(forgotPasswordThrottles, req, res, email)) return;

    const user = await User.findOne({ email });
    if (user) {
      const token = await issueToken(TOKEN_PURPOSES.resetPassword, user._id);
      sendInBackground(
        mail.sendPasswordReset(user.email, frontEndLink("/reset-password", token)),
        "password reset"
      );
    }

    res.json({
      message: "If an account uses that address, we have sent it a link to reset the password.",
    });
  } catch (err) {
    next(err);
  }
});

app.post("/auth/reset-password", resetPasswordValidators, async (req, res, next) => {
  // Validated before the token is touched, so a password the rules refuse
  // leaves the link usable for another try.
  const problem = validationProblem(req);
  if (problem) return res.status(400).json(problem);

  const { token, password } = matchedData(req);

  try {
    const userId = await consumeToken(TOKEN_PURPOSES.resetPassword, token);
    const user = userId ? await User.findById(userId) : null;

    if (!user) {
      return res.status(400).json({
        message: "This reset link has expired or has already been used.",
        code: TOKEN_INVALID,
      });
    }

    // Following the emailed link proves the address, so it confirms it too.
    user.password = await bcrypt.hash(password, 10);
    user.emailVerified = true;
    await user.save();

    await revokeTokens(TOKEN_PURPOSES.resetPassword, user._id);
    await revokeTokens(TOKEN_PURPOSES.confirmEmail, user._id);
    // A new password signs the account out everywhere, so a stolen sign-in
    // does not outlive the reset.
    await endUserSessions(user._id);
    await loginThrottle.recordSuccess(user.email);

    res.json({ message: "Password updated. You can sign in with it now." });
  } catch (err) {
    next(err);
  }
});

// The one-click unsubscribe link in every notification email. It needs no
// sign-in: the signed token names the reader and the category it turns off.
app.post("/notifications/unsubscribe", async (req, res, next) => {
  try {
    const category = await unsubscribe(req.body?.token);
    if (!category) {
      return res.status(400).json({
        message: "This unsubscribe link is not valid.",
        code: TOKEN_INVALID,
      });
    }
    res.json({ category, message: "You will no longer get these emails." });
  } catch (err) {
    next(err);
  }
});

// Ends this browser's session only. Answered the same whether or not the
// token was still live, so signing out never fails.
app.post("/logout", async (req, res, next) => {
  try {
    await endSession(bearerToken(req));
    res.status(200).json({ message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
});

// A direct link opens a book wherever it is, beyond the caller's distance too,
// and says how far away it is (beyond it, only that it is farther).
app.get("/books/:id", optionalAuth, async (req, res, next) => {
  try {
    const book = await OfferedBook.findById(req.params.id).select("+ownerGeo");
    if (!book) return res.status(404).json({ message: "Book not found" });

    // A blocked or suspended reader's offers do not exist as far as others are concerned.
    if (
      (await isSuspended(book.owner)) ||
      (req.user && (await isBlockedBetween(req.user.userId, book.owner)))
    ) {
      return res.status(404).json({ message: "Book not found" });
    }

    const owner = await User.findById(book.owner).select("username location");
    const { ownerGeo, ...result } = book.toObject();
    result.owner = owner ? { id: owner._id, username: owner.username, location: owner.location } : null;
    res.json({ ...result, ...distanceFields(await readerArea(req.user?.userId), ownerGeo) });
  } catch (err) {
    // A malformed id is simply "no such book" as far as the caller is
    // concerned; anything else is a real failure for the error handler.
    if (err?.name === "CastError") {
      return res.status(404).json({ message: "Book not found" });
    }
    next(err);
  }
});

app.get("/genres", optionalAuth, async (req, res, next) => {
  try {
    const genres = await OfferedBook.distinct(
      "genre",
      withinArea(await readerArea(req.user?.userId))
    );
    res.json(genres);
  } catch (err) {
    next(err);
  }
});

app.get("/genres/:genre", optionalAuth, async (req, res, next) => {
  try {
    // Escaped before it reaches the regex engine: raw user text here would
    // otherwise be interpreted as a regex pattern.
    const books = await listBooks({
      area: await readerArea(req.user?.userId),
      match: {
        ...(await marketFilter(req.user?.userId, { includeOwn: true })),
        genre: safeRegex(req.params.genre),
      },
    });
    res.json(books);
  } catch (err) {
    next(err);
  }
});

app.get("/new", optionalAuth, async (req, res, next) => {
  try {
    const books = await listBooks({
      area: await readerArea(req.user?.userId),
      match: await marketFilter(req.user?.userId, { includeOwn: true }),
      sort: NEWEST_FIRST,
      limit: 20,
    });
    res.json(books);
  } catch (err) {
    next(err);
  }
});

app.get("/popular", optionalAuth, async (req, res, next) => {
  try {
    const books = await mostWanted(
      await readerArea(req.user?.userId),
      await marketFilter(req.user?.userId, { includeOwn: true }),
      20
    );
    res.json(books);
  } catch (err) {
    next(err);
  }
});

// --------------------
// PROTECTED ROUTES
// --------------------

app.get("/feed", authMiddleware, async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const books = await listBooks({
      area: await readerArea(userId),
      match: await marketFilter(userId),
      limit: 20,
    });

    res.json(books);
  } catch (err) {
    next(err);
  }
});

app.get("/books", authMiddleware, async (req, res, next) => {
  const query = String(req.query.query ?? "").trim();
  const userId = req.user.userId;

  try {
    // Escaped before it reaches the regex engine, as in /browse.
    const pattern = query ? safeRegex(query) : null;
    const books = await listBooks({
      area: await readerArea(userId),
      match: {
        ...(await marketFilter(userId)),
        ...(pattern ? { $or: [{ title: pattern }, { author: pattern }] } : {}),
      },
    });

    res.json(books);
  } catch (err) {
    next(err);
  }
});

// GET /browse?q=optionalSearch
app.get("/browse", authMiddleware, async (req, res, next) => {
  const q = String(req.query.q ?? "").trim();
  const userId = req.user.userId;

  const LIMIT_SECTION = 20;
  const LIMIT_ROW = 16;
  const GENRE_COUNT = 8;

  try {
    // Books committed to an accepted trade are off the market until it ends,
    // a blocked reader's books are hidden in both directions, and a book
    // beyond the reader's distance is not shown at all.
    const onMarket = await marketFilter(userId);
    const area = await readerArea(userId);

    /* ---------------- SEARCH ---------------- */
    // Escaped before it reaches the regex engine: raw input here would allow
    // regex injection and a pattern that backtracks catastrophically.
    const searchPattern = q ? safeRegex(q) : null;
    const searchResults = searchPattern
      ? await listBooks({
          area,
          match: { ...onMarket, $or: [{ title: searchPattern }, { author: searchPattern }] },
          limit: 40,
        })
      : [];

    /* ---------------- MOST WANTED ---------------- */
    const popular = await mostWanted(area, onMarket, LIMIT_SECTION);

    /* ---------------- NEW ---------------- */
    const newlyAdded = await listBooks({
      area,
      match: onMarket,
      sort: NEWEST_FIRST,
      limit: LIMIT_SECTION,
    });

    /* ---------------- GENRES ---------------- */
    const genres = (
      await OfferedBook.distinct("genre", {
        ...onMarket,
        ...withinArea(area),
        genre: { $ne: null },
      })
    )
      .filter(Boolean)
      .slice(0, GENRE_COUNT);

    const genreRows = {};
    for (const genre of genres) {
      genreRows[genre] = await listBooks({ area, match: { ...onMarket, genre }, limit: LIMIT_ROW });
    }

    /* ---------------- RESPONSE ---------------- */
    // `area` is the caller's own place and distance; null until they add a ZIP.
    res.json({
      q,
      area: area && { place: area.place, miles: area.miles },
      searchResults,
      popular,
      newlyAdded,
      genres,
      genreRows,
    });
  } catch (err) {
    console.error("BROWSE ERROR:", err);
    next(err);
  }
});


app.get("/user", authMiddleware, async (req, res, next) => {
  try {
    const me = await withLivePendingEmail(
      await User.findById(req.user.userId).select(`${OWN_USER_FIELDS} emailVerified notifications`)
    );
    if (!me) return res.status(404).json({ message: "User not found" });

    // `isAdmin` only decides whether the front end offers the admin page; the
    // admin routes check for themselves.
    const { emailVerified, ...fields } = me.toObject();
    return res.json({
      ...fields,
      notifications: notificationSettings(me),
      isAdmin: isAdmin({ email: me.email, emailVerified }),
    });
  } catch (err) {
    return next(err);
  }
});

// body: any of { messages, trades, wishlist } as booleans; answers every setting.
app.post("/user/notifications", authMiddleware, async (req, res, next) => {
  const body = req.body ?? {};
  const update = {};
  for (const category of NOTIFICATION_CATEGORIES) {
    if (body[category] === undefined) continue;
    if (typeof body[category] !== "boolean") {
      return res.status(400).json({ message: `${category} must be true or false.` });
    }
    update[`notifications.${category}`] = body[category];
  }

  try {
    const user = await User.findByIdAndUpdate(req.user.userId, { $set: update }, { new: true })
      .select("notifications");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ notifications: notificationSettings(user) });
  } catch (err) {
    next(err);
  }
});

// Public profile of another user. Requires a token, and returns only the
// fields the app renders - never the password hash or the email address.
// `blockedByMe` says whether the caller has blocked them; whether they have
// blocked the caller is never revealed.
app.get("/users/:id", authMiddleware, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findById(req.params.id).select(PUBLIC_USER_FIELDS).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    const blockedByMe = Boolean(
      await Block.exists({ blocker: req.user.userId, blocked: user._id })
    );

    res.json({ ...user, blockedByMe });
  } catch (err) {
    next(err);
  }
});

app.get("/user/wishlist", authMiddleware, async (req, res, next) => {
  try {
    const books = await WishlistBook.find({ userId: req.user.userId });
    res.json(books);
  } catch (err) {
    next(err);
  }
});

app.get("/user/offered", authMiddleware, async (req, res, next) => {
  try {
    const books = await OfferedBook.find({ owner: req.user.userId });
    res.json(books);
  } catch (err) {
    next(err);
  }
});

app.get("/users/:id/wishlist", authMiddleware, async (req, res) => {
  try {
    const books = await WishlistBook.find({ userId: req.params.id });
    res.json(books);
  } catch (err) {
    console.error("Error fetching wishlist for user:", err);
    res.status(500).json({ error: "Failed to fetch wishlist" });
  }
});

app.get("/users/:id/offered", authMiddleware, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    // Blocked either way, or suspended, their shelf reads as empty.
    if (
      (await isSuspended(req.params.id)) ||
      (await isBlockedBetween(req.user.userId, req.params.id))
    ) {
      return res.json([]);
    }

    const books = await OfferedBook.find({
      owner: req.params.id,
      locked: false,
    })
      .sort({ createdAt: -1 })
      .lean();

    // Their shelf opens wherever they are, each book saying how far away it is.
    const owner = await User.findById(req.params.id).select("geo").lean();
    const distance = distanceFields(await readerArea(req.user.userId), owner?.geo);
    res.json(books.map((book) => ({ ...book, ...distance })));
  } catch (err) {
    console.error("Error fetching offered books for user:", err);
    res.status(500).json({ error: "Failed to fetch offered books" });
  }
});

// --------------------
// GOOGLE BOOKS PROXY
// --------------------
// The browser never calls Google Books: these routes do, with the server-side
// key. A refusal from Google (quota spent, key missing or rejected) answers 503
// with BOOK_SEARCH_UNAVAILABLE rather than an empty result.

async function googleBooksLimit(req, res, next) {
  try {
    const limit = await googleBooksThrottle.hit(req.user.userId);
    if (!limit.limited) return next();

    res.set("Retry-After", String(limit.retryAfterSeconds));
    res.status(429).json({ message: GOOGLE_BOOKS_THROTTLED_MESSAGE });
  } catch (err) {
    next(err);
  }
}

function googleBooksFailure(err, res, next) {
  if (!(err instanceof GoogleBooksUnavailableError)) return next(err);

  console.error("Google Books lookup failed:", err.reason);
  res.status(503).json({ message: BOOK_SEARCH_UNAVAILABLE_MESSAGE, code: BOOK_SEARCH_UNAVAILABLE });
}

const GOOGLE_QUERY_MAX_LENGTH = 200;

app.get("/google-books/search", authMiddleware, googleBooksLimit, async (req, res, next) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2 || q.length > GOOGLE_QUERY_MAX_LENGTH) {
    return res
      .status(400)
      .json({ message: `Search for 2 to ${GOOGLE_QUERY_MAX_LENGTH} characters.` });
  }

  try {
    res.json({ books: await searchGoogleBooks(q) });
  } catch (err) {
    googleBooksFailure(err, res, next);
  }
});

app.post(
  "/user/add-wishlist-book",
  authMiddleware,
  body("title").notEmpty(),
  body("author").notEmpty(),
  body("isbn").notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { title, author, publisher, year, cover, isbn, genre, desc } = req.body;

    try {
      const book = new WishlistBook({
        userId: req.user.userId,
        title,
        author,
        publisher,
        year,
        cover: await captureCover({ cover, isbn }),
        isbn,
        genre,
        desc,
      });

      await book.save();

      // IMPORTANT: return so nothing else runs
      return res.status(201).json({ message: "successfully added wishlist book" });
    } catch (err) {
      console.error("ADD WISHLIST ERROR:", err);
      console.error("STACK:", err?.stack);
      return res.status(500).json({
        message: "Internal server error while adding wishlist book",
      });
    }
  }
);

app.post(
  "/user/add-offered-book",
  authMiddleware,
  body("title").notEmpty(),
  body("author").notEmpty(),
  body("isbn").notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { title, author, publisher, year, cover, isbn, genre, desc } = req.body;

    try {
      // The book is placed where its owner is, for distance queries and the map.
      const owner = await User.findById(req.user.userId).select("geo location").lean();
      const book = new OfferedBook({
        owner: req.user.userId, // ✅ from token
        ...bookPosition(owner),
        title,
        author,
        publisher,
        year,
        cover: await captureCover({ cover, isbn }),
        isbn,
        genre,
        desc,
      });

      await book.save();
      notifyWishlistMatch(book);
      return res.status(201).json({ message: "successfully added offered book" });
    } catch (err) {
      console.error("ADD OFFERED ERROR:", err);
      return res.status(500).json({
        message: "Internal server error while adding offered book",
      });
    }
  }
);

// The caller's wishlisted books that other readers are offering right now,
// matched on ISBN (lib/matches.js), each offer carrying its owner.
app.get("/user/wishlist/matches", authMiddleware, async (req, res, next) => {
  try {
    res.json(await wishlistMatches(req.user.userId, PUBLIC_USER_FIELDS));
  } catch (err) {
    next(err);
  }
});

app.get("/user/wishlist/:isbn", authMiddleware, async (req, res, next) => {
  const { isbn } = req.params;
  try {
    const book = await WishlistBook.findOne({ userId: req.user.userId, isbn });
    res.json({ exists: !!book });
  } catch (err) {
    next(err);
  }
});

// Books for the caller: other readers' books on the market within their
// distance, ranked by the authors and genres on the caller's wishlist and
// shelf, then by how many readers want them, then nearest first
// (lib/listings.js).
app.get("/recommendations", authMiddleware, async (req, res, next) => {
  const userId = req.user.userId;

  try {
    const [area, match, taste] = await Promise.all([
      readerArea(userId),
      marketFilter(userId),
      readerTaste(userId),
    ]);
    res.json(await recommendations({ area, match, taste, limit: 20 }));
  } catch (err) {
    next(err);
  }
});

app.post("/user/edit", authMiddleware, userEditValidators, async (req, res) => {
  const problem = validationProblem(req);
  if (problem) return res.status(400).json({ message: problem.message });

  try {
    const userId = req.user.userId;
    const { username } = req.body.user;
    const { email, zip, maxDistanceMiles } = matchedData(req).user ?? {};

    const update = {};
    if (username?.trim()) update.username = username.trim();
    if (maxDistanceMiles !== undefined && maxDistanceMiles !== null) {
      update.maxDistanceMiles = maxDistanceMiles;
    }
    // The ZIP sets the place others see and the point the reader's books are
    // found by, so a new one moves every book of theirs too.
    const where = zip ? lookupZip(zip) : null;
    if (where) {
      const current = await User.findById(userId).select("zip").lean();
      if (current?.zip !== where.zip) {
        const limit = await zipChangeThrottle.hit(userId);
        if (limit.limited) {
          res.set("Retry-After", String(limit.retryAfterSeconds));
          return res.status(429).json({ message: ZIP_CHANGE_THROTTLED_MESSAGE });
        }
      }
      update.zip = where.zip;
      update.location = where.place;
      update.geo = where.point;
    }

    // A new address only becomes the account's email once the link mailed to it
    // is followed; until then it is held as pending.
    let pendingEmail = null;
    if (email) {
      const owner = await User.findOne({ email });
      if (owner && owner._id.toString() !== userId) {
        return res.status(409).json({ message: "Email already in use" });
      }
      if (!owner) {
        if (await mailRequestLimited(changeEmailThrottles, req, res, email)) return;
        pendingEmail = email;
        update.pendingEmail = email;
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: update },
      { new: true }
    ).select(OWN_USER_FIELDS);
    if (where && updatedUser) {
      await moveOwnerBooks(userId, { geo: where.point, location: where.place });
    }

    if (pendingEmail && updatedUser) {
      const token = await issueToken(TOKEN_PURPOSES.changeEmail, updatedUser._id);
      sendInBackground(
        mail.sendEmailChangeConfirmation(pendingEmail, frontEndLink("/confirm-email-change", token)),
        "email change confirmation"
      );
      return res.json({
        message: `We sent a confirmation link to ${pendingEmail}. Your email changes once you follow it.`,
        confirmationSentTo: pendingEmail,
        user: updatedUser,
      });
    }

    res.json({ message: "User updated", user: await withLivePendingEmail(updatedUser) });
  } catch (err) {
    console.error("Error updating user:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.delete("/user/wishlist/:id", authMiddleware, async (req, res) => {
  try {
    const book = await WishlistBook.findOneAndDelete({ _id: req.params.id, userId: req.user.userId });
    if (!book) return res.status(404).json({ message: "Book not found or not authorized" });
    res.json({ message: "Book successfully deleted" });
  } catch (err) {
    console.error("Error deleting wishlist book:", err);
    res.status(500).json({ message: "Internal server error while deleting wishlist book" });
  }
});

app.delete("/user/offered/:id", authMiddleware, async (req, res) => {
  try {
    const book = await OfferedBook.findOneAndDelete({
      _id: req.params.id,
      owner: mongoose.Types.ObjectId.createFromHexString(req.user.userId),
    });

    if (!book) return res.status(404).json({ message: "Book not found or not authorized" });
    res.json({ message: "Book successfully deleted" });
  } catch (err) {
    console.error("Error deleting offered book:", err);
    res.status(500).json({ message: "Internal server error while deleting offered book" });
  }
});


// Conversations, unread state and the incremental fetch the client polls.
app.use("/messages", authMiddleware, messagesRouter);

// --------------------
// BLOCKS AND REPORTS
// --------------------

// The readers the caller has blocked, most recent first, for unblocking.
app.get("/user/blocks", authMiddleware, async (req, res, next) => {
  try {
    const blocks = await Block.find({ blocker: req.user.userId })
      .sort({ createdAt: -1 })
      .populate("blocked", "_id username")
      .lean();

    res.json(
      blocks
        .filter((b) => b.blocked)
        .map((b) => ({ _id: b.blocked._id, username: b.blocked.username, blockedAt: b.createdAt }))
    );
  } catch (err) {
    next(err);
  }
});

// Resolves the reader named by :id for the block and report routes, answering
// 400 for a malformed id or the caller's own, and 404 for no such reader.
async function otherReader(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: "Invalid user id" });
    return null;
  }
  if (id === req.user.userId) {
    res.status(400).json({ message: "You can't do that to yourself." });
    return null;
  }

  const user = await User.findById(id).select("_id");
  if (!user) res.status(404).json({ message: "User not found" });
  return user;
}

// Blocking twice is the same as blocking once.
app.post("/users/:id/block", authMiddleware, async (req, res, next) => {
  try {
    const user = await otherReader(req, res);
    if (!user) return;

    await Block.updateOne(
      { blocker: req.user.userId, blocked: user._id },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );

    res.json({ message: "Reader blocked", blockedByMe: true });
  } catch (err) {
    // Two simultaneous blocks race on the unique index; the block exists either way.
    if (err?.code === 11000) return res.json({ message: "Reader blocked", blockedByMe: true });
    next(err);
  }
});

// Lifts only the caller's own block; one the other reader placed stays.
app.delete("/users/:id/block", authMiddleware, async (req, res, next) => {
  try {
    const user = await otherReader(req, res);
    if (!user) return;

    await Block.deleteOne({ blocker: req.user.userId, blocked: user._id });
    res.json({ message: "Reader unblocked", blockedByMe: false });
  } catch (err) {
    next(err);
  }
});

// body: { reason: one of REPORT_REASONS, details?: string }
app.post("/users/:id/report", authMiddleware, async (req, res, next) => {
  const { reason } = req.body ?? {};
  const details = typeof req.body?.details === "string" ? req.body.details.trim() : "";

  if (!REPORT_REASONS.includes(reason)) {
    return res.status(400).json({ message: "Choose a reason for the report." });
  }
  if (details.length > REPORT_DETAILS_MAX_LENGTH) {
    return res
      .status(400)
      .json({ message: `Keep the details under ${REPORT_DETAILS_MAX_LENGTH} characters.` });
  }

  try {
    const user = await otherReader(req, res);
    if (!user) return;

    const limit = await reportThrottle.hit(req.user.userId);
    if (limit.limited) {
      res.set("Retry-After", String(limit.retryAfterSeconds));
      return res.status(429).json({ message: MAIL_THROTTLED_MESSAGE });
    }

    await Report.create({ reporter: req.user.userId, reported: user._id, reason, details });
    res.status(201).json({ message: "Thanks. Your report has been recorded." });
  } catch (err) {
    next(err);
  }
});

// --------------------
// Error handling
// --------------------

// Final error handler. Everything that reaches here is logged in full on the
// server and answered with a generic message: `err.message` and stack traces
// routinely carry query fragments, schema details and connection information,
// none of which belong in a client response.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);

  if (res.headersSent) return next(err);

  const status =
    Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;

  res.status(status).json({
    // Only a deliberate 4xx carries its own message; a 500 never does.
    message: status === 500 ? "Internal server error" : err.message || "Request failed",
  });
});

export default app;
