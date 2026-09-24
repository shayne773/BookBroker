import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthShell from './AuthShell';
import { postPublic } from './publicApi';

const CATEGORY_NAMES = {
  messages: 'new messages',
  trades: 'trades',
  wishlist: 'wishlist matches',
};

// Landing page for the unsubscribe link in every notification email. It names
// the category the link turns off (the token's second part) and turns it off,
// with no sign-in, only when the reader presses the button: mail scanners open
// links, and must not unsubscribe anyone by doing so.
export default function Unsubscribe() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const category = token?.split('.')[1];
  const [state, setState] = useState(
    token && CATEGORY_NAMES[category]
      ? { status: 'ready' }
      : { status: 'failed', message: 'This unsubscribe link is incomplete.' }
  );

  const unsubscribe = async () => {
    setState({ status: 'sending' });
    try {
      const { ok, data } = await postPublic('/notifications/unsubscribe', { token });
      setState(ok
        ? { status: 'done' }
        : { status: 'failed', message: data.message || 'This unsubscribe link did not work.' });
    } catch (err) {
      console.error('Error unsubscribing:', err);
      setState({ status: 'failed', message: 'An error occurred. Please try again.' });
    }
  };

  const settings = (
    <p className="auth__switch">
      <span>Change any email setting on your profile.</span>
      <Link className="textlink" to="/profile#notifications">Email settings</Link>
    </p>
  );

  if (state.status === 'ready' || state.status === 'sending') {
    return (
      <AuthShell kicker="Email settings" title="Unsubscribe">
        <p className="prose">Stop getting emails about {CATEGORY_NAMES[category]}?</p>
        <button
          className="button button--primary button--block"
          type="button"
          onClick={unsubscribe}
          disabled={state.status === 'sending'}
        >
          Unsubscribe
        </button>
        {settings}
      </AuthShell>
    );
  }

  if (state.status === 'done') {
    return (
      <AuthShell kicker="Email settings" title="Unsubscribed">
        <p className="prose">
          You will no longer get emails about {CATEGORY_NAMES[category]}.
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
