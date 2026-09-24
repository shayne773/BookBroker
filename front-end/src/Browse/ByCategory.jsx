import { Link } from "react-router-dom";
import { useEffect, useState } from 'react';
import { authFetch, isSessionExpiredError } from '../auth';

const ByCategory = () => {
  const [genres, setGenres] = useState([]);

  useEffect(() => {
    // Signed in, so the genres are those of the books within your distance.
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/genres`)
      .then((res) => res.json())
      .then((data) => {
        setGenres(Array.isArray(data) ? data.filter(Boolean) : []);
      })
      .catch((error) => {
        if (isSessionExpiredError(error)) return;
        console.error('Failed to fetch genres:', error);
        setGenres([]);
      });
  }, []);

  return (
    <main className="page page--reading">
      <div className="page-head">
        <div className="page-head__main">
          <p className="kicker">Browse</p>
          <h1 className="page-title">Choose a Genre</h1>
        </div>

        <div className="page-head__aside">
          <Link to="/browse" className="textlink-quiet">
            <span className="textlink-arrow__mark textlink-arrow__mark--back" aria-hidden="true">&larr;</span>
            All of Browse
          </Link>
        </div>
      </div>

      <ul className="category-list">
        {genres.map((genre, index) => (
          <li key={index}>
            <Link
              to={`/browse/by-category/${encodeURIComponent(genre.toLowerCase())}`}
              className="category-item"
            >
              <span className="category-item__name">
                {genre.charAt(0).toUpperCase() + genre.slice(1)}
              </span>
              <span className="textlink-arrow__mark" aria-hidden="true">&rarr;</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
};

export default ByCategory;
