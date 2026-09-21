import { Link } from 'react-router-dom';
import BookCover from '../BookCover';

// The shared record list behind Newly Added, Popular Now and a genre: one row
// per book, hairline-separated, with the cover small and the title leading.
const BookList = ({ books, emptyLabel }) => {
  if (!books?.length) return <p className="no-books">{emptyLabel}</p>;

  return (
    <div className="book-list">
      {books.map((book) => {
        const id = book._id || book.id;

        return (
          <article key={id} className="book-row">
            <Link to={`/books/${id}`} className="cover" tabIndex={-1} aria-hidden="true">
              <BookCover src={book.cover} />
            </Link>

            <div className="book-row__body">
              <h2 className="book-row__title">
                <Link to={`/books/${id}`} className="headline-link">
                  {book.title || '[NO TITLE]'}
                </Link>
              </h2>

              <p className="book-row__meta">
                {book.author || '[NO AUTHOR]'} &middot; {book.year || '[NO DATE]'}
              </p>
            </div>

            <Link to={`/books/${id}`} className="button button--secondary button--small">
              Show Interest
            </Link>
          </article>
        );
      })}
    </div>
  );
};

export default BookList;
