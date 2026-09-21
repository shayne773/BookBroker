import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch, clearSession, isSessionExpiredError } from './auth';
import ProfileHead from './ProfileHead';
import ShelfPreview from './ShelfPreview';
import AddBookDialog from './Profile/AddBookDialog';
import EditProfileDialog from './Profile/EditProfileDialog';
import useBookSearch from './Profile/useBookSearch';

const Profile = () => {
  const navigate = useNavigate();
  const userId = localStorage.getItem('userId');

  const [user, setUser] = useState({});
  const [wishlistBooks, setWishlistBooks] = useState([]);
  const [offeredBooks, setOfferedBooks] = useState([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddOfferingsModal, setShowAddOfferingsModal] = useState(false);

  const [showToastWishlist, setShowToastWishlist] = useState(false);
  const [showToastOfferings, setShowToastOfferings] = useState(false);

  const wishlistSearch = useBookSearch();
  const offerSearch = useBookSearch();

  // Edit profile fields
  const [location, setLocation] = useState('');
  const [customLocation, setCustomLocation] = useState('');

  const fetchUserData = () => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user?id=${userId}`)
      .then(res => res.json())
      .then(data => setUser(data))
      .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;
        console.log('Failed to fetch user:', err);
      });
  };

  useEffect(() => {
    fetchUserData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/wishlist`)
      .then(res => res.json())
      .then(data => setWishlistBooks(data))
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.log("Failed to fetch wishlist:", err);
      });

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/offered`)
      .then(res => res.json())
      .then(data => setOfferedBooks(data))
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.log("Failed to fetch offerings", err);
      });
  }, []);

  const handleAddBook = (e) => {
    e.preventDefault();
    if (!wishlistSearch.selected) return;

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/add-wishlist-book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(wishlistSearch.selected)
    })
      .then(res => res.json())
      .then(() => {
        setShowToastWishlist(true);
        setTimeout(() => setShowToastWishlist(false), 2000);
        setShowAddModal(false);
        wishlistSearch.reset();
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error(err);
      });
  };

  const handleAddOffering = (e) => {
    e.preventDefault();
    if (!offerSearch.selected) return;

    const payload = { ...offerSearch.selected, owner: userId };

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/add-offered-book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(() => {
        setShowToastOfferings(true);
        setTimeout(() => setShowToastOfferings(false), 2000);
        setShowAddOfferingsModal(false);
        offerSearch.reset();
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error(err);
      });
  };

  const handleProfileEdit = (e, close) => {
    e.preventDefault();
    const username = e.target.username.value;
    const email = e.target.email.value;
    const finalLocation = location === 'Other' ? customLocation : location;

    const data = { user: { username, email, location: finalLocation } };

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(res => res.json())
      .then(() => {
        fetchUserData();
        close();
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error(err);
      });
  };

  const handleLogout = () => {
    fetch(`${import.meta.env.VITE_SERVER_ADDRESS}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .catch(err => console.error("Logout error:", err))
      .finally(() => {
        // The local session goes either way; the server call is best effort.
        clearSession();
        navigate('/login', { replace: true });
      });
  };

  const closeWishlistModal = () => {
    setShowAddModal(false);
    wishlistSearch.dismiss();
  };

  const closeOfferModal = () => {
    setShowAddOfferingsModal(false);
    offerSearch.dismiss();
  };

  return (
    <main className="page">
      <ProfileHead kicker="Your profile" user={user}>
        <EditProfileDialog
          location={location}
          setLocation={setLocation}
          customLocation={customLocation}
          setCustomLocation={setCustomLocation}
          onSubmit={handleProfileEdit}
        />

        <button type="button" className="button button--quiet" onClick={handleLogout}>
          Log out
        </button>
      </ProfileHead>

      <div className="split">
        <ShelfPreview
          title="Wishlist"
          books={wishlistBooks}
          emptyLabel="Loading wishlist..."
          seeAllTo="/profile/my-books"
          onAdd={() => setShowAddModal(true)}
        />

        <ShelfPreview
          title="Offerings"
          books={offeredBooks}
          emptyLabel="Loading offerings..."
          seeAllTo="/profile/my-trades"
          onAdd={() => setShowAddOfferingsModal(true)}
        />
      </div>

      {showAddModal && (
        <AddBookDialog
          title="Add a book to your wishlist"
          search={wishlistSearch}
          onSubmit={handleAddBook}
          onClose={closeWishlistModal}
        />
      )}

      {showAddOfferingsModal && (
        <AddBookDialog
          title="Add a book to your offerings"
          search={offerSearch}
          onSubmit={handleAddOffering}
          onClose={closeOfferModal}
        />
      )}

      {showToastWishlist && <div className="toast" role="status">Book added to wishlist</div>}
      {showToastOfferings && <div className="toast" role="status">Book added to offerings</div>}
    </main>
  );
};

export default Profile;
