import { useRef, useState } from 'react';
import { isSessionExpiredError } from './auth';
import Feedback from './Feedback';
import useFeedback from './useFeedback';
import UploadProgress from './UploadProgress';
import {
  MAX_PHOTOS,
  PHOTO_TYPES,
  PhotoError,
  reasonOf,
  removePhoto,
  reorderPhotos,
  uploadOutcome,
  uploadPhotos,
} from './photos';

// The owner's controls for their book's photos, on its page: add up to
// MAX_PHOTOS (when `canUpload`, i.e. the Blob store is set up), remove any, and
// move them into order, the first being the main one. `onChange(photos)` hands
// the book's photos back after each change.
const PhotoManager = ({ bookId, photos, canUpload, onChange }) => {
  const { feedback, done, fail, clear } = useFeedback();
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const room = MAX_PHOTOS - photos.length;

  // Runs one change at a time, saying on the Feedback line when it fails.
  const run = async (change, failure) => {
    if (busy) return;
    clear();
    setBusy(true);
    try {
      onChange(await change());
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      if (!(err instanceof PhotoError)) console.error(err);
      fail(reasonOf(err, failure));
    } finally {
      setBusy(false);
    }
  };

  const add = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length || busy) return;

    clear();
    setBusy(true);
    const chosen = files.slice(0, room);
    let added = 0;
    try {
      const failed = await uploadPhotos(bookId, chosen, {
        onProgress: setProgress,
        onPhotos: (next) => {
          added += 1;
          onChange(next);
        },
      });
      const outcome = uploadOutcome(added, failed, files.length - chosen.length);
      (outcome.tone === 'done' ? done : fail)(outcome.message);
    } catch (err) {
      // uploadPhotos throws only once the session has expired, and
      // RedirectOnSessionEnd is already redirecting to the login page.
      if (!isSessionExpiredError(err)) console.error(err);
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const move = (index, by) => {
    const order = photos.map((photo) => photo._id);
    [order[index], order[index + by]] = [order[index + by], order[index]];
    run(() => reorderPhotos(bookId, order), "The photos couldn't be reordered.");
  };

  return (
    <div className="photo-manager">
      {canUpload && (
        <p className="hint">
          Show your copy: its condition, any notes or inscriptions. The first photo is the main one.
          Photos are resized in your browser, and their location data is removed.
        </p>
      )}

      {photos.length > 0 && (
        <ol className="photo-manager__list">
          {photos.map((photo, i) => (
            <li key={photo._id} className="photo-manager__item">
              <span className="photo-manager__frame">
                <img src={photo.url} alt="" width={photo.width} height={photo.height} />
              </span>
              <span className="photo-manager__label">{i === 0 ? 'Main photo' : `Photo ${i + 1}`}</span>
              <span className="photo-manager__actions">
                <button
                  type="button"
                  className="button button--quiet button--small"
                  aria-label={`Move photo ${i + 1} earlier`}
                  aria-disabled={busy || i === 0 || undefined}
                  onClick={i === 0 ? undefined : () => move(i, -1)}
                >
                  <span aria-hidden="true">&larr;</span>
                </button>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  aria-label={`Move photo ${i + 1} later`}
                  aria-disabled={busy || i === photos.length - 1 || undefined}
                  onClick={i === photos.length - 1 ? undefined : () => move(i, 1)}
                >
                  <span aria-hidden="true">&rarr;</span>
                </button>
                <button
                  type="button"
                  className="button button--quiet button--small"
                  aria-label={`Remove photo ${i + 1}`}
                  aria-disabled={busy || undefined}
                  onClick={() => run(() => removePhoto(bookId, photo._id), "The photo couldn't be removed.")}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {!canUpload ? null : room > 0 ? (
        <div className="photo-manager__add">
          <button
            type="button"
            className="button button--secondary button--small"
            aria-disabled={busy || undefined}
            onClick={busy ? undefined : () => input.current?.click()}
          >
            {photos.length ? 'Add more photos' : 'Add photos'}
          </button>
          <input
            ref={input}
            type="file"
            accept={PHOTO_TYPES.join(',')}
            multiple
            hidden
            onChange={add}
          />
          <span className="hint">
            JPEG, PNG or WebP, up to {room} more
          </span>
        </div>
      ) : (
        <p className="hint">This book has the most photos it can have, {MAX_PHOTOS}.</p>
      )}

      <UploadProgress progress={progress} />
      <Feedback feedback={feedback} />
    </div>
  );
};

export default PhotoManager;
