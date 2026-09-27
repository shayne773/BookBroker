// The one MongoDB connection, shared by server.js (a long-running process) and
// vercel.js (a function that serves many requests from one warm instance).
//
// The connection promise is cached at module scope, so every request an
// instance serves reuses the connection its first request opened instead of
// opening a new pool per request. A failed attempt is forgotten, so the next
// request tries again rather than replaying the same rejection.
//
// The connection counts as ready only once OfferedBook's indexes exist:
// $geoNear refuses to run without the 2dsphere index (lib/nearby.js).
// Mongoose starts building them on connect; this waits for that same build.

import mongoose from "mongoose";
import { OfferedBook } from "../Data.js";

export const DB_NAME = "bookbroker";

let connecting = null;

export function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) return Promise.reject(new Error("MONGODB_URI is not set"));

  connecting ??= mongoose
    .connect(uri, { dbName: DB_NAME, serverSelectionTimeoutMS: 10_000 })
    .then(async (connection) => {
      await OfferedBook.init();
      return connection;
    })
    .catch((err) => {
      connecting = null;
      throw err;
    });
  return connecting;
}
