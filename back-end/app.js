import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import exchangesRouter from "./routes/exchanges.js";

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

// --------------------
// Middleware
// --------------------
app.use(cors());
app.options("*", cors()); // allow preflight
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

app.post("/auth/register", async (req, res) => {
  const { username, email, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword, location: null, ratings: 5 });
    await user.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "2h" });

    res.json({ token, user: { id: user._id, username: user.username } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/logout", async (req, res) => {
  return res.status(200).json({ message: "Logged out successfully" });
})

app.get("/books/:id", async (req, res) => {
  try {
    const book = await OfferedBook.findById(req.params.id);
    if (!book) return res.status(404).json({ error: "Book not found" });

    const owner = await User.findById(book.owner);
    const result = { ...book["_doc"] };
    result.owner = owner ? { id: owner["_id"], username: owner.username } : null;

    res.json(result);
  } catch (err) {
    res.status(404).json({ error: "Book not found: " + err.message });
  }
});

app.get("/genres", async (req, res) => {
  try {
    const genres = await OfferedBook.distinct("genre");
    res.json(genres);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/genres/:genre", async (req, res) => {
  try {
    const genre = req.params.genre.toLowerCase();
    const books = await OfferedBook.find({ genre: { $regex: new RegExp(genre, "i") } });
    res.json(books);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/new", async (req, res) => {
  try {
    const books = await OfferedBook.find().sort({ createdAt: -1 }).limit(20);
    res.json(books);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/popular", async (req, res) => {
  try {
    const books = await OfferedBook.aggregate([{ $sample: { size: 20 } }]);
    res.json(books);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// public user profile lookup (optional; keep public if you want)
app.get("/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Error fetching user" });
  }
});

// --------------------
// PROTECTED ROUTES
// --------------------

app.get("/feed", authMiddleware, async (req, res) => {
  const userId = req.user.userId;

  const books = await OfferedBook.find({
    owner: { $ne: userId }
  })
    .sort({ createdAt: -1 })
    .limit(20);

  res.json(books);
});

app.get("/books", authMiddleware, async (req, res) => {
  const query = req.query.query?.toLowerCase() || "";
  const userId = req.user.userId;

  try {
    const books = await OfferedBook.find({
      owner: { $ne: userId }
    });

    const filtered = books.filter(
      (book) =>
        (book.title || "").toLowerCase().includes(query) ||
        (book.author || "").toLowerCase().includes(query)
    );

    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /browse?q=optionalSearch
app.get("/browse", authMiddleware, async (req, res) => {
  const q = (req.query.q || "").trim();
  const userId = req.user.userId;

  const LIMIT_SECTION = 20;
  const LIMIT_ROW = 16;
  const GENRE_COUNT = 8;

  try {
    const notMine = { owner: { $ne: new mongoose.Types.ObjectId(userId) } };

    /* ---------------- SEARCH ---------------- */
    const searchResults = q
      ? await OfferedBook.find({
          ...notMine,
          $or: [
            { title: { $regex: q, $options: "i" } },
            { author: { $regex: q, $options: "i" } },
          ],
        })
          .sort({ createdAt: -1 })
          .limit(40)
      : [];

    /* ---------------- POPULAR ---------------- */
    const popular = await OfferedBook.aggregate([
      { $match: notMine },
      { $sample: { size: LIMIT_SECTION } },
    ]);

    /* ---------------- NEW ---------------- */
    const newlyAdded = await OfferedBook.find(notMine)
      .sort({ createdAt: -1 })
      .limit(LIMIT_SECTION);

    /* ---------------- RECOMMENDED ---------------- */
    const user = await User.findById(userId).select("location");
    let recommended = [];

    if (user?.location) {
      recommended = await OfferedBook.aggregate([
        { $match: notMine },
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
        { $sort: { createdAt: -1 } },
        { $limit: LIMIT_SECTION },
      ]);
    }

    /* ---------------- GENRES ---------------- */
    const genres = (
      await OfferedBook.distinct("genre", {
        ...notMine,
        genre: { $ne: null },
      })
    )
      .filter(Boolean)
      .slice(0, GENRE_COUNT);

    const genreRows = {};
    for (const genre of genres) {
      genreRows[genre] = await OfferedBook.find({
        ...notMine,
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
    res.status(500).json({ error: err.message });
  }
});


app.get("/user", authMiddleware, async (req, res) => {
  try {
    const me = await User.findById(req.user.userId).select("_id username email location ratings");
    if (!me) return res.status(404).json({ message: "User not found" });
    return res.json(me);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch current user", error: err.message });
  }
});

app.get("/user/wishlist", authMiddleware, async (req, res) => {
  try {
    const books = await WishlistBook.find({ userId: req.user.userId });
    res.json(books);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/user/offered", authMiddleware, async (req, res) => {
  try {
    const books = await OfferedBook.find({ owner: req.user.userId });
    res.json(books);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
        error: err?.message,
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
        error: err?.message,
      });
    }
  }
);

app.get("/user/wishlist/:isbn", authMiddleware, async (req, res) => {
  const { isbn } = req.params;
  try {
    const book = await WishlistBook.findOne({ userId: req.user.userId, isbn });
    res.json({ exists: !!book });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/user/get-recommended-books", authMiddleware, async (req, res) => {
  const userId = req.user.userId;
  const user = await User.findById(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
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
      { $sort: { createdAt: -1 } },
    ]);

    res.json(books);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/user/edit", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { username, email, location } = req.body.user;

    const update = {};
    if (username?.trim()) update.username = username.trim();
    if (email?.trim()) update.email = email.trim();
    if (location?.trim()) update.location = location.trim();

    const updatedUser = await User.findByIdAndUpdate(userId, { $set: update }, { new: true });
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
      error: err?.message,
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
      error: err?.message,
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

export default app;