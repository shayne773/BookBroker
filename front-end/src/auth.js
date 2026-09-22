// auth.js
// Shared session helpers so every page treats a missing or expired token the same way.
// Route protection lives in RequireAuth.jsx, which listens for SESSION_EXPIRED_EVENT.

const TOKEN_KEY = 'token';
const USER_ID_KEY = 'userId';
const USERNAME_KEY = 'username';

export const SESSION_EXPIRED_EVENT = 'bookbroker:session-expired';

export const getToken = () => localStorage.getItem(TOKEN_KEY);

// The token names a session the server tracks; it stays valid while it is used
// at least once every 30 days, and the server ends it on logout or password reset.
export const saveSession = ({ token, userId, username }) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_ID_KEY, userId);
  localStorage.setItem(USERNAME_KEY, username);
};

export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_ID_KEY);
  localStorage.removeItem(USERNAME_KEY);
};

// Thrown by authFetch when the server rejects the token. Pages should ignore it:
// RequireAuth is already sending the user to the login page.
export class SessionExpiredError extends Error {
  constructor() {
    super('Your session has expired. Please log in again.');
    this.name = 'SessionExpiredError';
  }
}

export const isSessionExpiredError = (err) => err instanceof SessionExpiredError;

// Signs this browser out: the server ends the session, and the stored values go
// whether or not that call succeeds. Uses fetch, not authFetch, so a token the
// server has already dropped does not announce an expired session.
export const logout = async () => {
  const token = getToken();
  try {
    await fetch(`${import.meta.env.VITE_SERVER_ADDRESS}/logout`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch (err) {
    console.error('Logout error:', err);
  } finally {
    clearSession();
  }
};

// Ends the session and tells RequireAuth to redirect to the login page.
export const expireSession = () => {
  clearSession();
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
};

// fetch() with the bearer token attached and one shared 401 policy.
export const authFetch = async (url, options = {}) => {
  const token = getToken();
  const headers = { ...(options.headers || {}) };

  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    expireSession();
    throw new SessionExpiredError();
  }

  return res;
};
