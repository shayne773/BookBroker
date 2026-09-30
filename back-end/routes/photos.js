// An owner's photos of one of their offered books, mounted at
// /user/offered/:id/photos behind authMiddleware (lib/photos.js has the flow).
// Only the owner reaches a book here: anyone else's reads as not found. A book
// an accepted trade holds (`locked`) keeps the photos the other reader agreed
// to. Every answer that changes the photos carries the book's `photos` as they now are.
import express from "express";
import mongoose from "mongoose";
import { OfferedBook } from "../Data.js";
import { LoginThrottle } from "../lib/loginThrottle.js";
import {
  checkUpload,
  discardPhotos,
  isBlobStoreError,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS,
  PHOTO_TYPES,
  PHOTOS_UNAVAILABLE,
  photosEnabled,
  uploadToken,
} from "../lib/photos.js";

const router = express.Router({ mergeParams: true });

const HOUR = 60 * 60 * 1000;

// Each token is storage an owner can fill, so they are rationed per reader.
const uploadThrottle = new LoginThrottle({
  scope: "photo-upload",
  windowMs: HOUR,
  lockoutMs: HOUR,
  accountMaxAttempts: 12,
});

// Photos are at most 10,000 px a side; the browser sends 1600 at most.
const MAX_DIMENSION = 10000;

const BOOK_NOT_FOUND = "Book not found or not authorized";
const TOO_MANY_PHOTOS = `A book can have up to ${MAX_PHOTOS} photos.`;
const WRONG_TYPE = "Photos must be JPEG, PNG or WebP.";
const TOO_LARGE = `Photos must be under ${MAX_PHOTO_BYTES / (1024 * 1024)} MB.`;

// The caller's own book `:id`, or null.
async function ownBook(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return OfferedBook.findOne({ _id: req.params.id, owner: req.user.userId }).select("photos locked").lean();
}

// The caller's own book `:id` while its photos may change.
const editableBookFilter = (req) => ({ _id: req.params.id, owner: req.user.userId, locked: false });

const bookLocked = (res) =>
  res.status(409).json({ message: "This book is in an accepted trade, so its photos can't change until the trade is over." });

const photosUnavailable = (res) =>
  res.status(503).json({ message: "Photos are not available right now.", code: PHOTOS_UNAVAILABLE });

// Uploading needs the Blob store; removing and reordering do not.
function requirePhotoStore(req, res, next) {
  if (photosEnabled()) return next();
  photosUnavailable(res);
}

// A store that fails is "unavailable" to the reader; anything else goes to the error handler.
function storeFailure(err, res, next) {
  if (!isBlobStoreError(err)) return next(err);
  console.error("Vercel Blob request failed:", err);
  photosUnavailable(res);
}

const isDimension = (value) => Number.isInteger(value) && value > 0 && value <= MAX_DIMENSION;

// body: { contentType, size } of the photo about to be uploaded.
// Answers { token, pathname }: upload the photo to exactly that pathname with it.
router.post("/upload-token", requirePhotoStore, async (req, res, next) => {
  const { contentType, size } = req.body ?? {};

  try {
    const book = await ownBook(req);
    if (!book) return res.status(404).json({ message: BOOK_NOT_FOUND });
    if (book.locked) return bookLocked(res);
    if (!Object.hasOwn(PHOTO_TYPES, contentType)) return res.status(400).json({ message: WRONG_TYPE });
    if (!Number.isInteger(size) || size <= 0) {
      return res.status(400).json({ message: "The photo's size is missing." });
    }
    if (size > MAX_PHOTO_BYTES) return res.status(413).json({ message: TOO_LARGE });
    if (book.photos.length >= MAX_PHOTOS) return res.status(409).json({ message: TOO_MANY_PHOTOS });

    const limit = await uploadThrottle.hit(req.user.userId);
    if (limit.limited) {
      res.set("Retry-After", String(limit.retryAfterSeconds));
      return res.status(429).json({ message: "Too many photo uploads. Please try again later." });
    }

    res.json(await uploadToken(book._id, contentType));
  } catch (err) {
    storeFailure(err, res, next);
  }
});

