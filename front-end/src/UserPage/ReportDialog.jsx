import { useState } from 'react';
import Dialog from '../Dialog';
import { authFetch, isSessionExpiredError } from '../auth';

// The reasons the API accepts (REPORT_REASONS in back-end/Data.js).
const REPORT_REASONS = [
  ['SPAM', 'Spam or advertising'],
  ['HARASSMENT', 'Harassment or abuse'],
  ['SCAM', 'Scam or fraud'],
  ['NO_SHOW', "Didn't follow through on a trade"],
  ['INAPPROPRIATE', 'Inappropriate content'],
  ['OTHER', 'Something else'],
];

const DETAILS_MAX_LENGTH = 1000;

// Report a reader: one reason from the fixed list, and optional details. The
// report is stored for review; the reader is not told.
const ReportDialog = ({ user, onClose, onReported }) => {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!reason) {
      setError('Choose a reason for the report.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${user._id}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, details }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Your report could not be sent.');
      onReported(data.message || 'Thanks. Your report has been recorded.');
    } catch (err) {
      // RequireAuth is already redirecting to the login page.
      if (isSessionExpiredError(err)) return;
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Report ${user.username}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="hint">
          Reports are kept for review. {user.username} is not told who reported them.
        </p>

        <fieldset className="choices">
          <legend className="field__label">Reason</legend>
          {REPORT_REASONS.map(([value, label]) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name="reason"
                value={value}
                checked={reason === value}
                onChange={() => setReason(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <label className="field">
          <span className="field__label">Details (optional)</span>
          <textarea
            className="input"
            value={details}
            maxLength={DETAILS_MAX_LENGTH}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="What happened?"
          />
        </label>

        {error && <p className="notice notice--error" role="alert">{error}</p>}

        <div className="dialog__foot">
          <button type="button" className="button button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send report'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

export default ReportDialog;
