import { useEffect, useState } from 'react';
import { authFetch, isSessionExpiredError } from './auth';

// Another reader's public profile (GET /users/:id), `{}` until it loads or when
// it can't. The setter lets a page record a change it made, e.g. a block.
export default function useReader(id) {
  const [reader, setReader] = useState({});

  useEffect(() => {
    let alive = true;
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}`)
      .then(res => (res.ok ? res.json() : {}))
      .then(data => alive && setReader((Array.isArray(data) ? data[0] : data) || {}))
      .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err) || !alive) return;
        setReader({});
      });
    return () => {
      alive = false;
    };
  }, [id]);

  return [reader, setReader];
}
