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
import DeleteAccount from './Profile/DeleteAccount';
import { formatDistance } from './distance';
import useFeedback from './useFeedback';
import UserLink from './UserLink';
import { uploadPhotos } from './photos';
import useRemembered from './remember';

const NOT_LOADED = {};

const Profile = () => {
  const navigate = useNavigate();
  const userId = localStorage.getItem('userId');

  const [user, setUser] = useRemembered('/user', NOT_LOADED);
  const [wishlistBooks, setWishlistBooks] = useRemembered('/user/wishlist');
  const [offeredBooks, setOfferedBooks] = useRemembered('/user/offered');

  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddOfferingsModal, setShowAddOfferingsModal] = useState(false);

  // An added book appears on its shelf, and the shelf says so under its head;
  // a failed add says why in its dialog.
  const wishlistFeedback = useFeedback();
  const offeringsFeedback = useFeedback();
  const [addError, setAddError] = useState('');
  const [editError, setEditError] = useState('');
  // Photos chosen in the offer dialog, uploaded once the book is added.
  const [offerPhotos, setOfferPhotos] = useState([]);
  const [offerProgress, setOfferProgress] = useState(null);
  const [offerBusy, setOfferBusy] = useState(false);

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
        setWishlistBooks(shown => shown ?? []);
      });

  const loadOffered = () =>
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/offered`)
      .then(res => res.json())
      .then(data => setOfferedBooks(data))
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.log("Failed to fetch offerings", err);
        setOfferedBooks(shown => shown ?? []);
      });

  useEffect(() => {
    loadWishlist();
    loadOffered();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Adds the offered book, then uploads any photos chosen for it. A photo that
  // fails does not undo the book: the shelf says so, and it can be added from
  // the book's page.
  const handleAddOffering = async (e) => {
    e.preventDefault();
    if (!offerSearch.selected || offerBusy) return;

    const title = offerSearch.selected.title || 'Book';
    setAddError('');
    setOfferBusy(true);
    try {
      const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/add-offered-book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...offerSearch.selected, owner: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'That book could not be added. Please try again.');

      const failed = offerPhotos.length
        ? await uploadPhotos(data.id, offerPhotos, { onProgress: setOfferProgress, onPhotos: () => {} })
        : [];

      setShowAddOfferingsModal(false);
      offerSearch.reset();
      setOfferPhotos([]);
      loadOffered();
      if (failed.length) {
        const which = failed.length === 1 ? 'a photo' : `${failed.length} photos`;
        offeringsFeedback.fail(`${title} added to your offerings, but ${which} couldn't be uploaded. You can add photos from the book's page.`);
      } else {
        offeringsFeedback.done(`${title} added to your offerings`);
      }
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      console.error(err);
      setAddError(err.message);
    } finally {
      setOfferBusy(false);
      setOfferProgress(null);
    }
  };

  const handleProfileEdit = (e, close) => {
    e.preventDefault();
    const username = e.target.elements.username.value;

    const data = { user: { username } };

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(async res => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        fetchUserData();
        close();
        setEditError(ok ? '' : data.message || 'Your profile could not be updated.');
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
    if (offerBusy) return;
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

      {editError && (
        <p className="notice notice--error mt-4" role="alert">
          {editError}
        </p>
      )}

      <ShelfPreview
        title="Available from other readers"
        books={matchesLoaded ? matchedOffers : null}
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

      <div className="split">
        <ShelfPreview
          title="Wishlist"
          books={wishlistBooks}
          emptyLabel="Your wishlist is empty."
          seeAllTo="/profile/my-books"
          onAdd={() => setShowAddModal(true)}
          feedback={wishlistFeedback.feedback}
        />

        <ShelfPreview
          title="Offerings"
          books={offeredBooks}
          emptyLabel="You aren't offering any books yet."
          seeAllTo="/profile/my-trades"
          onAdd={() => setShowAddOfferingsModal(true)}
          feedback={offeringsFeedback.feedback}
        />
      </div>

      <LocationSettings user={user} onSaved={fetchUserData} />

      <NotificationSettings settings={user.notifications} />

      <BlockedReaders />

      <DeleteAccount />

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
          busy={offerBusy}
          photos={user.photoUploads ? offerPhotos : undefined}
          onPhotos={setOfferPhotos}
          progress={offerProgress}
          onSubmit={handleAddOffering}
          onClose={closeOfferModal}
        />
      )}
    </main>
  );
};

export default Profile;