// body: { url, width, height } of a photo uploaded with a token from above.
// It becomes the book's last photo.
router.post("/", requirePhotoStore, async (req, res, next) => {
  const { url, width, height } = req.body ?? {};

  try {
    const book = await ownBook(req);
    if (!book) return res.status(404).json({ message: BOOK_NOT_FOUND });
    if (typeof url !== "string" || !isDimension(width) || !isDimension(height)) {
      return res.status(400).json({ message: "A photo needs its URL, width and height." });
    }

    const upload = await checkUpload(book._id, url);
    if (upload.problem) {
      if (upload.discard) discardPhotos([url]);
      return res.status(400).json({ message: upload.problem });
    }

    // The count is checked again here, since two uploads can pass the token's check together.
    const updated = await OfferedBook.findOneAndUpdate(
      { ...editableBookFilter(req), "photos.url": { $ne: upload.url }, [`photos.${MAX_PHOTOS - 1}`]: { $exists: false } },
      { $push: { photos: { url: upload.url, width, height } } },
      { new: true, projection: "photos" }
    ).lean();
    if (updated) return res.status(201).json({ photos: updated.photos });

    const current = await ownBook(req);
    if (current?.photos.some((photo) => photo.url === upload.url)) {
      return res.json({ photos: current.photos });
    }
    // Gone meanwhile, locked or full: the upload has no book to go on.
    discardPhotos([upload.url]);
    if (!current) return res.status(404).json({ message: BOOK_NOT_FOUND });
    if (current.locked) return bookLocked(res);
    res.status(409).json({ message: TOO_MANY_PHOTOS });
  } catch (err) {
    storeFailure(err, res, next);
  }
});

// body: { order: [photoId, ...] }, every photo of the book once; the first becomes the main one.
router.put("/order", async (req, res, next) => {
  const { order } = req.body ?? {};

  try {
    const book = await ownBook(req);
    if (!book) return res.status(404).json({ message: BOOK_NOT_FOUND });
    if (book.locked) return bookLocked(res);

    const byId = new Map(book.photos.map((photo) => [String(photo._id), photo]));
    const ids = Array.isArray(order) ? order.map(String) : [];
    if (ids.length !== byId.size || new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) {
      return res.status(409).json({ message: "The photos have changed. Reload the page and try again." });
    }

    // Applied only while the book still has exactly these photos.
    const photos = ids.map((id) => byId.get(id));
    const updated = await OfferedBook.findOneAndUpdate(
      { ...editableBookFilter(req), photos: { $size: photos.length }, "photos._id": { $all: photos.map((p) => p._id) } },
      { $set: { photos } },
      { new: true, projection: "photos" }
    ).lean();
    if (!updated) {
      return res.status(409).json({ message: "The photos have changed. Reload the page and try again." });
    }
    res.json({ photos: updated.photos });
  } catch (err) {
    next(err);
  }
});

router.delete("/:photoId", async (req, res, next) => {
  try {
    const book = mongoose.isValidObjectId(req.params.photoId) ? await ownBook(req) : null;
    if (!book) return res.status(404).json({ message: BOOK_NOT_FOUND });
    if (book.locked) return bookLocked(res);

    const before = await OfferedBook.findOneAndUpdate(
      { ...editableBookFilter(req), "photos._id": req.params.photoId },
      { $pull: { photos: { _id: req.params.photoId } } },
      { projection: "photos" }
    ).lean();
    if (!before) {
      if ((await ownBook(req))?.locked) return bookLocked(res);
      return res.status(404).json({ message: "Photo not found" });
    }

    const removed = before.photos.find((photo) => String(photo._id) === req.params.photoId);
    discardPhotos([removed.url]);
    res.json({ photos: before.photos.filter((photo) => photo !== removed) });
  } catch (err) {
    next(err);
  }
});

export default router;
