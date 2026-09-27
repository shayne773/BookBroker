// Single-use, time-limited tokens for the links we email: confirming an address
// and resetting a password.
//
// The raw token exists only in the emailed link. The database keeps its SHA-256
// digest, so a leaked collection cannot be replayed as links. A token is 32
// random bytes, far beyond guessing, so an unsalted fast hash is enough here
// (unlike a password). Consuming a token deletes it in the same atomic
// operation that finds it, so two concurrent uses cannot both succeed. A TTL
// index clears expired tokens that were never used.

import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";

const HOUR = 60 * 60 * 1000;

export const TOKEN_PURPOSES = {
  confirmEmail: { name: "confirm-email", lifetimeMs: 24 * HOUR },
  resetPassword: { name: "reset-password", lifetimeMs: 1 * HOUR },
};

const authTokenSchema = new mongoose.Schema(
  {
    _id: { type: String }, // SHA-256 hex digest of the raw token
    purpose: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
authTokenSchema.index({ user: 1, purpose: 1 });

export const AuthToken =
  mongoose.models.AuthToken || mongoose.model("AuthToken", authTokenSchema);

export const hashToken = (raw) => createHash("sha256").update(String(raw)).digest("hex");

/**
 * Create a token for `userId`, replacing any earlier unused token of the same
 * purpose, so only the most recently emailed link works.
 * @returns {Promise<string>} the raw token, for the emailed link only
 */
export async function issueToken(purpose, userId, now = Date.now()) {
  const raw = randomBytes(32).toString("base64url");

  await AuthToken.deleteMany({ user: userId, purpose: purpose.name });
  await AuthToken.create({
    _id: hashToken(raw),
    purpose: purpose.name,
    user: userId,
    expiresAt: new Date(now + purpose.lifetimeMs),
  });

  return raw;
}

/**
 * Use up a token. Returns the user id it was issued for, or null when the token
 * is unknown, already used, for another purpose or expired.
 */
export async function consumeToken(purpose, raw, now = Date.now()) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 256) return null;

  const token = await AuthToken.findOneAndDelete({
    _id: hashToken(raw),
    purpose: purpose.name,
  }).lean();

  // The TTL monitor runs about once a minute, so an expired token can still be
  // in the collection; it is refused here all the same.
  if (!token || token.expiresAt.getTime() <= now) return null;
  return token.user;
}

/** Drop every outstanding token of `purpose` for a user. */
export function revokeTokens(purpose, userId) {
  return AuthToken.deleteMany({ user: userId, purpose: purpose.name });
}
