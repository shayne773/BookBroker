import { useEffect, useState } from 'react';
import { authFetch, isSessionExpiredError } from '../auth';

// The caller's wishlisted books that other readers are offering now: one entry
// per wishlist book, { wishlistBook, offers: [{ _id, title, cover, owner }] }.
// `loaded` turns true once the answer (or a failure) is in.
const useWishlistMatches = () => {
  const [matches, setMatches] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/wishlist/matches`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (alive) setMatches(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.error('Failed to fetch wishlist matches:', err);
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });

    return () => {
      alive = false;
    };
  }, []);

  return { matches, loaded, error };
};

export default useWishlistMatches;
