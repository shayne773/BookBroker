import { useParams, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import BookList from '../BookList';

const Genre = () => {
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
    <main className="page page--reading">
      <div className="page-head">
        <div className="page-head__main">
          <p className="kicker">Genre</p>
          <h1 className="page-title">
            {genre.charAt(0).toUpperCase() + genre.slice(1)}
          </h1>
        </div>

        <div className="page-head__aside">
          <Link to="/browse/by-category" className="textlink-quiet">
            <span className="textlink-arrow__mark textlink-arrow__mark--back" aria-hidden="true">&larr;</span>
            All genres
          </Link>
        </div>
      </div>

      <BookList books={books} emptyLabel="No books found in this genre." />
    </main>
  );
};

export default Genre;
