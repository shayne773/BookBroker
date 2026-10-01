import { useEffect } from 'react';
import { authFetch, isSessionExpiredError } from './auth';
import useRemembered from './remember';

const NOT_LOADED = {};

// Another reader's public profile (GET /users/:id), `{}` until it loads or when
// it can't, and `{ deleted: true }` for a reader who is gone (404), i.e. who
// deleted their account. The setter lets a page record a change it made, e.g. a block.
export default function useReader(id) {
  const [reader, setReader] = useRemembered(`/users/${id}`, NOT_LOADED);

  useEffect(() => {
    let alive = true;
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}`)
      .then(res => (res.ok ? res.json() : res.status === 404 ? { deleted: true } : {}))
      .then(data => alive && setReader((Array.isArray(data) ? data[0] : data) || {}))
      .catch(err => {
        // RedirectOnSessionEnd is already redirecting to the login page.
        if (isSessionExpiredError(err) || !alive) return;
        setReader({});
      });
    return () => {
      alive = false;
    };
  }, [id, setReader]);

  return [reader, setReader];
}
