import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// How long a success stays up. A failure stays until the next attempt.
const DONE_FOR = 5000;

// State for one <Feedback> line (Feedback.jsx): `done(message)` for a success,
// `fail(message)` for a failure, `clear()` to empty it.
export default function useFeedback() {
  const [feedback, setFeedback] = useState(null); // { message, tone, key }
  const timer = useRef(null);
  const count = useRef(0);

  const show = useCallback((message, tone) => {
    clearTimeout(timer.current);
    count.current += 1;
    setFeedback(message ? { message, tone, key: count.current } : null);
    if (message && tone === 'done') timer.current = setTimeout(() => setFeedback(null), DONE_FOR);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const actions = useMemo(
    () => ({
      done: (message) => show(message, 'done'),
      fail: (message) => show(message, 'error'),
      clear: () => show(null),
    }),
    [show]
  );

  return { feedback, ...actions };
}
