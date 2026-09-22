// Cover URLs as they are stored on books.
//
// Every stored cover is https: Google Books hands out http:// thumbnail links,
// which some browsers block as mixed content on an https page, and the same
// bytes are served over https.
//
// When Google has no image for a book, Open Library often does. Its ISBN search
// resolves the book to a cover id once, and the stored URL is the stable
// covers.openlibrary.org/b/id/<id>-M.jpg: the /b/isbn/ form is rate limited by
// Open Library on every page load, so it is never stored.

import { http } from "./http.js";

export const OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json";

/** `url` trimmed, with http:// upgraded to https://; "" for anything empty. */
export function httpsUrl(url) {
  const value = typeof url === "string" ? url.trim() : "";
  return value.replace(/^http:\/\//i, "https://");
}

const ISBN = /^(?:\d{9}[\dX]|\d{13})$/;

/** The ISBN-10 or ISBN-13 in `value` without separators, or "" if it is not one. */
export function normalizeIsbn(value) {
  const compact = String(value ?? "").replace(/[\s-]/g, "").toUpperCase();
  return ISBN.test(compact) ? compact : "";
}

export const openLibraryCoverUrl = (coverId) =>
  `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;

/**
 * The Open Library cover for `isbn`, or "" when it has none. Request failures
 * propagate, so a caller can tell "no cover" from "could not ask".
 */
export async function openLibraryCover(isbn) {
  const clean = normalizeIsbn(isbn);
  if (!clean) return "";

  const { data } = await http.get(OPEN_LIBRARY_SEARCH, {
    params: { isbn: clean, fields: "cover_i", limit: 1 },
    headers: { "User-Agent": "BookBroker cover lookup" },
    timeout: 10000,
  });
  const coverId = data?.docs?.find((doc) => Number.isInteger(doc?.cover_i))?.cover_i;
  return coverId ? openLibraryCoverUrl(coverId) : "";
}

/**
 * The cover to store for a book being added: its own (Google) cover over
 * https, else Open Library's by ISBN, else "". A failed Open Library lookup is
 * logged and stores no cover rather than failing the add.
 */
export async function captureCover({ cover, isbn }) {
  const own = httpsUrl(cover);
  if (own) return own;

  try {
    return await openLibraryCover(isbn);
  } catch (err) {
    console.error(`Open Library cover lookup failed for ISBN ${isbn}:`, err?.message || err);
    return "";
  }
}
