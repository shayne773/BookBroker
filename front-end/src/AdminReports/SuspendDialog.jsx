import { useState } from 'react';
import Dialog from '../Dialog';

const NOTE_MAX_LENGTH = 1000;

// Confirms a suspension, saying what it does, with an optional note on why.
const SuspendDialog = ({ user, busy, error, onConfirm, onClose }) => {
  const [note, setNote] = useState('');

  const submit = (e) => {
    e.preventDefault();
    onConfirm(note);
  };

  return (
    <Dialog title={`Suspend ${user.username}?`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="prose">
          {user.username} is signed out everywhere and can&rsquo;t sign in again until the
          suspension is lifted. Their offers leave the market, and nobody can message them or
          propose a trade to them. Trades already under way are left as they are.
        </p>

        <label className="field">
          <span className="field__label">Note (optional, seen by admins only)</span>
          <textarea
            className="input"
            value={note}
            maxLength={NOTE_MAX_LENGTH}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why is this account suspended?"
          />
        </label>

        {error && <p className="notice notice--error" role="alert">{error}</p>}

        <div className="dialog__foot">
          <button type="button" className="button button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? 'Suspending…' : 'Suspend'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default SuspendDialog;
