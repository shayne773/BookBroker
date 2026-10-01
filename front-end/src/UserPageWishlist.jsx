import ShelfPage from './ShelfPage';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from './auth';
import useReader from './useReader';
import useRemembered from './remember';
import UserLink from './UserLink';
import MessageAction from './UserPage/MessageAction';

const UserPageWishlist = () => {
  const { id } = useParams(); // user id
  const [reader] = useReader(id);
  const [wishlistBooks, setWishlistBooks] = useRemembered(`/users/${id}/wishlist`);

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}/wishlist`)
      .then(res => res.json())
      .then(data => setWishlistBooks(data))
      .catch(err => {
        // RedirectOnSessionEnd is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.error('Failed to fetch user wishlist:', err);
        setWishlistBooks([]);
      });
  }, [id, setWishlistBooks]);

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
