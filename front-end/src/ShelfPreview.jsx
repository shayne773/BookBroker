import { Link } from 'react-router-dom';
import BookCover from './BookCover';

// The first four books of a wishlist or an offerings shelf, with a link to the
// whole shelf and, on your own profile, a way to add to it. `linkTo(book)` makes
// each tile open that book; `metaOf(book)` replaces the author line.
const ShelfPreview = ({ title, books, emptyLabel, seeAllTo, onAdd, linkTo, metaOf = (book) => book.author }) => (
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
        {books.slice(0, 4).map((book, i) => {
          const tile = (
            <>
              <span className="cover">
                <BookCover src={book.cover} />
              </span>
              <span className="book-tile__title">{book.title}</span>
              {metaOf(book) && <span className="book-tile__meta">{metaOf(book)}</span>}
            </>
          );

          return linkTo ? (
            <li key={book._id || book.isbn || i}>
              <Link to={linkTo(book)} className="book-tile">{tile}</Link>
            </li>
          ) : (
            <li key={book._id || book.isbn || i} className="book-tile">{tile}</li>
          );
        })}
      </ul>
    ) : (
      <p className="empty">{emptyLabel}</p>
    )}
  </section>
);

export default ShelfPreview;
