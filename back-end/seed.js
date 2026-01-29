// seed_real_books.js
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const DB_NAME = "bookbroker";
const GOOGLE_KEY = process.env.GOOGLE_BOOKS_API_KEY || null;

// ---- Schemas (keep consistent with your app) ----
const { Schema } = mongoose;

const userSchema = new Schema({
  username: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  location: String,
  ratings: Number,
});

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
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.models.User || mongoose.model("User", userSchema);
const OfferedBook =
  mongoose.models.OfferedBook || mongoose.model("OfferedBook", offeredBookSchema);

// ---- Utilities ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function requestWithRetry(fn, { retries = 6, baseDelayMs = 500 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;

      // Only backoff on rate limit / transient failures
      const shouldRetry = status === 429 || status === 503 || status === 500 || !status;
      if (!shouldRetry || attempt === retries) break;

      const jitter = Math.floor(Math.random() * 250);
      const delay = baseDelayMs * Math.pow(2, attempt) + jitter;

      // If Google returns Retry-After, prefer that
      const retryAfter = err?.response?.headers?.["retry-after"];
      const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : null;

      await sleep(retryAfterMs ?? delay);
    }
  }
  throw lastErr;
}

// Use a mix of queries to get varied, real books
const QUERIES = [
  "subject:computer science",
  "subject:artificial intelligence",
  "subject:machine learning",
  "subject:fantasy",
  "subject:mystery",
  "subject:history",
  "subject:business",
  "subject:psychology",
  "subject:science",
  "subject:biography",
  "harry potter",
  "lord of the rings",
  "clean code",
  "design patterns",
  "introduction to algorithms",
];

// Normalize Google Books item into your schema
function mapGoogleItemToOfferedBook(item, ownerId) {
  const v = item.volumeInfo || {};
  const identifiers = v.industryIdentifiers || [];

  // Prefer ISBN_13 then ISBN_10, else fallback to Google ID
  const isbn13 = identifiers.find((x) => x.type === "ISBN_13")?.identifier;
  const isbn10 = identifiers.find((x) => x.type === "ISBN_10")?.identifier;
  const isbn = isbn13 || isbn10 || item.id || "";

  const year = v.publishedDate ? String(v.publishedDate).slice(0, 4) : "";

  return {
    owner: ownerId,
    title: v.title || "Untitled",
    author: (v.authors && v.authors.join(", ")) || "Unknown",
    publisher: v.publisher || "Unknown",
    year,
    cover:
      v.imageLinks?.thumbnail ||
      v.imageLinks?.smallThumbnail ||
      "",

    isbn,
    genre: (v.categories && v.categories[0]) || "Unknown",
    desc: v.description || "",
    createdAt: new Date(),
  };
}

async function fetchGoogleBooks(query, { maxResults = 40, startIndex = 0 } = {}) {
  // Google Books maxResults <= 40
  const params = {
    q: query,
    maxResults,
    startIndex,
  };
  if (GOOGLE_KEY) params.key = GOOGLE_KEY;

  const url = "https://www.googleapis.com/books/v1/volumes";

  const res = await requestWithRetry(() => axios.get(url, { params }), {
    retries: 6,
    baseDelayMs: 700,
  });

  const items = res.data?.items || [];
  return items;
}

// Pick N unique books by ISBN/ID from multiple queries
async function collectUniqueBooks(n) {
  const chosen = [];
  const seen = new Set();

  // rotate through queries with randomness
  let qIndex = 0;

  while (chosen.length < n) {
    const query = QUERIES[qIndex % QUERIES.length];
    qIndex++;

    // random startIndex to reduce repeats
    const startIndex = Math.floor(Math.random() * 60); // a few pages in
    const items = await fetchGoogleBooks(query, { maxResults: 40, startIndex });

    for (const item of items) {
      const v = item.volumeInfo || {};
      const identifiers = v.industryIdentifiers || [];
      const isbn13 = identifiers.find((x) => x.type === "ISBN_13")?.identifier;
      const isbn10 = identifiers.find((x) => x.type === "ISBN_10")?.identifier;
      const key = isbn13 || isbn10 || item.id;

      if (!key) continue;
      if (seen.has(key)) continue;

      // filter out very incomplete entries
      if (!v.title || !v.authors?.length) continue;

      seen.add(key);
      chosen.push(item);
      if (chosen.length >= n) break;
    }

    // polite throttle so you don’t get 429
    await sleep(250);
  }

  return chosen.slice(0, n);
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error("Missing MONGODB_URI in .env");
  }

  await mongoose.connect(process.env.MONGODB_URI, {
    dbName: DB_NAME,
  });
  console.log(`✅ Connected to MongoDB (dbName=${DB_NAME})`);

  // ---- Remove previously seeded data (safe delete) ----
  const seedPrefix = "seed_user_";
  const oldUsers = await User.find({ email: { $regex: `^${seedPrefix}` } }, { _id: 1 });
  const oldIds = oldUsers.map((u) => u._id);

  if (oldIds.length) {
    await OfferedBook.deleteMany({ owner: { $in: oldIds } });
    await User.deleteMany({ _id: { $in: oldIds } });
    console.log(`🧹 Removed old seeded data (${oldIds.length} users)`);
  }

  // ---- Create 10 users ----
  const sharedPassword = "Password123!";
  const hashed = await bcrypt.hash(sharedPassword, 10);
  const locations = ["NYC", "Champaign", "Chicago", "Taipei", "Hsinchu"];

  const users = Array.from({ length: 10 }, (_, i) => ({
    username: `seed_user_${i + 1}`,
    email: `seed_user_${i + 1}@example.com`,
    password: hashed,
    location: locations[i % locations.length],
    ratings: Math.floor(Math.random() * 6),
  }));

  const createdUsers = await User.insertMany(users);
  console.log(`👤 Created ${createdUsers.length} users`);
  console.log(`🔐 Seed user password: ${sharedPassword}`);
  console.log(`🔑 Google Books key: ${GOOGLE_KEY ? "YES" : "NO (may 429 more)"}`);

  // ---- Fetch 100 real books total, then assign 10 per user ----
  console.log("📚 Fetching 100 real books from Google Books (with throttling)...");
  const items = await collectUniqueBooks(100);
  console.log(`✅ Collected ${items.length} unique books`);

  const offeredDocs = [];
  for (let u = 0; u < createdUsers.length; u++) {
    const ownerId = createdUsers[u]._id;

    for (let j = 0; j < 10; j++) {
      const item = items[u * 10 + j];
      offeredDocs.push(mapGoogleItemToOfferedBook(item, ownerId));
    }
  }

  await OfferedBook.insertMany(offeredDocs);
  console.log(`✅ Inserted ${offeredDocs.length} offered books linked to users`);

  await mongoose.disconnect();
  console.log("✅ Done.");
  process.exit(0);
}

main().catch(async (err) => {
  const status = err?.response?.status;
  console.error("❌ Seed failed:", status ? `(HTTP ${status})` : "", err?.message || err);

  try {
    await mongoose.disconnect();
  } catch {}

  process.exit(1);
});
