import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { body, matchedData, validationResult } from "express-validator";
import exchangesRouter from "./routes/exchanges.js";
import { buildCorsOptions } from "./lib/cors.js";
import { LOGIN_THROTTLED_MESSAGE, LoginThrottle } from "./lib/loginThrottle.js";
import {
  loginValidators,
  registerValidators,
  safeRegex,
  userEditValidators,
  validationProblem,
} from "./lib/validation.js";

dotenv.config();

import {
  User,
  WishlistBook,
  OfferedBook,
  Conversation,
  Message,
  searchGoogleBooks,
} from "./Data.js";

const app = express();

const loginThrottle = new LoginThrottle();

const INVALID_CREDENTIALS_MESSAGE = "Invalid credentials";

// New emails are stored normalized, but accounts created before that still hold
// whatever casing the user typed. A strength-2 collation compares case- and
// accent-insensitively inside Mongo, so those accounts stay reachable without
// rewriting them and without building a regex out of an address.
const CASE_INSENSITIVE = { locale: "en", strength: 2 };

// The unique index on `email` uses the simple collation, so this lookup cannot
// use it and scans the collection. Deliberate for now: every alternative is a
// live-database operation (a collation index, or a normalized field plus a
// backfill) and is tracked separately.
function findUserByEmail(email) {
  return User.findOne({ email }).collation(CASE_INSENSITIVE);
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

const authMiddleware = (req, res, next) => {
  // ✅ always allow preflight through
  if (req.method === "OPTIONS") return next();

  const header = req.header("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Access denied. No token provided." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId: ... }
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

//exchange routes
app.use("/exchanges", authMiddleware, exchangesRouter);

// --------------------
// PUBLIC ROUTES
// --------------------

app.post("/auth/register", registerValidators, async (req, res, next) => {
  const problem = validationProblem(req);
  if (problem) return res.status(400).json(problem);

  // matchedData returns only the validated + sanitized fields: the email is
  // already normalized and the strings are trimmed.
  const { username, email, password, location } = matchedData(req);

  try {
    const existingUser = await findUserByEmail(email);
    if (existingUser) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      username,
      email,
      password: hashedPassword,
      location,
      ratings: 5,
    });
    await user.save();

    res.status(201).json({ message: "User registered successfully" });
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

    const user = (await User.findOne({ email })) ?? (await findUserByEmail(email));

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

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "2h" });

    res.json({ token, user: { id: user._id, username: user.username } });
  } catch (err) {
    next(err);
  }
});

app.post("/logout", async (req, res) => {
  return res.status(200).json({ message: "Logged out successfully" });
})

app.get("/books/:id", async (req, res, next) => {
  try {
    const book = await OfferedBook.findById(req.params.id);
    if (!book) return res.status(404).json({ message: "Book not found" });

    const owner = await User.findById(book.owner);
    const result = { ...book["_doc"] };
    result.owner = owner ? { id: owner["_id"], username: owner.username } : null;

    res.json(result);
  } catch (err) {
    // A malformed id is simply "no such book" as far as the caller is
    // concerned; anything else is a real failure for the error handler.
    if (err?.name === "CastError") {
      return res.status(404).json({ message: "Book not found" });
    }
    next(err);
  }
});

app.get("/genres", async (req, res, next) => {
  try {
    const genres = await OfferedBook.distinct("genre");
    res.json(genres);
  } catch (err) {
    next(err);
  }
});

app.get("/genres/:genre", async (req, res, next) => {
  try {
    // Escaped before it reaches the regex engine: raw user text here would
    // otherwise be interpreted as a regex pattern.
    const books = await OfferedBook.find({ genre: safeRegex(req.params.genre) });
    res.json(books);
  } catch (err) {
    next(err);
  }
});

app.get("/new", async (req, res, next) => {
  try {
    const books = await OfferedBook.find().sort({ createdAt: -1 }).limit(20);
    res.json(books);
  } catch (err) {
    next(err);
  }
});

// Normalised (trimmed, lower-cased) value of a book field, "" when missing.
const normalised = (field) => ({ $toLower: { $trim: { input: { $ifNull: [field, ""] } } } });

