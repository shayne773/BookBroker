import { useState } from 'react';
import FadeImg from './FadeImg';

// The inside of a `.cover` frame: the jacket when we have one, fading in once
// it has loaded, and otherwise an empty frame. Every caller sets the title beside the cover, so the
// fallback carries no text of its own beyond an optional label.
const BookCover = ({ src }) => {
  const [brokenSrc, setBrokenSrc] = useState(null);

  if (!src || src === brokenSrc) {
    return (
      <span className="cover__fallback" aria-hidden="true">
        <span className="cover__fallback-label">No cover</span>
      </span>
    );
  }

  return (
    <FadeImg
      src={src}
      className="cover__img"
      onError={() => setBrokenSrc(src)}
    />
  );
};

export default BookCover;
