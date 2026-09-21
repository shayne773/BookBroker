import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { authFetch, isSessionExpiredError } from './auth';
import ProfileHead from './ProfileHead';
import ShelfPreview from './ShelfPreview';

const UserPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState({});
  const [wishlistBooks, setWishlistBooks] = useState([]);
  const [offeredBooks, setOfferedBooks] = useState([]);

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}`)
      .then(res => res.json())
      .then(data => setUser(Array.isArray(data) ? data[0] : data))
      .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;
        setUser({});
      });

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}/wishlist`)
      .then(res => res.json())
      .then(setWishlistBooks)
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        setWishlistBooks([]);
      });

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}/offered`)
      .then(res => res.json())
      .then(setOfferedBooks)
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        setOfferedBooks([]);
      });
  }, [id]);

  return (
    <main className="page">
      <button type="button" className="back-link" onClick={() => navigate(-1)}>
        <span className="back-link__mark" aria-hidden="true">&larr;</span>
        Back
      </button>

      <ProfileHead kicker="Reader" user={user} />

      <div className="split">
        <ShelfPreview
          title="Wishlist"
          books={wishlistBooks}
          emptyLabel="No items in wishlist"
          seeAllTo={`/users/${id}/wishlist`}
        />

        <ShelfPreview
          title="Offerings"
          books={offeredBooks}
          emptyLabel="No open offerings"
          seeAllTo={`/users/${id}/offered`}
        />
      </div>
    </main>
  );
};

export default UserPage;
