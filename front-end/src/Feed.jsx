import { useState, useEffect } from "react";
import { authFetch, isSessionExpiredError } from './auth';
import BookCover from './BookCover';
import DistanceLabel from './DistanceLabel';
import LocationPrompt from './LocationPrompt';
import useReaderArea from './useReaderArea';

const Feed = () => {
  const [booksData, setBooksData] = useState([]);
  const area = useReaderArea();

  useEffect(() => {
    // Nearby books ranked by the authors and genres on your wishlist and shelf.
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/recommendations`)
    .then(res => res.json())
    .then(data => {
        setBooksData(Array.isArray(data) ? data : []);
    })
    .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.error('Failed to fetch recommended books:', err);
        setBooksData([]);
    })
  }, []);

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__main">
          <p className="kicker">Recommended</p>
          <h1 className="page-title">For You</h1>
        </div>
      </div>

      <LocationPrompt area={area} />

      {/* Books */}
      <div className="section">
        <div className="book-grid">
          {booksData.map((book, index) => (
            <article key={index} className="book-tile">
              <span className="cover">
                <BookCover src={book.cover} />
              </span>
              <h2 className="book-tile__title">{book.title || "[NO TITLE]"}</h2>
              <p className="book-tile__meta">
                {book.year || "[NO YEAR]"}
                <br />
                {book.author || "[NO AUTHOR]"}
              </p>
              <DistanceLabel miles={book.distanceMiles} block />
              <a
                href={`/books/${book._id}`}
                className="button button--secondary button--small button--block tile-action"
              >
                Show Interest
              </a>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
};

export default Feed;
