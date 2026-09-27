// Photos of an offered book, taken by its owner (`OfferedBook.photos`).
//
// The bytes never pass through the API. The browser resizes and re-encodes a
// photo, asks routes/photos.js for a client token that lets it write one blob,
// at one pathname under the book, of an allowed type and size; it uploads
// straight to Vercel Blob with it, then hands the URL back, which is checked
// against the store (`head`) before it is kept. Only URLs and sizes are stored.
//
// Without BLOB_READ_WRITE_TOKEN photos are off: nothing can be uploaded and the
// front end hides the controls. Photos stored meanwhile still show.
//
// Every blob lives under this deployment's namespace (photoNamespace), so
// deployments or databases sharing a store never touch each other's blobs.
//
// A blob is deleted through discardPhotos, or with its whole book through
// discardBookBlobs, in the background and best effort: whatever they miss, the
// daily cron (/cron/photo-cleanup) deletes with the uploads never attached to
// their book (deleteUnattachedBlobs).
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { del, head, list, BlobError, BlobNotFoundError } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { MAX_PHOTOS, OfferedBook } from "../Data.js";
import { runInBackground } from "./background.js";

export { MAX_PHOTOS };

// The browser shrinks a photo to 1600 px on its long edge well before this.
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

// The types a photo may be, with the extension its pathname gets.
export const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// A client token is for one upload, made right after it is issued.
const UPLOAD_TOKEN_LIFETIME_MS = 10 * 60 * 1000;

export const PHOTOS_UNAVAILABLE = "PHOTOS_UNAVAILABLE";

export const photosEnabled = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// A failure of the store itself (unreachable, token or store invalid), as
// opposed to a refusal of the request.
export const isBlobStoreError = (err) => err instanceof BlobError;

// The Vercel Blob SDK, which reads BLOB_READ_WRITE_TOKEN itself. Behind one
// object so tests can replace it; no test reaches the store.
export const blobStore = {
  clientToken: (options) => generateClientTokenFromReadWriteToken(options),
  head: (url) => head(url),
  del: (urls) => del(urls),
  list: (options) => list(options),
};

// The environment and database this API runs against, e.g. "production-bookbroker".
export const photoNamespace = () =>
  `${process.env.VERCEL_ENV || process.env.NODE_ENV || "development"}-${mongoose.connection.name}`;

// Every book's blobs live under their own path in the namespace, so a URL names its book.
const booksPrefix = () => `${photoNamespace()}/books/`;
export const photoPrefix = (bookId) => `${booksPrefix()}${bookId}/`;

/**
 * A client token for one photo of `bookId` of `contentType`: `{ token, pathname }`.
 * Vercel Blob itself refuses any other pathname, type or a larger file with it.
 */
export async function uploadToken(bookId, contentType) {
  const pathname = `${photoPrefix(bookId)}${randomBytes(16).toString("hex")}.${PHOTO_TYPES[contentType]}`;
  const token = await blobStore.clientToken({
    pathname,
    allowedContentTypes: [contentType],
    maximumSizeInBytes: MAX_PHOTO_BYTES,
    validUntil: Date.now() + UPLOAD_TOKEN_LIFETIME_MS,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return { token, pathname };
}

/**
 * Looks `url` up in the store as an upload for `bookId`: `{ url }`, the store's
 * own URL for it, when it is a blob of this book of an allowed type and size;
 * `{ problem }` otherwise, with `discard` set when the blob is this book's and
 * should go.
 */
export async function checkUpload(bookId, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { problem: "That is not a photo upload." };
  }
  if (parsed.protocol !== "https:") return { problem: "That is not a photo upload." };

  let blob;
  try {
    blob = await blobStore.head(url);
  } catch (err) {
    if (err instanceof BlobNotFoundError) return { problem: "That upload could not be found." };
    throw err;
  }

  // Another book's photo is left alone, whoever is asking.
  if (!blob.pathname?.startsWith(photoPrefix(bookId))) {
    return { problem: "That upload is not for this book." };
  }
  if (!PHOTO_TYPES[blob.contentType]) {
    return { problem: "Photos must be JPEG, PNG or WebP.", discard: true };
  }
  if (!(blob.size <= MAX_PHOTO_BYTES)) {
    return { problem: "That photo is too large.", discard: true };
  }
  return { url: blob.url };
}

// --------------------
// Deleting blobs
// --------------------

const pending = new Set();

// Runs `work` after the response, without holding it up. A failure is only
// logged: the daily cron deletes whatever it leaves.
function inBackground(work, what) {
  const job = (async () => {
    if (photosEnabled()) await work();
  })().finally(() => pending.delete(job));
  pending.add(job);
  runInBackground(job, what);
}

/** Deletes the blobs at `urls`, in the background. */
export function discardPhotos(urls) {
  if (!urls.length) return;
  inBackground(() => blobStore.del(urls), "delete photo blobs");
}

// The URLs of every blob under `prefix`.
async function blobsUnder(prefix) {
  const urls = [];
  let cursor;
  do {
    const page = await blobStore.list({ prefix, cursor });
    urls.push(...page.blobs.map((blob) => blob.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return urls;
}

/**
 * Deletes every blob of the books `bookIds`, attached as a photo or not, in
 * the background. Inside a transaction, call it once committed.
 */
export function discardBookBlobs(bookIds) {
  if (!bookIds?.length) return;
  const prefixes = bookIds.map((id) => photoPrefix(id));
  inBackground(async () => {
    const urls = [];
    for (const prefix of prefixes) urls.push(...(await blobsUnder(prefix)));
    if (urls.length) await blobStore.del(urls);
  }, "delete book blobs");
}

/** Resolves when every blob deletion started so far has finished. */
export async function photoCleanupSettled() {
  while (pending.size) await Promise.allSettled([...pending]);
}

// An upload's token lasts minutes, so a blob this old that no book shows was
// never attached (or outlived its photo) and never will be.
const UNATTACHED_AGE_MS = 24 * 60 * 60 * 1000;
const LIST_BATCH = 1000;

/**
 * Deletes every blob of this namespace's books older than a day that is not one
 * of its book's photos, a page of the store at a time, for the cron. Returns how
 * many blobs were deleted.
 */
export async function deleteUnattachedBlobs(now = Date.now()) {
  if (!photosEnabled()) return 0;

  const prefix = booksPrefix();
  let deleted = 0;
  let cursor;
  do {
    const page = await blobStore.list({ prefix, cursor, limit: LIST_BATCH });
    const old = page.blobs.filter((blob) => now - new Date(blob.uploadedAt).getTime() > UNATTACHED_AGE_MS);
    const bookIds = [...new Set(old.map((blob) => blob.pathname.slice(prefix.length).split("/")[0]))].filter((id) =>
      mongoose.isValidObjectId(id)
    );
    const books = await OfferedBook.find({ _id: { $in: bookIds } }).select("photos.url").lean();
    const attached = new Set(books.flatMap((book) => book.photos.map((photo) => photo.url)));
    const unattached = old.map((blob) => blob.url).filter((url) => !attached.has(url));
    if (unattached.length) await blobStore.del(unattached);
    deleted += unattached.length;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}
