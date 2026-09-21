import { useState, useEffect } from "react";
import { authFetch, isSessionExpiredError } from './auth';
import BookCover from './BookCover';

const Feed = () => {
  const [booksData, setBooksData] = useState([]);

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/get-recommended-books`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    }).then(res => res.json())
    .then(data => {
        setBooksData(data);
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
