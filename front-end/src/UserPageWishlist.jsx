import ShelfPage from './ShelfPage';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from './auth';
import useReader from './useReader';
import UserLink from './UserLink';
import MessageAction from './UserPage/MessageAction';

const UserPageWishlist = () => {
  const { id } = useParams(); // user id
  const [reader] = useReader(id);
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
      kicker={<UserLink user={reader} fallback="Reader" />}
      title="Wishlist"
      aside={<MessageAction user={reader} />}
      books={wishlistBooks}
      emptyLabel="No items in wishlist"
    />
  );
};

export default UserPageWishlist;
