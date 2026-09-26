import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authFetch, isSessionExpiredError, logout } from './auth';
import ProfileHead from './ProfileHead';
import ShelfPreview from './ShelfPreview';
import AddBookDialog from './Profile/AddBookDialog';
import EditProfileDialog from './Profile/EditProfileDialog';
import useBookSearch from './Profile/useBookSearch';
import useWishlistMatches from './Profile/useWishlistMatches';
import BlockedReaders from './Profile/BlockedReaders';
import NotificationSettings from './Profile/NotificationSettings';
import LocationSettings from './Profile/LocationSettings';
import { formatDistance } from './distance';
import useFeedback from './useFeedback';
import UserLink from './UserLink';

const Profile = () => {
  const navigate = useNavigate();
  const userId = localStorage.getItem('userId');

  const [user, setUser] = useState({});
  const [wishlistBooks, setWishlistBooks] = useState([]);
  const [offeredBooks, setOfferedBooks] = useState([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddOfferingsModal, setShowAddOfferingsModal] = useState(false);

  // An added book appears on its shelf, and the shelf says so under its head;
  // a failed add says why in its dialog.
  const wishlistFeedback = useFeedback();
  const offeringsFeedback = useFeedback();
  const [addError, setAddError] = useState('');
  const [editNotice, setEditNotice] = useState(null);

  const { matches, loaded: matchesLoaded, error: matchesError } = useWishlistMatches();
  // Every offer of a wishlisted book, for the preview; the full list groups them by book.
  const matchedOffers = matches.flatMap(({ offers }) => offers);

  const wishlistSearch = useBookSearch();
  const offerSearch = useBookSearch();

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

  const loadWishlist = () =>
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/wishlist`)
      .then(res => res.json())
      .then(data => setWishlistBooks(data))
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.log("Failed to fetch wishlist:", err);
      });

  const loadOffered = () =>
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/offered`)
      .then(res => res.json())
      .then(data => setOfferedBooks(data))
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.log("Failed to fetch offerings", err);
      });

  useEffect(() => {
    loadWishlist();
    loadOffered();
  }, []);

  // Adds the book chosen in a dialog to a shelf, then shows it there.
  const addBook = (path, body, { close, search, reload, feedback, label }) => {
    setAddError('');
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(async res => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'That book could not be added. Please try again.');
        close();
        search.reset();
        reload();
        feedback.done(`${body.title || 'Book'} added to your ${label}`);
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error(err);
        setAddError(err.message);
      });
  };

  const handleAddBook = (e) => {
    e.preventDefault();
    if (!wishlistSearch.selected) return;

    addBook('/user/add-wishlist-book', wishlistSearch.selected, {
      close: () => setShowAddModal(false),
      search: wishlistSearch,
      reload: loadWishlist,
      feedback: wishlistFeedback,
      label: 'wishlist',
    });
  };

  const handleAddOffering = (e) => {
    e.preventDefault();
    if (!offerSearch.selected) return;

    addBook('/user/add-offered-book', { ...offerSearch.selected, owner: userId }, {
      close: () => setShowAddOfferingsModal(false),
      search: offerSearch,
      reload: loadOffered,
      feedback: offeringsFeedback,
      label: 'offerings',
    });
  };

  const handleProfileEdit = (e, close) => {
    e.preventDefault();
    const username = e.target.username.value;
    const email = e.target.email.value;

    const data = { user: { username, email } };

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(async res => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        fetchUserData();
        close();
        if (!ok) setEditNotice({ error: true, message: data.message || 'Your profile could not be updated.' });
        else if (data.confirmationSentTo) setEditNotice({ error: false, message: data.message });
        else setEditNotice(null);
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error(err);
      });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const closeWishlistModal = () => {
    setAddError('');
    setShowAddModal(false);
    wishlistSearch.dismiss();
  };

  const closeOfferModal = () => {
    setAddError('');
    setShowAddOfferingsModal(false);
    offerSearch.dismiss();
  };

  return (
    <main className="page">
      <ProfileHead kicker="Your profile" user={user}>
        <EditProfileDialog onSubmit={handleProfileEdit} />

        {/* The API decides who is an admin (ADMIN_EMAILS); this only offers the page. */}
        {user.isAdmin && (
          <Link to="/admin/reports" className="button button--secondary">
            Reports
          </Link>
        )}

        <button type="button" className="button button--quiet" onClick={handleLogout}>
          Log out
        </button>
      </ProfileHead>

      {editNotice && (
        <p
          className={editNotice.error ? 'notice notice--error mt-4' : 'notice mt-4'}
          role={editNotice.error ? 'alert' : 'status'}
        >
          {editNotice.message}
        </p>
      )}

      {matchesLoaded && (
        <ShelfPreview
          title="Available from other readers"
          books={matchedOffers}
          emptyLabel="None of your wishlist is on offer right now."
          error={matchesError && 'Your matches could not be loaded.'}
          seeAllTo="/profile/matches"
          linkTo={(offer) => `/books/${offer._id}`}
          metaOf={(offer) => (
            <>
              from <UserLink user={offer.owner} />
              {formatDistance(offer.distanceMiles) && ` · ${formatDistance(offer.distanceMiles)}`}
            </>
          )}
        />
      )}

      <div className="split">
        <ShelfPreview
          title="Wishlist"
          books={wishlistBooks}
          emptyLabel="Loading wishlist..."
          seeAllTo="/profile/my-books"
          onAdd={() => setShowAddModal(true)}
          feedback={wishlistFeedback.feedback}
        />

        <ShelfPreview
          title="Offerings"
          books={offeredBooks}
          emptyLabel="Loading offerings..."
          seeAllTo="/profile/my-trades"
          onAdd={() => setShowAddOfferingsModal(true)}
          feedback={offeringsFeedback.feedback}
        />
      </div>

      <LocationSettings user={user} onSaved={fetchUserData} />

      <NotificationSettings settings={user.notifications} />

      <BlockedReaders />

      {showAddModal && (
        <AddBookDialog
          title="Add a book to your wishlist"
          search={wishlistSearch}
          error={addError}
          onSubmit={handleAddBook}
          onClose={closeWishlistModal}
        />
      )}

      {showAddOfferingsModal && (
        <AddBookDialog
          title="Add a book to your offerings"
          search={offerSearch}
          error={addError}
          onSubmit={handleAddOffering}
          onClose={closeOfferModal}
        />
      )}
    </main>
  );
};

export default Profile;
