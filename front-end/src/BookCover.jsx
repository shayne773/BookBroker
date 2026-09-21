import { useState } from 'react';

// The inside of a `.cover` frame: the jacket when we have one, and otherwise
// the title set in type, so a book with no artwork still reads as a book.
const BookCover = ({ src, title }) => {
  const [brokenSrc, setBrokenSrc] = useState(null);

  if (!src || src === brokenSrc) {
    return (
      <span className="cover__fallback">
        <span className="cover__fallback-label">No cover</span>
        <span className="cover__fallback-title">{title || '[NO TITLE]'}</span>
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      className="cover__img"
      onError={() => setBrokenSrc(src)}
    />
  );
};

export default BookCover;
