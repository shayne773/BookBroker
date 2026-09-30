import { useCallback, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Dialog from './Dialog';
import { AccountPromptContext } from './useAccountPrompt';

// Asks a visitor to sign up before `action`, or to sign in if they already
// have an account. Both carry the page it was opened on as `from`, which Login
// (through Signup) reads to bring them back there.
export const SignUpPrompt = ({ action, from, onClose }) => (
  <Dialog title={`Sign up to ${action}`} onClose={onClose}>
    <div className="dialog__body">
      <p className="prose">
        Anyone can browse the books on BookBroker. With an account you can keep a wishlist,
        offer your own books, and message and trade with readers near you.
      </p>
      <p className="hint">Once you are signed in, you come back to this page.</p>
    </div>

    <div className="dialog__foot">
      <button type="button" className="button button--quiet" onClick={onClose}>
        Not now
      </button>
      <Link to="/login" state={{ from }} className="button button--secondary">
        Sign in
      </Link>
      <Link to="/signup" state={{ from }} className="button button--primary">
        Sign up
      </Link>
    </div>
  </Dialog>
);

// Holds the one prompt for the whole app (useAccountPrompt.js
// opens it). A prompt belongs to the page it was opened on, so it is gone once
// the reader moves on, e.g. to sign up.
export const AccountPromptProvider = ({ children }) => {
  const location = useLocation();
  const [open, setOpen] = useState(null); // { action, page: location.key }

  const prompt = useCallback((action) => setOpen({ action, page: location.key }), [location.key]);
  const close = useCallback(() => setOpen(null), []);

  return (
    <AccountPromptContext.Provider value={prompt}>
      {children}
      {open?.page === location.key && (
        <SignUpPrompt action={open.action} from={location} onClose={close} />
      )}
    </AccountPromptContext.Provider>
  );
};
