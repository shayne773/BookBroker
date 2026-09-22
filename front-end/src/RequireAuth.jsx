import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { SESSION_EXPIRED_EVENT, getToken } from './auth';

// Layout route that gates every page needing a signed-in user.
// Without a token it sends the visitor to /login and remembers where they were
// headed, so Login can drop them back there after a successful sign in. When the
// server ended the session (any 401), it also tells Login to say so.
const RequireAuth = () => {
  const location = useLocation();
  const [sessionEnded, setSessionEnded] = useState(false);

  useEffect(() => {
    const onExpired = () => setSessionEnded(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  if (!getToken()) {
    return <Navigate to="/login" state={{ from: location, sessionEnded }} replace />;
  }

  return <Outlet />;
};

export default RequireAuth;
