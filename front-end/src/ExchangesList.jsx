import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import BookCover from "./BookCover";
import { statusClass, statusLabel } from "./exchangeStatus";
import { authFetch, isSessionExpiredError } from "./auth";
import { readerMeta } from "./rating";
import UserLink from "./UserLink";

function formatWhen(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function ExchangesList() {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const userId = localStorage.getItem("userId");
  const server = import.meta.env.VITE_SERVER_ADDRESS;

  useEffect(() => {
    let alive = true;
    async function run() {
      setLoading(true);
      setErr("");
      try {
        const res = await authFetch(`${server}/exchanges`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (alive) setItems(Array.isArray(data) ? data : []);
      } catch (e) {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(e)) return;

        if (alive) {
          setItems([]);
          setErr("Failed to load exchanges.");
          console.error(e);
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    run();
    return () => (alive = false);
  }, [server]);

  const { active, completed } = useMemo(() => {
    const activeStatuses = new Set(["PENDING", "COUNTERED", "ACCEPTED", "DRAFT"]);
    const doneStatuses = new Set(["COMPLETED"]);
    const a = [];
    const c = [];
    for (const ex of items) {
      if (doneStatuses.has(ex.status)) c.push(ex);
      else if (activeStatuses.has(ex.status)) a.push(ex);
      else a.push(ex); // show declined/cancelled/expired under active section too; you can change
    }
    return { active: a, completed: c };
  }, [items]);

  function otherUser(ex) {
    if (!ex?.requester || !ex?.responder) return null;
    return String(ex.requester?._id) === String(userId) ? ex.responder : ex.requester;
  }

  return (
    <main className="page page--reading">
      <div className="page-head">
        <div className="page-head__main">
          <p className="kicker">Your trades</p>
          <h1 className="page-title">Exchanges</h1>
          <p className="page-lede">Track offers, confirm trades, and rate users.</p>
        </div>
      </div>

      {loading && <p className="empty" role="status">Loading…</p>}
      {!!err && (
        <div className="section">
          <p className="notice notice--error" role="alert">{err}</p>
        </div>
      )}

      {!loading && !items.length && !err && (
        <div className="empty">
          <p>No exchanges yet.</p>
          <p>You’ll see them here after you propose a trade.</p>
        </div>
      )}

      {!!active.length && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Active</h2>
            <span className="section-count">{active.length}</span>
          </div>
          <ul className="list">
            {active.map((ex) => (
              <li key={ex._id}>
                <ExchangeRow ex={ex} other={otherUser(ex)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!completed.length && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Completed</h2>
            <span className="section-count">{completed.length}</span>
          </div>
          <ul className="list">
            {completed.map((ex) => (
              <li key={ex._id}>
                <ExchangeRow ex={ex} other={otherUser(ex)} completed />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

// One exchange: who it is with, the books on the table, and where it stands.
function ExchangeRow({ ex, other, completed = false }) {
  const thumbs = [
    ...(ex.requesterBooks || []),
    ...(ex.responderBooks || []),
  ].slice(0, 6);

  return (
    <div className="list-row has-stretch">
      <span className="avatar" aria-hidden="true">
        {(other?.username || "?").slice(0, 1)}
      </span>

      <div className="list-row__body">
        <h3 className="list-row__title">
          <UserLink user={other} />
        </h3>
        <p className="list-row__meta">{readerMeta(other, { noLocation: "No location" })}</p>

        <div className="cover-strip list-row__extra">
          {thumbs.map((b) => (
            <span key={b._id} className="cover">
              <BookCover src={b.cover} />
            </span>
          ))}
          {!completed && thumbs.length === 0 && <span className="hint">No books selected</span>}
        </div>
      </div>

      <div className="list-row__trail">
        <span className="list-row__status">
          <span className={completed ? "status status--done" : statusClass(ex.status)}>
            {completed ? "Completed" : statusLabel(ex.status)}
          </span>
          <span>
            {completed ? (ex.autoCompleted ? "Completed automatically" : "Completed") : "Updated"}{" "}
            {formatWhen(ex.updatedAt)}
          </span>
        </span>

        {/* The row's own link, stretched over it; the name above opens their profile. */}
        <Link to={`/exchanges/${ex._id}`} className="stretch-link">
          {completed ? "View" : "View / Respond"}
          <span className="visually-hidden"> exchange with {other?.username || "this reader"}</span>
          <span className="textlink-arrow__mark" aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </div>
  );
}
