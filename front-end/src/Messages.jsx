import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { authFetch, isSessionExpiredError } from "./auth";

const Messages = () => {
  const [convos, setConvos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError("");

        const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/messages`);

        const data = await res.json();

        // data is expected to be: [{ id, otherUser: { id, username, location, ratings } }, ...]
        setConvos(Array.isArray(data) ? data : []);
      } catch (err) {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.error("Failed to fetch conversations:", err);
        setError("Failed to load conversations.");
        setConvos([]);
      } finally {
        setLoading(false);
      }
    };

    run();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return convos;
    return convos.filter((c) => (c?.otherUser?.username || "").toLowerCase().includes(term));
  }, [convos, q]);

  return (
    <main className="page page--reading">
      <div className="page-head">
        <div className="page-head__main">
          <p className="kicker">Inbox</p>
          <h1 className="page-title">Messages</h1>
        </div>

        <div className="page-head__aside page-head__search">
          <label className="visually-hidden" htmlFor="messages-search">
            Search by username
          </label>
          <input
            id="messages-search"
            type="search"
            className="input"
            placeholder="Search by username…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {loading && (
        <div className="empty" role="status">
          <p>Loading…</p>
          <p>Fetching your conversations.</p>
        </div>
      )}

      {!loading && error && (
        <div className="section stack">
          <p className="notice notice--error" role="alert">{error}</p>
          <div>
            <button className="button button--secondary" onClick={() => window.location.reload()}>
              Retry
            </button>
          </div>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="empty">
          <p>No conversations found.</p>
          <p>Start a chat by messaging someone from a book page.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className="list section">
          {filtered.map((c) => {
            const u = c.otherUser || {};
            const initials = (u.username || "?").slice(0, 1).toUpperCase();

            return (
              <li key={c.id}>
                <Link to={`/messages/${u.id}`} className="list-row">
                  <span className="avatar" aria-hidden="true">{initials}</span>

                  <div className="list-row__body">
                    <h2 className="list-row__title">{u.username || "Unknown"}</h2>
                    <p className="list-row__meta">
                      {u.location ? u.location : "—"} · Rated {u.ratings ?? 0}
                    </p>
                    <p className="list-row__excerpt">{c.lastMessage || "Tap to open chat"}</p>
                  </div>

                  <div className="list-row__trail">
                    <span className="textlink-arrow__mark" aria-hidden="true">&rarr;</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
};

export default Messages;
