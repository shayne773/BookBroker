import { Link } from 'react-router-dom';
import BookCover from '../BookCover';
import DistanceLabel from '../DistanceLabel';
import Feedback, { DoneButton } from '../Feedback';

// The live suggestion list under the Google Books field.
export const GoogleSuggestions = ({ results, onPick }) => (
  <ul className="suggestions">
    {results.map((book, idx) => (
      <li key={idx}>
        {/*
          mousedown/touchstart rather than click: the input's blur handler
          closes this list, and blur would otherwise win the race.
        */}
        <button
          type="button"
          className="suggestion"
          onMouseDown={(e) => onPick(book, e)}
          onTouchStart={(e) => onPick(book, e)}
        >
          <span className="suggestion__cover cover">
            <BookCover src={book.cover} />
          </span>

          <span className="suggestion__body">
            <span className="suggestion__title">{book.title}</span>
            <span className="suggestion__meta">{book.author}</span>
          </span>
        </button>
      </li>
    ))}
  </ul>
);

// The chosen Google Books volume, with the two things it can become. Each
// button turns into a checked state once done (`added`), `adding` names the
// one under way (both wait for it), and `feedback` says why one failed.
export const GoogleSelection = ({ book, added, adding, feedback, onWishlist, onOffer, onCancel }) => (
  <article className="selection">
    <div className="selection__cover cover">
      <BookCover src={book.cover} />
    </div>

    <div className="selection__body">
      <p className="kicker">Selected from Google Books</p>

      <h2 className="selection__title">{book.title}</h2>

      <p className="book-row__meta">
        {book.author}
        {book.year ? ` · ${book.year}` : ''}
      </p>

      <p className="book-row__meta">
        {book.publisher ? book.publisher : ''}
        {book.isbn ? ` · ISBN ${book.isbn}` : ''}
      </p>

      <div className="button-row selection__actions">
        <DoneButton
          className="button button--primary"
          done={added.wishlist}
          doneLabel="On your wishlist"
          busy={Boolean(adding)}
          busyLabel={adding === 'wishlist' ? 'Adding…' : undefined}
          onClick={onWishlist}
        >
          Add to Wishlist
        </DoneButton>

        <DoneButton
          className="button button--secondary"
          done={added.offered}
          doneLabel="Offered"
          busy={Boolean(adding)}
          busyLabel={adding === 'offered' ? 'Adding…' : undefined}
          onClick={onOffer}
        >
          Add to Offerings
        </DoneButton>

        <button className="button button--quiet" onClick={onCancel} disabled={Boolean(adding)}>
          {added.wishlist || added.offered ? 'Done' : 'Cancel'}
        </button>
      </div>

      <Feedback feedback={feedback} />
    </div>
  </article>
);

// Marketplace hits: the same record row the rest of Browse uses.
export const MarketResults = ({ books }) => {
  if (!books.length) {
    return <p className="no-books">No books found for this search.</p>;
  }

  return (
    <div className="book-list">
      {books.map((book, index) => (
        <article key={book._id || index} className="book-row">
          <span className="cover">
            <BookCover src={book.cover} />
          </span>

          <div className="book-row__body">
            <h2 className="book-row__title">
              {book._id ? (
                <Link to={`/books/${book._id}`} className="headline-link">
                  {book.title || '[NO TITLE]'}
                </Link>
              ) : (
                book.title || '[NO TITLE]'
              )}
            </h2>

            <p className="book-row__meta">
              {book.author || '[NO AUTHOR]'}
              {book.year ? ` · ${book.year}` : ''}
            </p>
            <DistanceLabel miles={book.distanceMiles} block />
          </div>

          {book._id ? (
            <Link to={`/books/${book._id}`} className="button button--secondary button--small">
              Show Interest
            </Link>
          ) : (
            <button className="button button--secondary button--small" disabled title="Missing book id">
              Show Interest
            </button>
          )}
        </article>
      ))}
    </div>
  );
};
