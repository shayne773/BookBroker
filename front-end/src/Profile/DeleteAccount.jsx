import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch, clearSession, isSessionExpiredError } from '../auth';
import Feedback from '../Feedback';
import useFeedback from '../useFeedback';

// The word the reader types to show they mean it.
export const CONFIRM_WORD = 'DELETE';

// The last section of the profile: deleting the account for good. The form opens
// only on request, and deleting needs the password and the typed confirmation.
// The server ends every session of the account, so this browser signs out too
// and lands on the sign-in page, which says the account is gone.
const DeleteAccount = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const { feedback, fail, clear } = useFeedback();

  const confirmed = confirmation.trim() === CONFIRM_WORD;

  const close = () => {
    setOpen(false);
    setPassword('');
    setConfirmation('');
    clear();
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!password || !confirmed || busy) return;
    clear();
    setBusy(true);
    try {
      const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        fail(data.message || 'Your account could not be deleted. Please try again.');
        return;
      }
      clearSession();
      navigate('/login', { replace: true, state: { accountDeleted: true } });
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      console.error('Failed to delete account:', err);
      setBusy(false);
      fail('Your account could not be deleted. Please try again.');
    }
  };

  return (
    <section className="section" aria-labelledby="delete-account-title">
      <div className="section-head">
        <h2 className="section-title" id="delete-account-title">Delete account</h2>
      </div>

      <div className="stack">
        <p className="hint">
          Deleting your account is permanent and can&rsquo;t be undone. Your offerings, wishlist,
          blocks and settings are removed, and any trade offers or accepted trades not yet complete
          are cancelled. Completed trades, ratings and messages stay with the other readers, under
          the name &ldquo;Deleted reader&rdquo;. To use this email again, create a new account.
        </p>

        {!open ? (
          <div>
            <button type="button" className="button button--quiet" onClick={() => setOpen(true)}>
              Delete my account&hellip;
            </button>
          </div>
        ) : (
          <form className="form" onSubmit={submit}>
            <div className="form__row">
              <label className="field">
                <span className="field__label">Your password</span>
                <input
                  className="input"
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>

              <label className="field">
                <span className="field__label">Type {CONFIRM_WORD} to confirm</span>
                <input
                  className="input"
                  type="text"
                  name="confirmation"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                />
              </label>
            </div>

            <div className="button-row">
              <button
                type="submit"
                className="button button--secondary"
                disabled={busy || !password || !confirmed}
              >
                {busy ? 'Deleting…' : 'Delete account permanently'}
              </button>
              <button type="button" className="button button--quiet" onClick={close} disabled={busy}>
                Cancel
              </button>
            </div>

            <Feedback feedback={feedback} />
          </form>
        )}
      </div>
    </section>
  );
};

export default DeleteAccount;
