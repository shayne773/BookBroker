import { Link } from 'react-router-dom';
import BookCover from './BookCover';

// The first four books of a wishlist or an offerings shelf, with a link to the
// whole shelf and, on your own profile, a way to add to it.
const ShelfPreview = ({ title, books, emptyLabel, seeAllTo, onAdd }) => (
  <section className="section">
    <div className="section-head">
      <h2 className="section-title">{title}</h2>

      <div className="section-head__aside">
        {onAdd && (
          <button type="button" className="button button--secondary button--small" onClick={onAdd}>
            Add a book
          </button>
        )}

        <Link to={seeAllTo} className="textlink-quiet">
          See all
          <span className="textlink-arrow__mark" aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </div>

    {books.length > 0 ? (
      <ul className="book-grid book-grid--four">
        {books.slice(0, 4).map((book, i) => (
          <li key={book._id || book.isbn || i} className="book-tile">
            <span className="cover">
              <BookCover src={book.cover} />
            </span>
            <span className="book-tile__title">{book.title}</span>
            {book.author && <span className="book-tile__meta">{book.author}</span>}
          </li>
        ))}
      </ul>
    ) : (
      <p className="empty">{emptyLabel}</p>
    )}
  </section>
);

export default ShelfPreview;
