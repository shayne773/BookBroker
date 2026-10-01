import ShelfPage from './ShelfPage';
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from './auth';
import useReader from './useReader';
import useRemembered from './remember';
import UserLink from './UserLink';
import MessageAction from './UserPage/MessageAction';
import DistanceLabel from './DistanceLabel';
import PhotoCount from './PhotoCount';

const UserPageOffered = () => {
  const { id } = useParams(); // user id
  const [reader] = useReader(id);
  const [offeredBooks, setOfferedBooks] = useRemembered(`/users/${id}/offered`);

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}/offered`)
      .then(res => res.json())
      .then(data => setOfferedBooks(data))
      .catch(err => {
        // RedirectOnSessionEnd is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.error('Failed to fetch user offerings:', err);
        setOfferedBooks([]);
      });
  }, [id, setOfferedBooks]);

  return (
    <ShelfPage
      kicker={<UserLink user={reader} fallback="Reader" />}
      title="Offerings"
      aside={<MessageAction user={reader} />}
      books={offeredBooks}
      emptyLabel="No offerings"
      linkTo={(book) => `/books/${book._id}`}
      renderExtra={(book) => (
        <>
          <DistanceLabel miles={book.distanceMiles} label={book.distanceLabel} block />
          <PhotoCount count={book.photoCount} block />
        </>
      )}
    />
  );
};

export default UserPageOffered;
