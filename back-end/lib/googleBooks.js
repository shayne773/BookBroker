// The only Google Books client: the search proxy in app.js and seed.js both
// go through it.
//
// Every request carries the server-side GOOGLE_BOOKS_API_KEY. Keyless calls
// share Google's global anonymous quota, which is routinely zero, so without a
// key nothing is sent and the caller gets GoogleBooksUnavailableError, the same
// error as a refused or failed request. The key never leaves this process: it
// is not logged, and errors raised here are built fresh rather than passing on
// the HTTP client's error, whose config holds the request parameters.
//
// Successful responses are cached briefly in memory, so repeated identical
// queries (the same search typed by several readers) spend the daily quota once.

import { http } from "./http.js";
import { httpsUrl } from "./covers.js";

export const GOOGLE_BOOKS_API = "https://www.googleapis.com/books/v1";

export const BOOK_SEARCH_UNAVAILABLE = "BOOK_SEARCH_UNAVAILABLE";
export const BOOK_SEARCH_UNAVAILABLE_MESSAGE =
  "Book search is temporarily unavailable. Please try again later.";

export class GoogleBooksUnavailableError extends Error {
  /** @param {string} reason why, for the server log; never shown to a client */
  constructor(reason) {
    super(`Google Books unavailable: ${reason}`);
    this.name = "GoogleBooksUnavailableError";
    this.reason = reason;
  }
}

export const hasGoogleBooksKey = () => Boolean(process.env.GOOGLE_BOOKS_API_KEY);

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const cache = new Map();

export function clearGoogleBooksCache() {
  cache.clear();
}

function cached(key) {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires > Date.now()) return entry.value;
  cache.delete(key);
  return undefined;
}

function remember(key, value) {
  // A Map iterates in insertion order, so the first key is the oldest entry.
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

// GET `path` under the API with the key. Resolves to the JSON body, or null for
// a 404; anything else Google does not answer becomes GoogleBooksUnavailableError.
async function googleGet(path, params = {}) {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) throw new GoogleBooksUnavailableError("GOOGLE_BOOKS_API_KEY is not set");

  const cacheKey = `${path}?${new URLSearchParams(params)}`;
  const hit = cached(cacheKey);
  if (hit !== undefined) return hit;

  let data;
  try {
    ({ data } = await http.get(`${GOOGLE_BOOKS_API}${path}`, {
      params: { ...params, key },
      timeout: 10000,
    }));
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) {
      data = null;
    } else {
      const detail = err?.response?.data?.error?.message || err?.code || "no response";
      throw new GoogleBooksUnavailableError(`HTTP ${status ?? "-"}: ${detail}`);
    }
  }

  remember(cacheKey, data);
  return data;
}

// Google's own cover for a volume, over https, or "" when it has none.
export function googleCover(volumeInfo = {}) {
  return httpsUrl(volumeInfo.imageLinks?.thumbnail || volumeInfo.imageLinks?.smallThumbnail);
}

/**
 * A volume in the shape the book routes store. `isbn` prefers ISBN-13, then
 * ISBN-10, and falls back to the Google volume id so every result can be added.
 */
export function mapVolume(item) {
  const v = item?.volumeInfo || {};
  const ids = v.industryIdentifiers || [];
  const isbn =
    ids.find((x) => x.type === "ISBN_13")?.identifier ||
    ids.find((x) => x.type === "ISBN_10")?.identifier ||
    item?.id ||
    "";

  return {
    volumeId: item?.id || "",
    title: v.title || "",
    author: v.authors?.join(", ") || "Unknown",
    publisher: v.publisher || "Unknown",
    year: v.publishedDate ? String(v.publishedDate).slice(0, 4) : "",
    cover: googleCover(v),
    isbn,
    genre: v.categories?.[0] || "Unknown",
    desc: v.description || "",
  };
}

/** Raw volumes matching `query`. */
export async function searchVolumes(query, { maxResults = 10, startIndex = 0 } = {}) {
  const data = await googleGet("/volumes", { q: query, maxResults, startIndex });
  return data?.items || [];
}

/** Matching volumes, mapped for storage. */
export async function searchGoogleBooks(query, options) {
  return (await searchVolumes(query, options)).map(mapVolume);
}
