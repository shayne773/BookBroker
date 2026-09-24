import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from '../auth';
import { DEFAULT_DISTANCE, DISTANCE_CHOICES, normalizeZip, ZIP_FORMAT_MESSAGE } from '../distance';

// Where the reader trades: their ZIP code and how far they will go for a book.
// Books beyond the distance are hidden from them everywhere but a direct link.
// The prompts shown to a reader without a ZIP link here (/profile#location),
// so the section scrolls into view when the address asks for it.
const LocationSettings = ({ user, onSaved }) => {
  const [zip, setZip] = useState('');
  // The distance as chosen here, once the reader has changed it.
  const [distance, setDistance] = useState(null);
  const current = distance ?? user?.maxDistanceMiles ?? DEFAULT_DISTANCE;
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const section = useRef(null);
  const { hash } = useLocation();

  const loaded = Boolean(user?._id);
  useEffect(() => {
    if (loaded && hash === '#location') section.current?.scrollIntoView();
  }, [loaded, hash]);

  const save = async (e) => {
    e.preventDefault();
    setNotice(null);

    const update = { maxDistanceMiles: current };
    if (zip.trim()) {
      const normalized = normalizeZip(zip);
      if (!normalized) {
        setNotice({ error: true, message: ZIP_FORMAT_MESSAGE });
        return;
      }
      update.zip = normalized;
    }

    setSaving(true);
    try {
      const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: update }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ error: true, message: data.message || 'Your location could not be saved.' });
        return;
      }
      setZip('');
      setDistance(null);
      setNotice({ error: false, message: 'Saved.' });
      onSaved?.();
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      console.error('Failed to save location:', err);
      setNotice({ error: true, message: 'Your location could not be saved. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="section" id="location" ref={section}>
      <div className="section-head">
        <h2 className="section-title">Where you trade</h2>
      </div>

      {loaded && !user.zip && (
        <p className="notice mb-4" role="status">
          Add your ZIP code to see the books near you, with how far away each one is. Until then
          you are seeing every book.
        </p>
      )}

      {loaded && user.zip && (
        <p className="hint mb-4">
          {user.location} ({user.zip}). Other readers see your town, never your ZIP code.
        </p>
      )}

      <form className="form" onSubmit={save}>
        <div className="form__row">
          <label className="field">
            <span className="field__label">{user?.zip ? 'New ZIP code' : 'ZIP code'}</span>
            <input
              className="input"
              type="text"
              name="zip"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={10}
              placeholder={user?.zip || '11201'}
              value={zip}
              onChange={(e) => setZip(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">Show books within</span>
            <select
              className="input"
              name="maxDistanceMiles"
              value={current}
              onChange={(e) => setDistance(Number(e.target.value))}
            >
              {DISTANCE_CHOICES.map((miles) => (
                <option key={miles} value={miles}>
                  {miles} miles
                </option>
              ))}
            </select>
          </label>
        </div>

        {notice && (
          <p
            className={notice.error ? 'notice notice--error' : 'hint'}
            role={notice.error ? 'alert' : 'status'}
          >
            {notice.message}
          </p>
        )}

        <div className="button-row">
          <button type="submit" className="button button--secondary" disabled={saving || !loaded}>
            Save
          </button>
        </div>
      </form>
    </section>
  );
};

export default LocationSettings;
