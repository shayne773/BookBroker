import { useCallback, useState } from 'react';

// What the pages have already loaded, by the request it answers, so a page the
// reader comes back to shows it at once instead of a placeholder. The page still
// asks again and takes the fresh answer. Kept in memory only: it goes with the
// tab, and with the session (auth.js forgets it on sign-in and sign-out).
const LIMIT = 60;
const store = new Map();

const recall = (key, initial) => (store.has(key) ? store.get(key) : initial);

const keep = (key, value) => {
  // Re-inserted, so the Map's order is least recently written first.
  store.delete(key);
  store.set(key, value);
  if (store.size > LIMIT) store.delete(store.keys().next().value);
};

export const forgetAll = () => store.clear();

// Another tab signing in or out changes whose data this is.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === null || event.key === 'token') forgetAll();
  });
}

// useState for something a page fetches: it starts from what was remembered
// under `key` (else `initial`, by convention null for "not loaded yet") and
// remembers every value set. When `key` changes it starts over from that key's
// value, and a late answer for the old key is filed under the old key.
export default function useRemembered(key, initial = null) {
  const [state, setState] = useState(() => ({ key, value: recall(key, initial) }));
  const value = state.key === key ? state.value : recall(key, initial);

  const set = useCallback(
    (next) =>
      setState((prev) => {
        const current = prev.key === key ? prev.value : recall(key, initial);
        const resolved = typeof next === 'function' ? next(current) : next;
        keep(key, resolved);
        return { key, value: resolved };
      }),
    // `initial` is a constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  );

  return [value, set];
}
