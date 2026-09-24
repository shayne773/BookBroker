import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from '../auth';

const CATEGORIES = [
  ['messages', 'New messages', 'When a reader messages you. One email per conversation until you read it, and none while you have read it in the last 15 minutes.'],
  ['trades', 'Trades', 'When a reader proposes, counters, accepts, declines, cancels or completes a trade with you.'],
  ['wishlist', 'Wishlist matches', 'When another reader offers a book on your wishlist. At most one email per book every 30 days.'],
];

// Which notification emails the reader gets, one switch per category. Every
// email links here (/profile#notifications), so the section scrolls into view
// when the address asks for it.
const NotificationSettings = ({ settings }) => {
  // The settings as last saved here, once the reader has changed one; until
  // then, as the profile loaded them.
  const [saved, setSaved] = useState(null);
  const current = saved ?? settings;
  const [error, setError] = useState('');
  const section = useRef(null);
  const { hash } = useLocation();

  const loaded = Boolean(current);
  useEffect(() => {
    if (loaded && hash === '#notifications') section.current?.scrollIntoView();
  }, [loaded, hash]);

  // Each switch saves on its own, so a reply or a rollback touches only its own
  // category and never undoes another switch flipped meanwhile.
  const setCategory = (category, on) =>
    setSaved((s) => ({ ...(s ?? settings), [category]: on }));

  const toggle = async (category, on) => {
    setError('');
    setCategory(category, on);
    try {
      const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [category]: on }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCategory(category, data.notifications[category]);
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      console.error('Failed to save notification setting:', err);
      setCategory(category, !on);
      setError('Your setting could not be saved. Please try again.');
    }
  };

  return (
    <section className="section" id="notifications" ref={section}>
      <div className="section-head">
        <h2 className="section-title">Email notifications</h2>
      </div>

      {error && <p className="notice notice--error mb-4" role="alert">{error}</p>}

      {current && (
        <fieldset className="choices">
          <legend className="hint">Email me about:</legend>
          {CATEGORIES.map(([category, label, description]) => (
            <label key={category} className="choice">
              <input
                type="checkbox"
                checked={current[category]}
                onChange={(e) => toggle(category, e.target.checked)}
              />
              <span>
                {label}
                <span className="hint block">{description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
};

export default NotificationSettings;
