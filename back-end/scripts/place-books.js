// Places every offered book where its owner is (bookPosition in lib/nearby.js):
// their point, their place name and that place's point. Run once after
// deploying the map, so books offered before it appear there, and again if the
// ZIP code table is rebuilt; it is safe to rerun. `npm run place-books`, with
// MONGODB_URI set (see .env.example).
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { User } from "../Data.js";
import { connectDatabase } from "../lib/db.js";
import { moveOwnerBooks } from "../lib/nearby.js";

/** Moves every reader's books to the reader's position; returns how many readers. */
export async function placeAllBooks() {
  let readers = 0;
  for await (const user of User.find().select("geo location").lean().cursor()) {
    await moveOwnerBooks(user._id, user);
    readers += 1;
  }
  return readers;
}

async function main() {
  dotenv.config();
  await connectDatabase();
  try {
    console.log(`Placed the books of ${await placeAllBooks()} readers.`);
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Placing books failed:", err?.message || err);
    process.exit(1);
  });
}
