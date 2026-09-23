import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { authFetch, isSessionExpiredError } from './auth';
import { setBlocked } from './blocks';
import ProfileHead from './ProfileHead';
import ShelfPreview from './ShelfPreview';
import BlockDialog from './UserPage/BlockDialog';
import ReportDialog from './UserPage/ReportDialog';

const UserPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isMe = id === localStorage.getItem('userId');

  const [user, setUser] = useState({});
  const [wishlistBooks, setWishlistBooks] = useState([]);
  const [offeredBooks, setOfferedBooks] = useState([]);

  const [dialog, setDialog] = useState(null); // 'block' | 'report' | null
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [toast, setToast] = useState('');

  // A reader blocked either way has an empty offered shelf, so it is reloaded
  // whenever a block is placed or lifted.
  const loadOffered = useCallback(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}/offered`)
      .then(res => res.json())
      .then(setOfferedBooks)
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        setOfferedBooks([]);
      });
  }, [id]);

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}`)
      .then(res => res.json())
      .then(data => setUser((Array.isArray(data) ? data[0] : data) || {}))
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

    loadOffered();
  }, [id, loadOffered]);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(''), 2500);
  };

  const closeDialog = () => {
    setDialog(null);
    setActionError('');
  };

  const changeBlock = async (blocked) => {
    setBusy(true);
    setActionError('');
    try {
      const blockedByMe = await setBlocked(id, blocked);
      setUser(prev => ({ ...prev, blockedByMe }));
      setDialog(null);
      loadOffered();
      showToast(blockedByMe ? `${user.username} is blocked` : `${user.username} is unblocked`);
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      if (blocked) setActionError(err.message);
      else showToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onReported = (message) => {
    setDialog(null);
    showToast(message);
  };

  const canAct = !isMe && user?._id;

  return (
    <main className="page">
      <button type="button" className="back-link" onClick={() => navigate(-1)}>
        <span className="back-link__mark" aria-hidden="true">&larr;</span>
        Back
      </button>

      <ProfileHead kicker="Reader" user={user}>
        {canAct && (
          <>
            <button type="button" className="button button--quiet" onClick={() => setDialog('report')}>
              Report
            </button>
            {user.blockedByMe ? (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => changeBlock(false)}
                disabled={busy}
              >
                Unblock
              </button>
            ) : (
              <button type="button" className="button button--secondary" onClick={() => setDialog('block')}>
                Block
              </button>
            )}
          </>
        )}
      </ProfileHead>

      {user.blockedByMe && (
        <p className="notice mt-4" role="status">
          You&rsquo;ve blocked {user.username}. Neither of you can message the other or propose a
          trade, and you don&rsquo;t see each other&rsquo;s offers.
        </p>
      )}

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

      {dialog === 'block' && (
        <BlockDialog
          user={user}
          busy={busy}
          error={actionError}
          onConfirm={() => changeBlock(true)}
          onClose={closeDialog}
        />
      )}

      {dialog === 'report' && (
        <ReportDialog user={user} onClose={closeDialog} onReported={onReported} />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
};

export default UserPage;
