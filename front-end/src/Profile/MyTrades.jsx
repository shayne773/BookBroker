import ShelfPage from '../ShelfPage';
import { useEffect, useState } from 'react';
import { authFetch, isSessionExpiredError } from '../auth';

const MyTrades = () => {
  const [offeringsBooks, setOfferingsBooks] = useState([]);

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/offered`)
      .then(res => res.json())
      .then(data => setOfferingsBooks(data))
      .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.log("Failed to fetch offerings:", err);
        setOfferingsBooks([]);
      });
  }, []);

  const handleDelete = (bookId) => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/offered/${bookId}`, {
      method: "DELETE"
    })
      .then(res => {
        if (res.ok) {
          setOfferingsBooks(prev => prev.filter(book => book._id !== bookId));
        } else {
          console.error("Failed to delete book from offerings");
        }
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error("Error deleting book:", err);
      });
  };

  return (
    <ShelfPage
      kicker="Your profile"
      title="Offerings"
      books={offeringsBooks}
      emptyLabel="Loading Offerings..."
      onRemove={handleDelete}
    />
  );
};

export default MyTrades;
