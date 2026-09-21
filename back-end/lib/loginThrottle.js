// Brute-force protection for POST /auth/login.
//
// Counters live in MongoDB, one document per normalized email, so they are
// shared by every API instance and survive a restart. A document's _id is the
// SHA-256 digest of the address, so every key is the same small size. Each address has its own
// document matched by exact key: no volume of failures against other addresses
// can reset, shorten or trigger another address's lockout. A TTL index removes
// a document once its window and any lockout have both passed.
//
// Failures are counted per account, keyed on the submitted email, which caps
// guesses against one account. They are recorded whether or not the account
// exists, so the 429 response is identical either way and leaks no account
// existence. Rate limiting by client address belongs to the edge (load
// balancer / WAF), which is the only place that reliably sees the real caller.
//
// Store errors propagate to the caller: the login route fails rather than
// letting an attempt through unthrottled.

import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { normalizeEmail } from "./validation.js";

const MINUTE = 60 * 1000;

export const DEFAULT_OPTIONS = {
  windowMs: 15 * MINUTE,
  lockoutMs: 15 * MINUTE,
  accountMaxAttempts: 5,
};

const loginAttemptSchema = new mongoose.Schema(
  {
    _id: { type: String },
    failures: { type: Number, default: 0 },
    windowStart: { type: Date },
    lockedUntil: { type: Date },
    expiresAt: { type: Date },
  },
  { versionKey: false }
);

loginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginAttempt =
  mongoose.models.LoginAttempt || mongoose.model("LoginAttempt", loginAttemptSchema);

const EPOCH = new Date(0);

export function throttleKey(account) {
  const email = normalizeEmail(account);
  return email ? createHash("sha256").update(email).digest("hex") : null;
}

export class LoginThrottle {
  constructor() {
    this.options = DEFAULT_OPTIONS;
  }

  /** @returns {Promise<{ limited: boolean, retryAfterSeconds: number }>} */
  async check(account, now = Date.now()) {
    const key = throttleKey(account);
    if (!key) return { limited: false, retryAfterSeconds: 0 };

    const attempt = await LoginAttempt.findById(key).select("lockedUntil").lean();
    const lockedUntil = attempt?.lockedUntil?.getTime() ?? 0;
    if (lockedUntil <= now) {
      return { limited: false, retryAfterSeconds: 0 };
    }

    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - now) / 1000)),
    };
  }

  async recordFailure(account, now = Date.now()) {
    const key = throttleKey(account);
    if (!key) return;

    const { windowMs, lockoutMs, accountMaxAttempts } = this.options;
    const at = new Date(now);
    const lockedUntil = { $ifNull: ["$lockedUntil", EPOCH] };
    const windowStart = { $ifNull: ["$windowStart", EPOCH] };
    const stale = {
      $and: [
        { $lte: [lockedUntil, at] },
        { $lte: [windowStart, new Date(now - windowMs)] },
      ],
    };
    const reached = { $gte: ["$failures", accountMaxAttempts] };

    // One atomic pipeline update, so concurrent failures are all counted.
    await LoginAttempt.findOneAndUpdate(
      { _id: key },
      [
        {
          $set: {
            failures: { $cond: [stale, 1, { $add: [{ $ifNull: ["$failures", 0] }, 1] }] },
            windowStart: { $cond: [stale, at, windowStart] },
            lockedUntil: { $cond: [stale, EPOCH, lockedUntil] },
          },
        },
        {
          $set: {
            lockedUntil: { $cond: [reached, new Date(now + lockoutMs), "$lockedUntil"] },
            windowStart: { $cond: [reached, at, "$windowStart"] },
            failures: { $cond: [reached, 0, "$failures"] },
          },
        },
        {
          $set: {
            expiresAt: { $max: [{ $add: ["$windowStart", windowMs] }, "$lockedUntil"] },
          },
        },
      ],
      { upsert: true }
    );
  }

  /** Clear the account's counters after a successful sign-in. */
  async recordSuccess(account) {
    const key = throttleKey(account);
    if (!key) return;

    await LoginAttempt.deleteOne({ _id: key });
  }
}

export const LOGIN_THROTTLED_MESSAGE =
  "Too many failed login attempts. Please try again later.";
