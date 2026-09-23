import ShelfPage from '../ShelfPage';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from '../auth';
import useWishlistMatches from './useWishlistMatches';

const MyBooks = () => {
  const [wishlistBooks, setWishlistBooks] = useState([]);
  const { matches } = useWishlistMatches();

  // How many other readers offer each wishlist book, by wishlist book id.
  const offerCounts = useMemo(
    () => new Map(matches.map(({ wishlistBook, offers }) => [wishlistBook._id, offers.length])),
    [matches]
  );

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/wishlist`)
      .then(res => res.json())
      .then(data => setWishlistBooks(data))
      .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.log("Failed to fetch wishlist:", err);
        setWishlistBooks([]);
      });
  }, []);

  const handleDelete = (bookId) => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/wishlist/${bookId}`, {
      method: "DELETE"
    })
      .then(res => {
        if (res.ok) setWishlistBooks(prev => prev.filter(b => b._id !== bookId));
        else console.error("Failed to delete book from wishlist");
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error("Error deleting book:", err);
      });
  };

  return (
    <ShelfPage
      kicker="Your profile"
      title="Wishlist"
      books={wishlistBooks}
      emptyLabel="Loading wishlist..."
      onRemove={handleDelete}
      renderExtra={(book) => {
        const count = offerCounts.get(book._id);
        if (!count) return null;
        return (
          <p className="book-row__extra">
            <Link to="/profile/matches" className="textlink-quiet">
              Available from {count} {count === 1 ? 'reader' : 'readers'}
              <span className="textlink-arrow__mark" aria-hidden="true">&rarr;</span>
            </Link>
          </p>
        );
      }}
    />
  );
};

export default MyBooks;
