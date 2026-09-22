// Replaces the demo data: 10 users (seed_user_N@example.com) offering 100 real
// books from Google Books. Run with `npm run seed`; it needs MONGODB_URI and
// GOOGLE_BOOKS_API_KEY (see .env.example).
//
// Every book, cover included, is fetched BEFORE anything is deleted, so a
// Google failure leaves the previous seed in place instead of wiping it.
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { OfferedBook, User } from "./Data.js";
import { hasGoogleBooksKey, mapVolume, searchVolumes } from "./lib/googleBooks.js";
import { captureCover } from "./lib/covers.js";
import { pause } from "./lib/http.js";

const DB_NAME = "bookbroker";
const SEED_PREFIX = "seed_user_";
const USER_COUNT = 10;
const BOOKS_PER_USER = 10;
const SHARED_PASSWORD = "Password123!";
const LOCATIONS = ["NYC", "Champaign", "Chicago", "Taipei", "Hsinchu"];

// Use a mix of queries to get varied, real books
export const QUERIES = [
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

// Pick n unique volumes (by ISBN, else volume id) across the queries.
async function collectUniqueVolumes(n, { pauseMs }) {
  const chosen = [];
  const seen = new Set();
  // Enough rounds for any realistic corpus; a Google answering with almost
  // nothing ends the seed instead of looping forever.
  const maxRequests = QUERIES.length * 4;

  for (let i = 0; chosen.length < n; i++) {
    if (i >= maxRequests) {
      throw new Error(`Only ${chosen.length} of ${n} usable books found in ${maxRequests} searches.`);
    }

    // random startIndex to reduce repeats
    const startIndex = Math.floor(Math.random() * 60);
    const items = await searchVolumes(QUERIES[i % QUERIES.length], { maxResults: 40, startIndex });

    for (const item of items) {
      const v = item.volumeInfo || {};
      // filter out very incomplete entries
      if (!v.title || !v.authors?.length) continue;

      const key = mapVolume(item).isbn;
      if (!key || seen.has(key)) continue;

      seen.add(key);
      chosen.push(item);
      if (chosen.length >= n) break;
    }

    await pause(pauseMs);
  }

  return chosen;
}

/**
 * Fetch the books, then replace the previously seeded users and their books.
 * Expects an open Mongoose connection. Throws, having deleted nothing, when
 * the key is missing or any fetch fails.
 */
export async function seed({ pauseMs = 250, log = console.log } = {}) {
  if (!hasGoogleBooksKey()) {
    throw new Error("GOOGLE_BOOKS_API_KEY is not set; the seed needs it to fetch books.");
  }

  // ---- 1. Fetch every book and cover first ----
  const total = USER_COUNT * BOOKS_PER_USER;
  log(`📚 Fetching ${total} real books from Google Books...`);
  const books = [];
  for (const item of await collectUniqueVolumes(total, { pauseMs })) {
    const book = mapVolume(item);
    if (!book.cover) {
      book.cover = await captureCover(book);
      await pause(pauseMs);
    }
    books.push(book);
  }
  log(`✅ Collected ${books.length} unique books (${books.filter((b) => !b.cover).length} without a cover)`);

  // ---- 2. Only now remove the previous seed ----
  const oldUsers = await User.find({ email: { $regex: `^${SEED_PREFIX}` } }, { _id: 1 });
  const oldIds = oldUsers.map((u) => u._id);
  if (oldIds.length) {
    await OfferedBook.deleteMany({ owner: { $in: oldIds } });
    await User.deleteMany({ _id: { $in: oldIds } });
    log(`🧹 Removed old seeded data (${oldIds.length} users)`);
  }

  // ---- 3. Create the users and give each their share of the books ----
  const hashed = await bcrypt.hash(SHARED_PASSWORD, 10);
  const createdUsers = await User.insertMany(
    Array.from({ length: USER_COUNT }, (_, i) => ({
      username: `${SEED_PREFIX}${i + 1}`,
      email: `${SEED_PREFIX}${i + 1}@example.com`,
      password: hashed,
      location: LOCATIONS[i % LOCATIONS.length],
      ratings: Math.floor(Math.random() * 6),
    }))
  );
  log(`👤 Created ${createdUsers.length} users (password: ${SHARED_PASSWORD})`);

  const offeredDocs = books.map((book, i) => ({
    ...book,
    owner: createdUsers[Math.floor(i / BOOKS_PER_USER)]._id,
  }));
  await OfferedBook.insertMany(offeredDocs);
  log(`✅ Inserted ${offeredDocs.length} offered books linked to users`);
}

async function main() {
  dotenv.config();
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI in .env");
  if (!hasGoogleBooksKey()) throw new Error("Missing GOOGLE_BOOKS_API_KEY in .env");

  await mongoose.connect(process.env.MONGODB_URI, { dbName: DB_NAME });
  console.log(`✅ Connected to MongoDB (dbName=${DB_NAME})`);
  try {
    await seed();
  } finally {
    await mongoose.disconnect();
  }
  console.log("✅ Done.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("❌ Seed failed:", err?.message || err);
    process.exit(1);
  });
}
