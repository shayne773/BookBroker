import './Genre.css';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';

const fallbackCover = 'https://via.placeholder.com/128x192?text=No+Cover';

const Genre = () => {
  const navigate = useNavigate();
  const { genre } = useParams();
  const [books, setBooks] = useState([]);

  useEffect(() => {
    fetch(`${import.meta.env.VITE_SERVER_ADDRESS}/genres/${encodeURIComponent(genre)}`)
      .then(res => res.json())
      .then(data => setBooks(data))
      .catch(err => {
        console.error("Failed to fetch books:", err);
        setBooks([]);
      });
  }, [genre]);

  return (
    <main className="Genre">
      <h1 className="genre-title">{genre.charAt(0).toUpperCase() + genre.slice(1)}</h1>

      <div className="genre-books">
        {books.length > 0 ? (
          books.map((book) => (
            <div key={book._id} className="genre-book">
              <img
                src={book.cover || fallbackCover}
                alt={book.title || "Book Cover"}
              />

              <div className="genre-book-text">
                <h2>{book.title || "[NO TITLE]"}</h2>
                <p>{book.year || "[NO DATE]"}</p>
                <p>{book.author || "[NO AUTHOR]"}</p>
              </div>

              <Link to={`/books/${book._id}`} className="genre-book-button">
                <button className="interest-btn">Show Interest</button>
              </Link>
            </div>
          ))
        ) : (
          <p className="no-books">No books found in this genre.</p>
        )}
      </div>
    </main>
  );
};

export default Genre;