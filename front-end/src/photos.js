// An owner's photos of their offered book (back-end/lib/photos.js has the flow).
// A photo is shrunk and re-encoded here, in the browser, then uploaded straight
// to Vercel Blob with a client token the API issues for that one upload; the
// API only ever sees its URL and size. Re-encoding through a canvas also drops
// the file's EXIF metadata, which can hold where the photo was taken.
import { authFetch, isSessionExpiredError } from './auth';

export const MAX_PHOTOS = 4;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// The long edge a photo is shrunk to, and the size it must come in under
// (the API refuses anything over 2 MB).
export const MAX_EDGE = 1600;
export const TARGET_BYTES = 1.5 * 1024 * 1024;
const QUALITIES = [0.85, 0.75, 0.6];

export class PhotoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PhotoError';
  }
}

export const isPhotoType = (type) => PHOTO_TYPES.includes(type);

/** `width` × `height` scaled down, never up, so its long edge is at most `max`. */
export function fitWithin(width, height, max = MAX_EDGE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// The file decoded, upright: `from-image` applies the EXIF orientation, which
// would otherwise be lost with the rest of the metadata.
const decodeImage = (file) => createImageBitmap(file, { imageOrientation: 'from-image' });

// `image` drawn at `width` × `height` on white (a PNG's transparency has
// nothing to show through in a JPEG), returning a function that encodes it.
function drawImage(image, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return (quality) =>
    new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new PhotoError('This photo could not be read.'))),
        'image/jpeg',
        quality
      )
    );
}

// The browser's decoder and canvas, which jsdom lacks; replaced in tests.
export const imageCodec = { decode: decodeImage, draw: drawImage };

/**
 * `file` made ready to upload: `{ blob, width, height }`, a new JPEG at most
 * MAX_EDGE on its long edge and under TARGET_BYTES, with none of the file's
 * metadata. The file itself is never uploaded, however small. Throws a
 * PhotoError with words for the reader when it cannot be done.
 */
export async function preparePhoto(file) {
  if (!isPhotoType(file.type)) throw new PhotoError('Photos must be JPEG, PNG or WebP.');

  let image;
  try {
    image = await imageCodec.decode(file);
  } catch {
    throw new PhotoError('This photo could not be read.');
  }

  try {
    const { width, height } = fitWithin(image.width, image.height);
    const encode = imageCodec.draw(image, width, height);
    for (const quality of QUALITIES) {
      const blob = await encode(quality);
      if (blob.size <= TARGET_BYTES) return { blob, width, height };
    }
    throw new PhotoError('This photo is too detailed to upload. Try another.');
  } finally {
    image.close?.();
  }
}

const photosUrl = (bookId) => `${import.meta.env.VITE_SERVER_ADDRESS}/user/offered/${bookId}/photos`;

// The API's answer as JSON, or an Error in its words.
async function answer(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new PhotoError(data.message || fallback);
  return data;
}

const sendJson = (url, method, body) =>
  authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// The Vercel Blob upload, loaded only when a photo is uploaded; replaced in tests.
export const blobUpload = {
  put: async (...args) => (await import('@vercel/blob/client')).put(...args),
};

/**
 * Prepares `file` and adds it to book `bookId` as its last photo. Calls
 * `onProgress(percent)` as the upload goes. Resolves to the book's photos.
 */
export async function uploadPhoto(bookId, file, { onProgress } = {}) {
  const { blob, width, height } = await preparePhoto(file);

  const { token, pathname } = await answer(
    await sendJson(`${photosUrl(bookId)}/upload-token`, 'POST', { contentType: 'image/jpeg', size: blob.size }),
    'This photo could not be uploaded.'
  );

  let uploaded;
  try {
    uploaded = await blobUpload.put(pathname, blob, {
      access: 'public',
      token,
      contentType: 'image/jpeg',
      onUploadProgress: ({ percentage }) => onProgress?.(Math.round(percentage)),
    });
  } catch (err) {
    console.error('Photo upload failed:', err);
    throw new PhotoError('This photo could not be uploaded. Check your connection and try again.');
  }

  const { photos } = await answer(
    await sendJson(photosUrl(bookId), 'POST', { url: uploaded.url, width, height }),
    'This photo could not be saved.'
  );
  return photos;
}

/** Removes photo `photoId` from book `bookId`; resolves to the book's photos. */
export async function removePhoto(bookId, photoId) {
  const res = await authFetch(`${photosUrl(bookId)}/${photoId}`, { method: 'DELETE' });
  return (await answer(res, 'This photo could not be removed.')).photos;
}

/** Puts book `bookId`'s photos in the order of `photoIds`; resolves to its photos. */
export async function reorderPhotos(bookId, photoIds) {
  const res = await sendJson(`${photosUrl(bookId)}/order`, 'PUT', { order: photoIds });
  return (await answer(res, 'The photos could not be reordered.')).photos;
}

// Why a photo action failed, in the reader's words.
export const reasonOf = (err, fallback) => (err instanceof PhotoError ? err.message : fallback);

/**
 * Uploads `files` to book `bookId` one at a time, reporting each step through
 * `onProgress({ index, count, percent })` and each success through
 * `onPhotos(photos)`. Resolves to the errors of the ones that failed; throws
 * only when the session has expired.
 */
export async function uploadPhotos(bookId, files, { onProgress, onPhotos }) {
  const failed = [];
  for (const [i, file] of files.entries()) {
    onProgress({ index: i + 1, count: files.length, percent: 0 });
    try {
      onPhotos(
        await uploadPhoto(bookId, file, {
          onProgress: (percent) => onProgress({ index: i + 1, count: files.length, percent }),
        })
      );
    } catch (err) {
      if (isSessionExpiredError(err)) throw err;
      if (!(err instanceof PhotoError)) console.error('Photo upload failed:', err);
      failed.push(err);
    }
  }
  return failed;
}

// How an upload of several photos went, for a Feedback line.
export function uploadOutcome(added, failed, skipped) {
  const problems = [];
  if (failed.length) {
    const reason = reasonOf(failed[0], "The photo couldn't be uploaded.");
    problems.push(failed.length === 1 ? reason : `${failed.length} photos couldn't be uploaded. ${reason}`);
  }
  if (skipped) problems.push(`A book can have up to ${MAX_PHOTOS} photos, so ${skipped} ${skipped === 1 ? 'was' : 'were'} left out.`);
  if (problems.length) return { tone: 'error', message: problems.join(' ') };
  return { tone: 'done', message: added === 1 ? 'Photo added' : `${added} photos added` };
}

/** "3 photos", for a book in a list; empty for none. */
export const photoCountLabel = (count) =>
  count > 0 ? `${count} ${count === 1 ? 'photo' : 'photos'}` : '';
