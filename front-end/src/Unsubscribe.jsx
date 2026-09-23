import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthShell from './AuthShell';
import { postPublic } from './publicApi';

const CATEGORY_NAMES = {
  messages: 'new messages',
  trades: 'trades',
  wishlist: 'wishlist matches',
};

// Landing page for the unsubscribe link in every notification email: following
// it turns that category of email off, with no sign-in. The ref keeps React's
// development double-mount from sending it twice.
export default function Unsubscribe() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [state, setState] = useState(token ? { status: 'pending' } : {
    status: 'failed',
    message: 'This unsubscribe link is incomplete.',
  });
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;

    postPublic('/notifications/unsubscribe', { token })
      .then(({ ok, data }) => setState(ok
        ? { status: 'done', category: data.category }
        : { status: 'failed', message: data.message || 'This unsubscribe link did not work.' }))
      .catch((err) => {
        console.error('Error unsubscribing:', err);
        setState({ status: 'failed', message: 'An error occurred. Please try again.' });
      });
  }, [token]);

  if (state.status === 'pending') {
    return (
      <AuthShell kicker="Email settings" title="Unsubscribing…">
        <p className="hint" role="status">Checking your link.</p>
      </AuthShell>
    );
  }

  const settings = (
    <p className="auth__switch">
      <span>Change any email setting on your profile.</span>
      <Link className="textlink" to="/profile#notifications">Email settings</Link>
    </p>
  );

  if (state.status === 'done') {
    return (
      <AuthShell kicker="Email settings" title="Unsubscribed">
        <p className="prose">
          You will no longer get emails about {CATEGORY_NAMES[state.category] || 'this'}.
        </p>
        {settings}
      </AuthShell>
    );
  }

  return (
    <AuthShell kicker="Email settings" title="Link not valid">
      <p className="notice notice--error" role="alert">{state.message}</p>
      {settings}
    </AuthShell>
  );
}
