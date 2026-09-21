import ShelfPage from '../ShelfPage';
import { useEffect, useState } from 'react';
import { authFetch, isSessionExpiredError } from '../auth';

const MyBooks = () => {
  const [wishlistBooks, setWishlistBooks] = useState([]);

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
    />
  );
};

export default MyBooks;
