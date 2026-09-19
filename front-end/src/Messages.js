import "./Messages.css";
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

        const res = await authFetch(`${process.env.REACT_APP_SERVER_ADDRESS}/messages`);

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
    <main className="MessagesPage">
      <div className="MessagesHeader">
        <div className="titlebox">
          <h1 className="title">Messages</h1>
        </div>

        <div className="MessagesSearchRow">
          <input
            className="MessagesSearch"
            placeholder="Search by username…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {loading && (
        <div className="MessagesState">
          <p className="MessagesStateTitle">Loading…</p>
          <p className="MessagesStateSub">Fetching your conversations.</p>
        </div>
      )}

      {!loading && error && (
        <div className="MessagesState">
          <p className="MessagesStateTitle">{error}</p>
          <button className="MessagesBtn" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="MessagesState">
          <p className="MessagesStateTitle">No conversations found.</p>
          <p className="MessagesStateSub">Start a chat by messaging someone from a book page.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className="MessagesList">
          {filtered.map((c) => {
            const u = c.otherUser || {};
            const initials = (u.username || "?").slice(0, 1).toUpperCase();

            return (
              <li key={c.id} className="MessagesCard">
                <Link to={`/messages/${u.id}`} className="MessagesLink">
                  <div className="MessagesAvatar">{initials}</div>

                  <div className="MessagesInfo">
                    <div className="MessagesTopRow">
                      <div className="MessagesName">{u.username || "Unknown"}</div>
                      <div className="MessagesMeta">
                        {u.location ? u.location : "—"} · ⭐ {u.ratings ?? 0}
                      </div>
                    </div>

                    <div className="MessagesPreview">
                    {c.lastMessage || "Tap to open chat"}
                    </div>

                  </div>

                  <div className="MessagesChevron">›</div>
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
