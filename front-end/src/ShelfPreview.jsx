import { Link } from 'react-router-dom';
import BookCover from './BookCover';
import Feedback from './Feedback';

// The first four books of a wishlist or an offerings shelf, with a link to the
// whole shelf and, on your own profile, a way to add to it. `linkTo(book)` makes
// each tile open that book; `metaOf(book)` replaces the author line and may
// name a reader, so it is set outside the tile's link; `error` replaces the
// shelf with a notice when it could not be loaded; `feedback` says how the last
// add went, under the head.
const ShelfPreview = ({
  title,
  books,
  emptyLabel,
  error,
  seeAllTo,
  onAdd,
  linkTo,
  metaOf = (book) => book.author,
  feedback,
}) => (
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

    {feedback !== undefined && <Feedback feedback={feedback} className="mb-4" />}

    {error ? (
      <p className="notice notice--error" role="alert">{error}</p>
    ) : books.length > 0 ? (
      <ul className="book-grid book-grid--four">
        {books.slice(0, 4).map((book, i) => {
          const cover = (
            <>
              <span className="cover">
                <BookCover src={book.cover} />
              </span>
              <span className="book-tile__title">{book.title}</span>
            </>
          );
          const meta = metaOf(book) && <span className="book-tile__meta">{metaOf(book)}</span>;

          return linkTo ? (
            <li key={book._id || book.isbn || i} className="book-tile">
              <Link to={linkTo(book)} className="book-tile">{cover}</Link>
              {meta}
            </li>
          ) : (
            <li key={book._id || book.isbn || i} className="book-tile">{cover}{meta}</li>
          );
        })}
      </ul>
    ) : (
      <p className="empty">{emptyLabel}</p>
    )}
  </section>
);

export default ShelfPreview;
