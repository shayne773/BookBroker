import { useNavigate } from 'react-router-dom';
import BookCover from './BookCover';

// A whole wishlist or offerings shelf, one book per row. Your own shelves pass
// `onRemove`; another reader's are read-only. `renderExtra(book)` adds a line
// under a book's author, e.g. who is offering it.
const ShelfPage = ({ kicker, title, books, emptyLabel, onRemove, renderExtra }) => {
  const navigate = useNavigate();

  return (
    <main className="page page--reading">
      <button type="button" className="back-link" onClick={() => navigate(-1)}>
        <span className="back-link__mark" aria-hidden="true">&larr;</span>
        Back
      </button>

      <div className="page-head">
        <div className="page-head__main">
          <p className="kicker">{kicker}</p>
          <h1 className="page-title">{title}</h1>
        </div>
      </div>

      {books.length > 0 ? (
        <ul className="book-list">
          {books.map((book) => (
            <li key={book._id || book.isbn} className="book-row">
              <span className="cover">
                <BookCover src={book.cover} />
              </span>

              <div className="book-row__body">
                <h2 className="book-row__title">{book.title}</h2>
                {book.author && <p className="book-row__meta">{book.author}</p>}
                {renderExtra?.(book)}
              </div>

              {onRemove && (
                <button
                  type="button"
                  className="button button--quiet button--small"
                  onClick={() => onRemove(book._id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">{emptyLabel}</p>
      )}
    </main>
  );
};

export default ShelfPage;
