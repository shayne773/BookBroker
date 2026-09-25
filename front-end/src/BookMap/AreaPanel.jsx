import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from '../auth';
import BookCover from '../BookCover';
import DistanceLabel from '../DistanceLabel';
import { booksCount } from '../bookMap';

const areaUrl = (place, offset, searchKey) =>
  `${import.meta.env.VITE_SERVER_ADDRESS}/map/area?place=${encodeURIComponent(place)}` +
  (offset ? `&offset=${offset}` : '') +
  (searchKey ? `&${searchKey}` : '');

const fetchPage = async (place, offset, searchKey) => {
  const res = await authFetch(areaUrl(place, offset, searchKey));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// The side panel for one place on the map: its books on the market, newest
// first, a page at a time, only those matching the search when one is on
// (`searchKey`, its query string), and then Close goes back to the results.
// Keyed by place and search, so either starts afresh.
const AreaPanel = ({ place, count, searchKey = '', onClose }) => {
  const [books, setBooks] = useState([]);
  const [nextOffset, setNextOffset] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const addPage = useCallback((page) => {
    setBooks((shown) => [...shown, ...page.books]);
    setNextOffset(page.nextOffset);
  }, []);

  const failed = useCallback(
    (err) => {
      if (isSessionExpiredError(err)) return;
      console.error(`Failed to fetch the books in ${place}:`, err);
      setError(true);
    },
    [place]
  );

  useEffect(() => {
    let live = true;
    fetchPage(place, 0, searchKey)
      .then((page) => live && addPage(page))
      .catch((err) => live && failed(err))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [place, searchKey, addPage, failed]);

  const showMore = () => {
    setLoading(true);
    fetchPage(place, nextOffset, searchKey)
      .then(addPage)
      .catch(failed)
      .finally(() => setLoading(false));
  };

  return (
    <aside className="map-panel" aria-labelledby="map-panel-title">
      <div className="map-panel__head">
        <div>
          <p className="kicker">{searchKey ? 'Matching books in' : 'Books in'}</p>
          <h2 id="map-panel-title" className="map-panel__title">{place}</h2>
          {count !== undefined && <p className="map-panel__count">{booksCount(count)}</p>}
        </div>
        <button type="button" className="button button--quiet button--small" onClick={onClose}>
          {searchKey ? 'All results' : 'Close'}
        </button>
      </div>

      {error && (
        <p className="notice notice--error mt-4" role="alert">
          We couldn&rsquo;t load these books. Try again in a moment.
        </p>
      )}

      {!loading && !error && books.length === 0 && (
        <p className="empty">{searchKey ? 'No books here match this search right now.' : 'No books here right now.'}</p>
      )}

      {books.length > 0 && (
        <ul className="map-panel__list" aria-label={`Books in ${place}`}>
          {books.map((book) => (
            <li key={book._id} className="map-book">
              <Link to={`/books/${book._id}`} className="cover" tabIndex={-1} aria-hidden="true">
                <BookCover src={book.cover} />
              </Link>
              <div className="map-book__body">
                <Link to={`/books/${book._id}`} className="map-book__title headline-link">
                  {book.title || '[NO TITLE]'}
                </Link>
                <p className="map-book__meta">{book.author || '[NO AUTHOR]'}</p>
                <DistanceLabel miles={book.distanceMiles} label={book.distanceLabel} block />
              </div>
            </li>
          ))}
        </ul>
      )}

      {loading && <p className="hint mt-4" role="status">Loading books&hellip;</p>}

      {!loading && nextOffset !== null && (
        <button type="button" className="button button--secondary button--block mt-4" onClick={showMore}>
          Show more
        </button>
      )}
    </aside>
  );
};

export default AreaPanel;
