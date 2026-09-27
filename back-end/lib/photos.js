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
// A blob is only ever deleted through discardPhotos, which records its URL in a
// PhotoCleanup with the change that drops it, so a deletion that fails is logged
// and retried by the daily cron (/cron/photo-cleanup) rather than lost.
import { randomBytes } from "node:crypto";
import { del, head, BlobError, BlobNotFoundError } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { MAX_PHOTOS, PhotoCleanup } from "../Data.js";
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
};

// Every blob of a book lives under its own path, so a URL names its book.
const photoPrefix = (bookId) => `books/${bookId}/`;

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

/**
 * Deletes the blobs at `urls`. The URLs are recorded first, inside `session`'s
 * transaction when there is one, so the record stands or falls with the change
 * that drops the photos. Without a session the blobs go right away, in the
 * background; with one, the caller starts that after committing
 * (cleanUpPhotosInBackground), and the daily cron covers any it misses.
 */
export async function discardPhotos(urls, { session } = {}) {
  if (!urls.length) return;
  if (session) {
    await PhotoCleanup.create([{ urls }], { session });
    return;
  }

  // The photos are already gone from the book; failing to record their blobs
  // only leaves them in the store, which is not worth failing the request over.
  try {
    await PhotoCleanup.create([{ urls }]);
  } catch (err) {
    console.error(`Failed to record photo blobs ${urls.join(", ")} for deletion:`, err);
  }
  cleanUpPhotosInBackground();
}

const CLEANUP_BATCH = 100;

/**
 * Deletes the blobs of every recorded cleanup, oldest first. A failure is
 * logged and its record kept, counted, for the next run. Returns how many
 * records were cleared.
 */
export async function cleanUpPhotos() {
  if (!photosEnabled()) return 0;

  let cleared = 0;
  const failed = [];
  for (;;) {
    const records = await PhotoCleanup.find({ _id: { $nin: failed } })
      .sort({ createdAt: 1 })
      .limit(CLEANUP_BATCH)
      .lean();
    for (const record of records) {
      try {
        await blobStore.del(record.urls);
        await PhotoCleanup.deleteOne({ _id: record._id });
        cleared += 1;
      } catch (err) {
        console.error(`Failed to delete photo blobs ${record.urls.join(", ")}:`, err);
        failed.push(record._id);
        await PhotoCleanup.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
      }
    }
    if (records.length < CLEANUP_BATCH) return cleared;
  }
}

/** Runs cleanUpPhotos after the response, without holding it up. */
export function cleanUpPhotosInBackground() {
  const job = cleanUpPhotos().finally(() => pending.delete(job));
  pending.add(job);
  runInBackground(job, "delete photo blobs");
}

/** Resolves when every blob deletion started so far has finished. */
export async function photoCleanupSettled() {
  while (pending.size) await Promise.allSettled([...pending]);
}
