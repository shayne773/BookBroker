// Builds the User indexes on a live database, notably the case-insensitive unique
// index on email (`email_case_insensitive` in Data.js). Mongoose's autoIndex also
// builds it when the API starts, but only logs a failure; this reports one. It only
// ever adds indexes, never drops them, so it is safe to run any number of times:
//
//   npm run ensure-indexes              # the API's database, "bookbroker"
//   npm run ensure-indexes -- <dbName>  # another database on MONGODB_URI
//
// A build fails if two accounts hold addresses differing only in capitalization;
// those are listed first, so they can be resolved by hand before running it again.
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { User } from "./Data.js";

export async function caseVariantEmails() {
  return User.aggregate([
    { $group: { _id: { $toLower: "$email" }, emails: { $push: "$email" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
}

async function main() {
  dotenv.config();
  if (!process.env.MONGODB_URI) throw new Error("Missing MONGODB_URI in .env");
  const dbName = process.argv[2] || "bookbroker";

  await mongoose.connect(process.env.MONGODB_URI, { dbName, autoIndex: false });
  console.log(`Connected to MongoDB (dbName=${dbName})`);
  try {
    const clashes = await caseVariantEmails();
    if (clashes.length) {
      for (const { emails } of clashes) console.error(`Differ only in case: ${emails.join(", ")}`);
      throw new Error(`${clashes.length} address(es) held by several accounts; resolve them first`);
    }

    await User.createIndexes();
    const names = (await User.listIndexes()).map((index) => index.name);
    console.log(`User indexes: ${names.join(", ")}`);
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("ensure-indexes failed:", err?.message || err);
    process.exit(1);
  });
}
