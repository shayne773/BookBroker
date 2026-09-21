import ShelfPage from './ShelfPage';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from './auth';

const UserPageWishlist = () => {
  const { id } = useParams(); // user id
  const [wishlistBooks, setWishlistBooks] = useState([]);

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}/wishlist`)
      .then(res => res.json())
      .then(data => setWishlistBooks(data))
      .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.error('Failed to fetch user wishlist:', err);
        setWishlistBooks([]);
      });
  }, [id]);

  return (
    <ShelfPage
      kicker="Reader"
      title="Wishlist"
      books={wishlistBooks}
      emptyLabel="No items in wishlist"
    />
  );
};

export default UserPageWishlist;
