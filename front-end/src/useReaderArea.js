import { useEffect, useState } from 'react';
import { authFetch, isSessionExpiredError } from './auth';

// The signed-in reader's own area, for LocationPrompt: `{ place, miles }`, null
// when they have no ZIP code, undefined while it loads or when it could not be.
export const areaOf = (user) =>
  user?.zip ? { place: user.location, miles: user.maxDistanceMiles } : null;

const useReaderArea = () => {
  const [area, setArea] = useState(undefined);

  useEffect(() => {
    let live = true;
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((user) => live && setArea(areaOf(user)))
      .catch((err) => {
        if (isSessionExpiredError(err)) return;
        console.error('Failed to fetch your location:', err);
      });
    return () => {
      live = false;
    };
  }, []);

  return area;
};

export default useReaderArea;
