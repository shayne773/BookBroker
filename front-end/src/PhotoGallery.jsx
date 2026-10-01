import { useEffect, useRef, useState } from 'react';
import FadeImg from './FadeImg';

// The owner's photos of their copy, on the book's page: a row of thumbnails,
// any of which opens large in place above them, not in a pop-up. The large
// view steps through the photos with its buttons or the arrow keys, and closes
// with its button or Escape, handing focus back to the thumbnail it came from.
const PhotoGallery = ({ photos = [], title }) => {
  const [open, setOpen] = useState(null); // index of the enlarged photo
  const viewer = useRef(null);
  const thumbs = useRef([]);
  const shown = open !== null && open < photos.length ? open : null;

  useEffect(() => {
    if (shown !== null) viewer.current?.focus();
  }, [shown]);

  if (!photos.length) return null;

  const close = () => {
    thumbs.current[shown]?.focus();
    setOpen(null);
  };
  const step = (by) => setOpen((shown + by + photos.length) % photos.length);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else return;
    e.preventDefault();
  };

  const label = (i) => `Photo ${i + 1} of ${photos.length} of ${title || 'this book'}`;

  return (
    <div className="photo-gallery">
      {shown !== null && (
        <figure
          className="photo-viewer"
          ref={viewer}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          aria-label={label(shown)}
        >
          <FadeImg
            key={photos[shown].url}
            className="photo-viewer__img"
            src={photos[shown].url}
            width={photos[shown].width}
            height={photos[shown].height}
            alt={label(shown)}
          />
          <figcaption className="photo-viewer__bar">
            <span className="photo-viewer__count">{shown + 1} / {photos.length}</span>
            <span className="photo-viewer__actions">
              {photos.length > 1 && (
                <>
                  <button type="button" className="button button--quiet button--small" onClick={() => step(-1)}>
                    <span aria-hidden="true">&larr;</span> Previous
                  </button>
                  <button type="button" className="button button--quiet button--small" onClick={() => step(1)}>
                    Next <span aria-hidden="true">&rarr;</span>
                  </button>
                </>
              )}
              <button type="button" className="button button--secondary button--small" onClick={close}>
                Close
              </button>
            </span>
          </figcaption>
        </figure>
      )}

      <ul className="photo-strip">
        {photos.map((photo, i) => (
          <li key={photo._id || photo.url}>
            <button
              type="button"
              ref={(el) => (thumbs.current[i] = el)}
              className={`photo-thumb${shown === i ? ' is-selected' : ''}`}
              aria-pressed={shown === i}
              aria-label={`Enlarge photo ${i + 1} of ${photos.length}`}
              onClick={() => (shown === i ? close() : setOpen(i))}
            >
              <FadeImg src={photo.url} loading="lazy" width={photo.width} height={photo.height} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default PhotoGallery;
