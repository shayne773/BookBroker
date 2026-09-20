// Brute-force protection for POST /auth/login.
//
// Deliberately in-process and dependency-free: the API runs as a single
// long-lived Express process, so a Map is enough and is one less moving part
// than a shared store. If the API is ever scaled to several instances this
// needs to move to a shared backend (Redis / Mongo), because each process would
// otherwise keep its own counters.
//
// Failures are counted per account, keyed on the submitted email, which caps
// guesses against one account. They are recorded whether or not the account
// exists, so the 429 response is identical either way and leaks no account
// existence. Rate limiting by client address belongs to the edge (load
// balancer / WAF), which is the only place that reliably sees the real caller.

const MINUTE = 60 * 1000;

export const DEFAULT_OPTIONS = {
  windowMs: 15 * MINUTE,
  lockoutMs: 15 * MINUTE,
  accountMaxAttempts: 5,
  // Bound on tracked accounts so a spray across many addresses cannot grow the
  // Map without limit. Expired entries are dropped first; if that is not enough
  // the oldest entries go.
  maxEntries: 10000,
};

export class LoginThrottle {
  constructor() {
    this.options = DEFAULT_OPTIONS;
    this.entries = new Map();
  }

  /** @returns {{ limited: boolean, retryAfterSeconds: number }} */
  check(account, now = Date.now()) {
    const entry = this.#get(account, now);
    if (!entry || entry.lockedUntil <= now) {
      return { limited: false, retryAfterSeconds: 0 };
    }

    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000)),
    };
  }

  recordFailure(account, now = Date.now()) {
    this.#prune(now);

    const key = this.#keyOf(account);
    if (!key) return;

    let entry = this.#get(account, now);
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
    if (entry.failures >= this.options.accountMaxAttempts) {
      entry.lockedUntil = now + this.options.lockoutMs;
      entry.failures = 0;
      entry.windowStart = now;
    }
  }

  /** Clear the account's counters after a successful sign-in. */
  recordSuccess(account, now = Date.now()) {
    const key = this.#keyOf(account);
    if (key) this.entries.delete(key);
    this.#prune(now);
  }

  reset() {
    this.entries.clear();
  }

  #keyOf(account) {
    return account ? String(account) : null;
  }

  #get(account, now) {
    const key = this.#keyOf(account);
    if (!key) return null;

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
