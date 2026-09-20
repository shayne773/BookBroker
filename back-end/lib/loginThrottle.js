// Brute-force protection for POST /auth/login.
//
// Deliberately in-process and dependency-free: the API runs as a single
// long-lived Express process, so a local table is enough and is one less moving
// part than a shared store. If the API is ever scaled to several instances this
// needs to move to a shared backend (Redis / Mongo), because each process would
// otherwise keep its own counters.
//
// Failures are counted per account, keyed on the submitted email, which caps
// guesses against one account. They are recorded whether or not the account
// exists, so the 429 response is identical either way and leaks no account
// existence. Rate limiting by client address belongs to the edge (load
// balancer / WAF), which is the only place that reliably sees the real caller.
//
// Counters live in a fixed-size table indexed by a hash of the address, not in
// a growable map. Memory is bounded by construction, so there is no eviction
// path and no volume of failures against other addresses can reset a counter or
// cut a lockout short. Slots are reclaimed by time alone. Two addresses that
// share a slot share its counter, which can only bring a lockout on sooner.

import { normalizeEmail } from "./validation.js";

const MINUTE = 60 * 1000;

// Preallocated once and never grown: ~16k slots of five small fields, on the
// order of a megabyte.
export const SLOT_COUNT = 16384;

export const DEFAULT_OPTIONS = {
  windowMs: 15 * MINUTE,
  lockoutMs: 15 * MINUTE,
  accountMaxAttempts: 5,
};

// FNV-1a: stable across runs and cheap, which is all this index needs.
function slotIndex(key) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % SLOT_COUNT;
}

export class LoginThrottle {
  constructor() {
    this.options = DEFAULT_OPTIONS;
    this.slots = Array.from({ length: SLOT_COUNT }, () => ({
      owner: null,
      shared: false,
      failures: 0,
      windowStart: 0,
      lockedUntil: 0,
    }));
  }

  /** @returns {{ limited: boolean, retryAfterSeconds: number }} */
  check(account, now = Date.now()) {
    const key = this.#keyOf(account);
    if (!key) return { limited: false, retryAfterSeconds: 0 };

    const slot = this.slots[slotIndex(key)];
    if (slot.lockedUntil <= now) {
      return { limited: false, retryAfterSeconds: 0 };
    }

    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((slot.lockedUntil - now) / 1000)),
    };
  }

  recordFailure(account, now = Date.now()) {
    const key = this.#keyOf(account);
    if (!key) return;

    const slot = this.slots[slotIndex(key)];
    this.#claimIfStale(slot, key, now);
    if (slot.owner !== key) slot.shared = true;

    slot.failures += 1;
    if (slot.failures >= this.options.accountMaxAttempts) {
      slot.lockedUntil = now + this.options.lockoutMs;
      slot.failures = 0;
      slot.windowStart = now;
    }
  }

  /** Clear the account's counters after a successful sign-in. */
  recordSuccess(account, now = Date.now()) {
    const key = this.#keyOf(account);
    if (!key) return;

    const slot = this.slots[slotIndex(key)];
    // Only the address that owns the slot outright may clear it. Once another
    // address has counted against the same slot, a success here would be
    // clearing failures that are not this account's, so the slot is left alone.
    if (slot.owner !== key || slot.shared) return;

    this.#release(slot);
  }

  reset() {
    for (const slot of this.slots) this.#release(slot);
  }

  #keyOf(account) {
    return normalizeEmail(account) || null;
  }

  // A slot is reclaimed by time only: once its window has passed and any
  // lockout has elapsed, the next address to touch it takes it over.
  #claimIfStale(slot, key, now) {
    const stale =
      slot.lockedUntil <= now && now - slot.windowStart >= this.options.windowMs;
    if (slot.owner !== null && !stale) return;

    slot.owner = key;
    slot.shared = false;
    slot.failures = 0;
    slot.windowStart = now;
    slot.lockedUntil = 0;
  }

  #release(slot) {
    slot.owner = null;
    slot.shared = false;
    slot.failures = 0;
    slot.windowStart = 0;
    slot.lockedUntil = 0;
  }
}

export const LOGIN_THROTTLED_MESSAGE =
  "Too many failed login attempts. Please try again later.";