// Books matching `match`, most wanted first: ranked by how many readers have the
// same book on their wishlist. Two books are the same when both carry an ISBN and
// it agrees; otherwise title and author agree, ignoring case. Ties, including the
// case where nothing is wishlisted yet, fall back to newest listing first.
function mostWanted(match, limit) {
  return OfferedBook.aggregate([
    { $match: match },
    {
      $lookup: {
        from: WishlistBook.collection.name,
        let: {
          bookIsbn: normalised("$isbn"),
          bookTitle: normalised("$title"),
          bookAuthor: normalised("$author"),
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $let: {
                  vars: {
                    isbn: normalised("$isbn"),
                    title: normalised("$title"),
                    author: normalised("$author"),
                  },
                  in: {
                    $cond: [
                      { $and: [{ $ne: ["$$bookIsbn", ""] }, { $ne: ["$$isbn", ""] }] },
                      { $eq: ["$$bookIsbn", "$$isbn"] },
                      {
                        $and: [
                          { $ne: ["$$bookTitle", ""] },
                          { $eq: ["$$bookTitle", "$$title"] },
                          { $eq: ["$$bookAuthor", "$$author"] },
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
          { $group: { _id: "$userId" } },
        ],
        as: "wantedBy",
      },
    },
    { $addFields: { wantedBy: { $size: "$wantedBy" } } },
    { $sort: { wantedBy: -1, createdAt: -1, _id: -1 } },
    { $limit: limit },
  ]);
}

app.get("/popular", async (req, res, next) => {
  try {
    const books = await mostWanted({ locked: false }, 20);
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

    const books = await OfferedBook.find({
      owner: { $ne: userId },
      locked: false,
    })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json(books);
  } catch (err) {
    next(err);
  }
});

app.get("/books", authMiddleware, async (req, res, next) => {
  const query = String(req.query.query ?? "").toLowerCase();
  const userId = req.user.userId;

  try {
    const books = await OfferedBook.find({
      owner: { $ne: userId },
      locked: false,
    });

    const filtered = books.filter(
      (book) =>
        (book.title || "").toLowerCase().includes(query) ||
        (book.author || "").toLowerCase().includes(query)
    );

    res.json(filtered);
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
    // Books committed to an accepted trade are off the market until it ends.
    const onMarket = { owner: { $ne: new mongoose.Types.ObjectId(userId) }, locked: false };

    /* ---------------- SEARCH ---------------- */
    // Escaped before it reaches the regex engine: raw input here would allow
    // regex injection and a pattern that backtracks catastrophically.
    const searchPattern = q ? safeRegex(q) : null;
    const searchResults = searchPattern
      ? await OfferedBook.find({
          ...onMarket,
          $or: [{ title: searchPattern }, { author: searchPattern }],
        })
          .sort({ createdAt: -1 })
          .limit(40)
      : [];

    /* ---------------- MOST WANTED ---------------- */
    const popular = await mostWanted(onMarket, LIMIT_SECTION);

    /* ---------------- NEW ---------------- */
    const newlyAdded = await OfferedBook.find(onMarket)
      .sort({ createdAt: -1 })
      .limit(LIMIT_SECTION);

    /* ---------------- RECOMMENDED ---------------- */
    const user = await User.findById(userId).select("location");
    let recommended = [];

    if (user?.location) {
      recommended = await OfferedBook.aggregate([
        { $match: onMarket },
        {
          $lookup: {
            from: "users",
            localField: "owner",
            foreignField: "_id",
            as: "ownerDetails",
          },
        },
        { $unwind: "$ownerDetails" },
        {
          $match: {
            "ownerDetails.location": user.location,
          },
        },
        // The joined owner document is only a filter; it never reaches the client.
        { $project: { ownerDetails: 0 } },
        { $sort: { createdAt: -1 } },
        { $limit: LIMIT_SECTION },
      ]);
    }

    /* ---------------- GENRES ---------------- */
    const genres = (
      await OfferedBook.distinct("genre", {
        ...onMarket,
        genre: { $ne: null },
      })
    )
      .filter(Boolean)
      .slice(0, GENRE_COUNT);

    const genreRows = {};
    for (const genre of genres) {
      genreRows[genre] = await OfferedBook.find({
        ...onMarket,
        genre,
      })
        .sort({ createdAt: -1 })
        .limit(LIMIT_ROW);
    }

    /* ---------------- RESPONSE ---------------- */
    res.json({
      q,
      searchResults,
      recommended,
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
    const me = await User.findById(req.user.userId).select("_id username email location ratings");
    if (!me) return res.status(404).json({ message: "User not found" });
    return res.json(me);
  } catch (err) {
    return next(err);
  }
});

// Public profile of another user. Requires a token, and returns only the
// fields the app renders - never the password hash or the email address.
app.get("/users/:id", authMiddleware, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findById(req.params.id).select("_id username location ratings");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(user);
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
    const books = await OfferedBook.find({
      owner: req.params.id,
      locked: false,              
    }).sort({ createdAt: -1 });

    res.json(books);
  } catch (err) {
    console.error("Error fetching offered books for user:", err);
    res.status(500).json({ error: "Failed to fetch offered books" });
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
        cover,
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
      const book = new OfferedBook({
        owner: req.user.userId, // ✅ from token
        title,
        author,
        publisher,
        year,
        cover,
        isbn,
        genre,
        desc,
      });

      await book.save();
      return res.status(201).json({ message: "successfully added offered book" });
    } catch (err) {
      console.error("ADD OFFERED ERROR:", err);
      return res.status(500).json({
        message: "Internal server error while adding offered book",
      });
    }
  }
);

app.get("/user/wishlist/:isbn", authMiddleware, async (req, res, next) => {
  const { isbn } = req.params;
  try {
    const book = await WishlistBook.findOne({ userId: req.user.userId, isbn });
    res.json({ exists: !!book });
  } catch (err) {
    next(err);
  }
});

app.get("/user/get-recommended-books", authMiddleware, async (req, res, next) => {
  const userId = req.user.userId;

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const userLocation = user.location;

    const books = await OfferedBook.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "owner",
          foreignField: "_id",
          as: "ownerDetails",
        },
      },
      { $unwind: "$ownerDetails" },
      {
        $match: {
          "ownerDetails.location": userLocation,
          owner: { $ne: new mongoose.Types.ObjectId(userId) },
        },
      },
      // The joined owner document is only a filter; it never reaches the client.
      { $project: { ownerDetails: 0 } },
      { $sort: { createdAt: -1 } },
    ]);

    res.json(books);
  } catch (err) {
    next(err);
  }
});

