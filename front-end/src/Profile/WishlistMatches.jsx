import { Link, useNavigate } from 'react-router-dom';
import BookCover from '../BookCover';
import DistanceLabel from '../DistanceLabel';
import { formatDistance } from '../distance';
import { readerMeta } from '../rating';
import useWishlistMatches from './useWishlistMatches';

// "Available from other readers": each book on your wishlist that someone else
// is offering right now, with every reader offering it.
const WishlistMatches = () => {
  const navigate = useNavigate();
  const { matches, loaded, error } = useWishlistMatches();

  return (
    <main className="page page--reading">
      <button type="button" className="back-link" onClick={() => navigate(-1)}>
        <span className="back-link__mark" aria-hidden="true">&larr;</span>
        Back
      </button>

      <div className="page-head">
        <div className="page-head__main">
          <p className="kicker">Your wishlist</p>
          <h1 className="page-title">Available from other readers</h1>
          <p className="page-lede">Books on your wishlist that other readers are offering now.</p>
        </div>
      </div>

      {!loaded && <p className="empty" role="status">Loading…</p>}

      {loaded && error && (
        <div className="section">
          <p className="notice notice--error" role="alert">Your matches could not be loaded.</p>
        </div>
      )}

      {loaded && !error && matches.length === 0 && (
        <div className="empty">
          <p>None of your wishlist is on offer right now.</p>
          <p>When another reader offers a book you want, it will appear here.</p>
        </div>
      )}

      {matches.length > 0 && (
        <ul className="book-list">
          {matches.map(({ wishlistBook, offers }) => (
            <li key={wishlistBook._id} className="book-row">
              <span className="cover">
                <BookCover src={wishlistBook.cover} />
              </span>

              <div className="book-row__body">
                <h2 className="book-row__title">{wishlistBook.title}</h2>
                {wishlistBook.author && <p className="book-row__meta">{wishlistBook.author}</p>}

                <ul className="offer-list" aria-label={`Readers offering ${wishlistBook.title}`}>
                  {offers.map((offer) => (
                    <li key={offer._id}>
                      <Link to={`/books/${offer._id}`} className="offer-line">
                        <span>
                          <span className="offer-line__who">{offer.owner.username}</span>
                          {readerMeta(offer.owner) && (
                            <span className="offer-line__meta"> · {readerMeta(offer.owner)}</span>
                          )}
                          {formatDistance(offer.distanceMiles) && (
                            <>
                              {' · '}
                              <DistanceLabel miles={offer.distanceMiles} />
                            </>
                          )}
                        </span>
                        <span className="textlink-arrow__mark" aria-hidden="true">&rarr;</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <span className="tag">
                {offers.length} {offers.length === 1 ? 'offer' : 'offers'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
};

export default WishlistMatches;
