import { useEffect, useState } from 'react';

// Long enough for the last staggered item to finish (components.css, Appear).
const SETTLE_MS = 1000;

// The one way fetched content comes onto a screen. Until `ready` it shows
// `placeholder`, which holds the content's space; then the content fades in.
// When the reader watched it load, the books in it also rise in one after
// another; content that was ready from the start (remember.js) only fades.
// Once settled, anything added later (a next page, a new book) just appears,
// until the content is waited for again (a new search).
const Appear = ({ ready, placeholder = null, className, children }) => {
  const [waited, setWaited] = useState(!ready);
  const [settled, setSettled] = useState(false);

  // Waiting again arms the entry again.
  if (!ready && (!waited || settled)) {
    setWaited(true);
    setSettled(false);
  }

  useEffect(() => {
    if (!ready || !waited) return undefined;
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [ready, waited]);

  if (!ready) return placeholder;

  const classes = ['appear', waited && !settled && 'appear--enter', className].filter(Boolean).join(' ');
  return <div className={classes}>{typeof children === 'function' ? children() : children}</div>;
};

export default Appear;
