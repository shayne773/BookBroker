// Photos of an offered book, taken by its owner (`OfferedBook.photos`).
//
// The bytes never pass through the API. The browser resizes and re-encodes a
// photo, asks routes/photos.js for a grant that lets it write one blob, at one
// pathname under the book, of an allowed type and size; it uploads straight to
// Vercel Blob with it, then hands the URL back, which is checked against the
// store (`head`) before it is kept. Only URLs and sizes are stored.
//
// The store's credentials come in two forms. On Vercel a connected store sets
// BLOB_STORE_ID, and the SDK authenticates with the deployment's short-lived
// OIDC token; elsewhere (local development) BLOB_READ_WRITE_TOKEN is the store's
// static token. Without either photos are off: nothing can be uploaded and the
// front end hides the controls. Photos stored meanwhile still show.
//
// Every blob lives under its database's namespace (photoNamespace), so
// databases sharing a store never touch each other's blobs.
//
// A blob is deleted through discardPhotos, or with its whole book through
// discardBookBlobs, in the background and best effort: whatever they miss, the
// daily cron (/cron/photo-cleanup) deletes with the uploads never attached to
// their book (deleteUnattachedBlobs).
import { createHash, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { del, head, issueSignedToken, list, BlobError, BlobNotFoundError } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken, handleUploadPresigned } from "@vercel/blob/client";
import { MAX_PHOTOS, OfferedBook } from "../Data.js";
import { runInBackground } from "./background.js";

export { MAX_PHOTOS };

// The browser shrinks a photo to 1600 px on its long edge well before this.
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

// The types a photo may be, with the extension its pathname gets.
export const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// A grant is for one upload, made right after it is issued.
const UPLOAD_TOKEN_LIFETIME_MS = 10 * 60 * 1000;

export const PHOTOS_UNAVAILABLE = "PHOTOS_UNAVAILABLE";

// A store connected to the Vercel project (OIDC), as opposed to a static token.
const storeConnected = () => Boolean(process.env.BLOB_STORE_ID);

export const photosEnabled = () => storeConnected() || Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// A failure of the store itself (unreachable, token or store invalid), as
// opposed to a refusal of the request.
export const isBlobStoreError = (err) => err instanceof BlobError;

// handleUploadPresigned wants the key that verifies upload-completed callbacks
// even to presign. No upload here asks for a callback (the browser hands the URL
// back and checkUpload looks it up), so the key is never used.
const NO_CALLBACKS = "no-upload-callbacks";

// A presigned upload of one blob, which the browser's `uploadPresigned` uploads
// with in place of a token. A client token can only be signed with the
// read-write token; this is signed by the store, for whichever credentials the
// SDK has.
async function presignedUpload({ pathname, allowedContentTypes, maximumSizeInBytes, validUntil, ...urlOptions }) {
  const { presignedUrlPayload } = await handleUploadPresigned({
    body: { type: "blob.generate-presigned-url", payload: { pathname, clientPayload: null, multipart: false } },
    request: { headers: {} },
    webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY || NO_CALLBACKS,
    getSignedToken: async () => ({
      token: await issueSignedToken({
        pathname,
        operations: ["put"],
        allowedContentTypes,
        maximumSizeInBytes,
        validUntil,
      }),
      urlOptions,
    }),
  });
  return presignedUrlPayload;
}

// The Vercel Blob SDK, which finds its credentials itself: the deployment's
// OIDC token with BLOB_STORE_ID, else BLOB_READ_WRITE_TOKEN.
export const vercelBlob = {
  clientToken: (options) => generateClientTokenFromReadWriteToken(options),
  presignedUpload,
  head: (url) => head(url),
  del: (urls) => del(urls),
  list: (options) => list(options),
};

// The store every call goes through, so tests can replace it; no test reaches Vercel Blob.
export const blobStore = { ...vercelBlob };

/**
 * The database `connection` is to, as a short stable hash of its cluster's
 * host(s) and its name: never the credentials, and not the environment, so
 * every deployment on one database (Preview and production) shares its blobs.
 */
export function photoNamespace(connection = mongoose.connection) {
  const { srvHost, hosts } = connection.getClient().options;
  const cluster = srvHost ?? hosts.map((host) => String(host)).sort().join(",");
  return createHash("sha256")
    .update(`${cluster.toLowerCase()}/${connection.name}`)
    .digest("hex")
    .slice(0, 16);
}

// Every book's blobs live under their own path in the namespace, so a URL names its book.
const booksPrefix = () => `${photoNamespace()}/books/`;
export const photoPrefix = (bookId) => `${booksPrefix()}${bookId}/`;

/**
 * A grant for one photo of `bookId` of `contentType`: `{ pathname }` with
 * `presigned` (a presigned upload) for a connected store, or `token` (a client
 * token) for a read-write token alone. Vercel Blob itself refuses any other
 * pathname, type or a larger file with either.
 */
export async function uploadToken(bookId, contentType) {
  const pathname = `${photoPrefix(bookId)}${randomBytes(16).toString("hex")}.${PHOTO_TYPES[contentType]}`;
  const limits = {
    pathname,
    allowedContentTypes: [contentType],
    maximumSizeInBytes: MAX_PHOTO_BYTES,
    validUntil: Date.now() + UPLOAD_TOKEN_LIFETIME_MS,
    addRandomSuffix: false,
    allowOverwrite: false,
  };
  if (storeConnected()) return { presigned: await blobStore.presignedUpload(limits), pathname };
  return { token: await blobStore.clientToken(limits), pathname };
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
