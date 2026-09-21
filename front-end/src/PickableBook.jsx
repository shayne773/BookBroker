import BookCover from './BookCover';

// A cover that can be chosen when putting a trade together. Selection is
// announced through aria-pressed and drawn as an ink ring with a check.
const PickableBook = ({ book, selected, onClick, showAuthor = false }) => (
  <button
    type="button"
    className={`pick${selected ? ' is-selected' : ''}`}
    aria-pressed={selected}
    onClick={onClick}
    title={book.title}
  >
    <span className="cover">
      <BookCover src={book.cover} />
    </span>
    <span className="pick__check" aria-hidden="true">&#10003;</span>
    <span className="pick__title">{book.title || 'Untitled'}</span>
    {showAuthor && <span className="pick__meta">{book.author || 'Unknown'}</span>}
  </button>
);

export default PickableBook;
