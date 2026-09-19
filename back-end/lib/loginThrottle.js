// Brute-force protection for POST /auth/login.
//
// Deliberately in-process and dependency-free: the API runs as a single
// long-lived Express process, so a Map is enough and is one less moving part
// than a shared store. If the API is ever scaled to several instances this
// needs to move to a shared backend (Redis / Mongo), because each process would
// otherwise keep its own counters.
//
// Two independent buckets are tracked per attempt:
//   * account - keyed on the submitted email, which caps guesses against one
//     account. Failures are recorded whether or not the account exists, so the
//     429 response is identical either way and leaks no account existence.
//   * ip - keyed on the client address, which caps spraying across many
//     accounts from one source.

const MINUTE = 60 * 1000;

export const DEFAULT_OPTIONS = {
  windowMs: 15 * MINUTE,
  lockoutMs: 15 * MINUTE,
  accountMaxAttempts: 5,
  ipMaxAttempts: 30,
  // Bound on tracked keys so a spray across many addresses cannot grow the Map
  // without limit. Expired entries are dropped first; if that is not enough the
  // oldest entries go.
  maxEntries: 10000,
};

function positiveInt(raw, fallback) {
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function optionsFromEnv(env = process.env) {
  return {
    windowMs: positiveInt(env.LOGIN_THROTTLE_WINDOW_MS, DEFAULT_OPTIONS.windowMs),
    lockoutMs: positiveInt(env.LOGIN_THROTTLE_LOCKOUT_MS, DEFAULT_OPTIONS.lockoutMs),
    accountMaxAttempts: positiveInt(
      env.LOGIN_THROTTLE_ACCOUNT_MAX,
      DEFAULT_OPTIONS.accountMaxAttempts
    ),
    ipMaxAttempts: positiveInt(env.LOGIN_THROTTLE_IP_MAX, DEFAULT_OPTIONS.ipMaxAttempts),
  };
}

export class LoginThrottle {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.entries = new Map();
  }

  /** @returns {{ limited: boolean, retryAfterSeconds: number }} */
  check(keys, now = Date.now()) {
    let lockedUntil = 0;
    for (const key of this.#keysOf(keys)) {
      const entry = this.#get(key, now);
      if (entry && entry.lockedUntil > now) {
        lockedUntil = Math.max(lockedUntil, entry.lockedUntil);
      }
    }

    if (lockedUntil === 0) return { limited: false, retryAfterSeconds: 0 };
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - now) / 1000)),
    };
  }

  recordFailure(keys, now = Date.now()) {
    this.#prune(now);

    for (const key of this.#keysOf(keys)) {
      const max =
        key.startsWith("account:") ? this.options.accountMaxAttempts : this.options.ipMaxAttempts;

      let entry = this.#get(key, now);
      if (!entry) {
        entry = { failures: 0, windowStart: now, lockedUntil: 0 };
        this.entries.set(key, entry);
      }

      // A new window starts once the previous one has elapsed.
      if (now - entry.windowStart >= this.options.windowMs) {
        entry.failures = 0;
        entry.windowStart = now;
      }

      entry.failures += 1;
      if (entry.failures >= max) {
        entry.lockedUntil = now + this.options.lockoutMs;
        entry.failures = 0;
        entry.windowStart = now;
      }
    }
  }

  /**
   * Clear the account bucket after a successful sign-in. The IP bucket is
   * deliberately left alone so an attacker cannot reset it by authenticating to
   * an account they already control.
   */
  recordSuccess(keys, now = Date.now()) {
    const account = this.#accountKey(keys);
    if (account) this.entries.delete(account);
    this.#prune(now);
  }

  reset() {
    this.entries.clear();
  }

  #accountKey({ account } = {}) {
    return account ? `account:${String(account)}` : null;
  }

  #keysOf({ account, ip } = {}) {
    const keys = [];
    const accountKey = this.#accountKey({ account });
    if (accountKey) keys.push(accountKey);
    if (ip) keys.push(`ip:${String(ip)}`);
    return keys;
  }

  #get(key, now) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (this.#isExpired(entry, now)) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  #isExpired(entry, now) {
    return (
      entry.lockedUntil <= now && now - entry.windowStart >= this.options.windowMs
    );
  }

  #prune(now) {
    for (const [key, entry] of this.entries) {
      if (this.#isExpired(entry, now)) this.entries.delete(key);
    }

    // Map preserves insertion order, so the head is the least recently created.
    let overflow = this.entries.size - this.options.maxEntries;
    if (overflow <= 0) return;
    for (const key of this.entries.keys()) {
      if (overflow-- <= 0) break;
      this.entries.delete(key);
    }
  }
}

export const LOGIN_THROTTLED_MESSAGE =
  "Too many failed login attempts. Please try again later.";
