import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { SESSION_EXPIRED_EVENT, getToken } from './auth';

// Whether the server ended this browser's session (any 401) while the page was open.
const useSessionEnded = () => {
  const [sessionEnded, setSessionEnded] = useState(false);

  useEffect(() => {
    const onExpired = () => setSessionEnded(true);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  return sessionEnded;
};

// Layout route that gates every page needing a signed-in user.
// Without a token it sends the visitor to /login and remembers where they were
// headed, so Login can drop them back there after a successful sign in. When the
// server ended the session (any 401), it also tells Login to say so.
const RequireAuth = () => {
  const location = useLocation();
  const sessionEnded = useSessionEnded();

  if (!getToken()) {
    return <Navigate to="/login" state={{ from: location, sessionEnded }} replace />;
  }

  return <Outlet />;
};

// Layout route for the pages a visitor can browse too. They render without a
// token, but a reader whose session the server ends there is sent to /login
// with the same notice as on the pages behind RequireAuth.
export const RedirectOnSessionEnd = () => {
  const location = useLocation();
  const sessionEnded = useSessionEnded();

  if (sessionEnded) {
    return <Navigate to="/login" state={{ from: location, sessionEnded }} replace />;
  }

  return <Outlet />;
};

export default RequireAuth;
