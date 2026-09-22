// Server-tracked sign-in sessions.
//
// Signing in issues an opaque random token; the client sends it as a bearer
// token and the database keeps only its SHA-256 digest (see authTokens.js for
// why an unsalted fast hash is enough for 32 random bytes). There is nothing to
// verify offline: every authenticated request looks its session up, so deleting
// the record ends the session at once.
//
// Expiry slides: each use pushes it to SESSION_LIFETIME_MS from now, with no
// absolute cap. To keep ordinary browsing from writing on every request, the
// record is only touched when it was last touched over TOUCH_INTERVAL_MS ago. A
// TTL index removes sessions that were left to expire.

import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { hashToken } from "./authTokens.js";

const HOUR = 60 * 60 * 1000;

export const SESSION_LIFETIME_MS = 30 * 24 * HOUR;
export const TOUCH_INTERVAL_MS = HOUR;

const sessionSchema = new mongoose.Schema(
  {
    _id: { type: String }, // SHA-256 hex digest of the raw token
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, required: true },
    lastUsedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ user: 1 });

export const Session = mongoose.models.Session || mongoose.model("Session", sessionSchema);

/**
 * Start a session for `userId`.
 * @returns {Promise<string>} the raw token, returned to the client only
 */
export async function createSession(userId, now = Date.now()) {
  const raw = randomBytes(32).toString("base64url");

  await Session.create({
    _id: hashToken(raw),
    user: userId,
    createdAt: new Date(now),
    lastUsedAt: new Date(now),
    expiresAt: new Date(now + SESSION_LIFETIME_MS),
  });

  return raw;
}

/**
 * Look up the session for a raw token and extend it. Returns the session
 * (with `user`), or null when the token is unknown, revoked or expired.
 */
export async function useSession(raw, now = Date.now()) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 256) return null;

  const id = hashToken(raw);
  const session = await Session.findById(id).lean();

  // The TTL monitor runs about once a minute, so an expired session can still
  // be in the collection; it is refused here all the same.
  if (!session || session.expiresAt.getTime() <= now) return null;

  if (now - session.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS) {
    const touched = { lastUsedAt: new Date(now), expiresAt: new Date(now + SESSION_LIFETIME_MS) };
    await Session.updateOne({ _id: id }, { $set: touched });
    Object.assign(session, touched);
  }

  return session;
}

/** End the session a raw token belongs to. */
export function endSession(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 256) return Promise.resolve();
  return Session.deleteOne({ _id: hashToken(raw) });
}

/** End every session of a user, e.g. after a password reset. */
export function endUserSessions(userId) {
  return Session.deleteMany({ user: userId });
}
