import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from '../auth';
import { setBlocked } from '../blocks';

const formatDay = (d) =>
  new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

// The readers you have blocked, each with a way to unblock them.
const BlockedReaders = () => {
  const [blocked, setBlockedReaders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/blocks`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => setBlockedReaders(Array.isArray(data) ? data : []))
      .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;
        console.error('Failed to fetch blocked readers:', err);
        setError('Your blocked readers could not be loaded.');
      })
      .finally(() => setLoaded(true));
  }, []);

  const unblock = async (reader) => {
    setError('');
    try {
      await setBlocked(reader._id, false);
      setBlockedReaders(prev => prev.filter(r => r._id !== reader._id));
    } catch (err) {
      if (isSessionExpiredError(err)) return;
      setError(err.message);
    }
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Blocked readers</h2>
        {blocked.length > 0 && <span className="section-count">{blocked.length}</span>}
      </div>

      {error && <p className="notice notice--error mb-4" role="alert">{error}</p>}

      {loaded && !error && blocked.length === 0 && (
        <p className="hint">You haven&rsquo;t blocked anyone.</p>
      )}

      {blocked.length > 0 && (
        <ul className="list">
          {blocked.map(reader => (
            <li key={reader._id} className="list-row">
              <span className="avatar" aria-hidden="true">
                {(reader.username || '?').slice(0, 1)}
              </span>

              <div className="list-row__body">
                <h3 className="list-row__title">
                  <Link to={`/users/${reader._id}`} className="headline-link">{reader.username}</Link>
                </h3>
                <p className="list-row__meta">Blocked {formatDay(reader.blockedAt)}</p>
              </div>

              <div className="list-row__trail">
                <button
                  type="button"
                  className="button button--secondary button--small"
                  onClick={() => unblock(reader)}
                >
                  Unblock
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default BlockedReaders;
