import { Link } from 'react-router-dom';
import BookCover from '../BookCover';
import UserLink from '../UserLink';

// What each side puts on the table.
export default function ExchangeBooks({ ex }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Books</h2>
      </div>

      <div className="split">
        <Side name={<UserLink user={ex.requester} fallback="Requester" />} books={ex.requesterBooks || []} />
        <Side name={<UserLink user={ex.responder} fallback="Responder" />} books={ex.responderBooks || []} />
      </div>

      <p className="hint mt-4">
        Tip: If you want to change the book(s), hit <b>Counter</b>.
      </p>
    </section>
  );
}

function Side({ name, books }) {
  return (
    <div>
      <p className="fact__term">{name} gives</p>

      {books.length ? (
        <div className="book-grid book-grid--small">
          {books.map((b) => (
            <Link key={b._id} to={`/books/${b._id}`} className="book-tile">
              <span className="cover">
                <BookCover src={b.cover} />
              </span>
              <span className="book-tile__title">{b.title || "Untitled"}</span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="hint">No books selected.</p>
      )}
    </div>
  );
}
