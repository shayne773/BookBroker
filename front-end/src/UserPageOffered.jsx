import ShelfPage from './ShelfPage';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from './auth';
import DistanceLabel from './DistanceLabel';

const UserPageOffered = () => {
  const { id } = useParams(); // user id
  const [offeredBooks, setOfferedBooks] = useState([]);

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}/offered`)
      .then(res => res.json())
      .then(data => setOfferedBooks(data))
      .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.error('Failed to fetch user offerings:', err);
        setOfferedBooks([]);
      });
  }, [id]);

  return (
    <ShelfPage
      kicker="Reader"
      title="Offerings"
      books={offeredBooks}
      emptyLabel="No offerings"
      renderExtra={(book) => (
        <DistanceLabel miles={book.distanceMiles} label={book.distanceLabel} block />
      )}
    />
  );
};

export default UserPageOffered;
