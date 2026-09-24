// The API as a Vercel function. `api/index.js` at the repository root re-exports
// this handler; `vercel.json` rewrites every /api/* request to it, so the site
// and the API share one origin. server.js remains the entry for local
// development and for any long-running host.
//
// A function instance serves many requests but can be frozen or discarded
// between any two of them, so nothing here may depend on memory surviving:
// sessions and throttles live in MongoDB, and the Google Books cache is only a
// best-effort saving. For the same reason, work that outlives the response
// (mail, notifications) must go through runInBackground in lib/background.js,
// which keeps the invocation alive until it settles.

import express from "express";
import app from "./app.js";
import { connectDatabase } from "./lib/db.js";

export const API_PREFIX = "/api";

export function createVercelHandler({ connect = connectDatabase } = {}) {
  const handler = express();

  // The request keeps its public path (/api/auth/login); mounting strips the
  // prefix, so app.js answers the same routes as it does under server.js.
  handler.use(
    API_PREFIX,
    async (req, res, next) => {
      try {
        await connect();
        next();
      } catch (err) {
        console.error("MongoDB connection failed:", err);
        res.status(503).json({ message: "Service temporarily unavailable" });
      }
    },
    app
  );

  return handler;
}

export default createVercelHandler();
