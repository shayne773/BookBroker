import { useEffect, useMemo, useRef } from 'react';
import { MAX_PHOTOS, PHOTO_TYPES, isPhotoType } from '../photos';

// Photos of the reader's copy, chosen while offering a book and uploaded once
// the book is added (Profile.jsx). Shows each chosen file small, with a way to
// drop it; anything but JPEG, PNG or WebP, or past MAX_PHOTOS, is left out.
const PhotoPicker = ({ files, onChange, disabled }) => {
  const input = useRef(null);
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const pick = (e) => {
    const picked = [...e.target.files].filter((file) => isPhotoType(file.type));
    e.target.value = '';
    onChange([...files, ...picked].slice(0, MAX_PHOTOS));
  };

  return (
    <div className="field">
      <span className="field__label">Photos of your copy (optional)</span>

      {files.length > 0 && (
        <ul className="photo-picker">
          {files.map((file, i) => (
            <li key={previews[i]} className="photo-picker__item">
              <img src={previews[i]} alt="" className="photo-picker__img" />
              <button
                type="button"
                className="photo-picker__remove"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                &#10005;
              </button>
            </li>
          ))}
        </ul>
      )}

      {files.length < MAX_PHOTOS && (
        <div className="photo-manager__add">
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            {files.length ? 'Add more photos' : 'Add photos'}
          </button>
          <input ref={input} type="file" accept={PHOTO_TYPES.join(',')} multiple hidden onChange={pick} />
          <span className="hint">Up to {MAX_PHOTOS}; the first is the main one. Location data is removed.</span>
        </div>
      )}
    </div>
  );
};

export default PhotoPicker;
