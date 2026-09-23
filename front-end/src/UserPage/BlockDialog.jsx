import Dialog from '../Dialog';

// Confirms a block before it is placed, saying what it does.
const BlockDialog = ({ user, busy, error, onConfirm, onClose }) => (
  <Dialog title={`Block ${user.username}?`} onClose={onClose}>
    <div className="dialog__body">
      <p className="prose">
        Neither of you will be able to message the other or propose a trade, and you
        won&rsquo;t see each other&rsquo;s offers. {user.username} is not told. You can
        unblock them from their page or from your profile.
      </p>

      {error && <p className="notice notice--error" role="alert">{error}</p>}
    </div>

    <div className="dialog__foot">
      <button type="button" className="button button--quiet" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="button button--primary" onClick={onConfirm} disabled={busy}>
        {busy ? 'Blocking…' : 'Block'}
      </button>
    </div>
  </Dialog>
);

export default BlockDialog;