app.post("/user/edit", authMiddleware, userEditValidators, async (req, res) => {
  const problem = validationProblem(req);
  if (problem) return res.status(400).json({ message: problem.message });

  try {
    const userId = req.user.userId;
    const { username, location } = req.body.user;
    const email = matchedData(req).user?.email;

    const update = {};
    if (username?.trim()) update.username = username.trim();
    if (location?.trim()) update.location = location.trim();

    if (email) {
      // The lookup is case-insensitive, so this also refuses an address that
      // only differs in casing from an account stored before normalization.
      const owner = await findUserByEmail(email);
      if (owner && owner._id.toString() !== userId) {
        return res.status(409).json({ message: "Email already in use" });
      }
      update.email = email;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: update },
      { new: true }
    ).select("_id username email location ratings");
    res.json({ message: "User updated", user: updatedUser });
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


app.get("/messages", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const conversations = await Conversation.find({
      users: { $in: [userId] },
    });

    const formattedConversations = await Promise.all(
      conversations.map(async (convo) => {
        const otherUserId = String(convo.users[0]) === String(userId)
          ? convo.users[1]
          : convo.users[0];

        const otherUserResult = await User.findById(otherUserId).select(
          "_id username location ratings"
        );

        // ✅ get last message in this conversation
        const lastMsg = await Message.findOne({ conversation: convo._id })
          .sort({ createdAt: -1 })
          .select("content createdAt");

        const otherUserInfo = otherUserResult
          ? {
              id: otherUserResult._id,
              location: otherUserResult.location,
              ratings: otherUserResult.ratings,
              username: otherUserResult.username,
            }
          : {
              id: otherUserId,
              location: null,
              ratings: 0,
              username: "Unknown",
            };

        return {
          id: convo._id,
          otherUser: otherUserInfo,
          lastMessage: lastMsg?.content || "",
          lastAt: lastMsg?.createdAt || null,
        };
      })
    );

    // ✅ sort by lastAt (most recent first). Conversations with no messages go bottom.
    formattedConversations.sort((a, b) => {
      const ta = a.lastAt ? new Date(a.lastAt).getTime() : 0;
      const tb = b.lastAt ? new Date(b.lastAt).getTime() : 0;
      return tb - ta;
    });

    res.json(formattedConversations);
  } catch (err) {
    console.error("Error fetching conversations: ", err);
    res.status(500).json({
      message: "Internal server error while fetching conversations",
    });
  }
});

app.get("/messages/:user", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const otherUserId = req.params.user;

    if (!mongoose.isValidObjectId(otherUserId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const conversation = await Conversation.findOne({
      users: { $all: [userId, otherUserId] },
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const [requester, nonRequester] = await Promise.all([
      User.findById(userId).select("_id username location ratings"),
      User.findById(otherUserId).select("_id username location ratings"),
    ]);

    if (!requester || !nonRequester) {
      return res.status(404).json({ message: "User not found" });
    }

    const messages = await Message.find({ conversation: conversation._id })
      .sort({ createdAt: 1 }) // oldest -> newest for chat UI
      .lean();

    const formatted = messages.map((msg) => {
      const sender = String(msg.user) === String(userId) ? requester : nonRequester;
      const receiver = String(msg.user) === String(userId) ? nonRequester : requester;

      return {
        id: msg._id,
        sender,
        receiver,
        content: msg.content,
        timestamp: msg.createdAt,
      };
    });

    return res.json(formatted);
  } catch (err) {
    console.error("Error fetching messages:", err);
    return res.status(500).json({
      message: "Internal server error while fetching messages",
    });
  }
});

app.post("/messages/:user", authMiddleware, async (req, res) => {
  const { content } = req.body

  if (content === "") {
    res.status(200).json({message: "Empty message ignored"})
    return
  }

  try {
    let conversation = await Conversation.findOne({ 
      users: {
        $in: [[req.params.user, req.user.userId], [req.user.userId, req.params.user]]
      }, 
    })
    if (!conversation) {
      const newConversation = new Conversation({
        users: [req.params.user, req.user.userId]
      })

      conversation = await newConversation.save()
    }

    const conversationId = conversation["_id"]

    const message = new Message({
      content: content,
      conversation: conversationId,
      user: req.user.userId,
      createdAt: new Date()
    })

    await message.save()
    res.status(200).json({ messageId: message["_id"] })
  } 
  catch (err) {
    console.error("Error sending message: ", err.message)
    res.status(500).json({ message: "Internal server error while sending message" })
  }
})

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
