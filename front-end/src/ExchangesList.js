import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "./ExchangesList.css";
import { authFetch, isSessionExpiredError } from "./auth";

function formatWhen(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(s) {
  const map = {
    DRAFT: "Draft",
    PENDING: "Pending",
    COUNTERED: "Countered",
    ACCEPTED: "Accepted",
    DECLINED: "Declined",
    CANCELLED: "Cancelled",
    COMPLETED: "Completed",
    EXPIRED: "Expired",
  };
  return map[s] || s;
}

function statusClass(s) {
  if (s === "ACCEPTED") return "ok";
  if (s === "PENDING" || s === "COUNTERED") return "warn";
  if (s === "COMPLETED") return "done";
  return "muted";
}

export default function ExchangesList() {
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const userId = localStorage.getItem("userId");
  const server = process.env.REACT_APP_SERVER_ADDRESS;

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

  function coverOf(book) {
    return book?.cover || "/default-book.png";
  }

  return (
    <main className="ExchangesPage">
      <div className="titlebox">
            <h1 className="title">Exchanges</h1>
      </div>
      <div className="ex-subtitle">Track offers, confirm trades, and rate users.</div>

      {loading && <div className="ex-loading">Loading…</div>}
      {!!err && <div className="ex-error">{err}</div>}

      {!loading && !items.length && !err && (
        <div className="ex-empty">
          <p>No exchanges yet.</p>
          <p className="muted">You’ll see them here after you propose a trade.</p>
        </div>
      )}

      {!!active.length && (
        <section className="ex-section">
          <h3 className="ex-section-title">Active</h3>
          <div className="ex-grid">
            {active.map((ex) => {
              const ou = otherUser(ex);
              const thumbs = [
                ...(ex.requesterBooks || []),
                ...(ex.responderBooks || []),
              ].slice(0, 6);

              return (
                <Link key={ex._id} to={`/exchanges/${ex._id}`} className="ex-card">
                  <div className="ex-card-top">
                    <div className="ex-user">
                      <div className="ex-user-name">{ou?.username || "Unknown"}</div>
                      <div className="ex-user-meta">
                        {ou?.location ? ou.location : "No location"} ·{" "}
                        {ou?.ratingsAvg ? ou.ratingsAvg.toFixed(1) : (ou?.ratings ?? 0)}
                      </div>
                    </div>

                    <div className={`ex-status ${statusClass(ex.status)}`}>
                      {statusLabel(ex.status)}
                    </div>
                  </div>

                  <div className="ex-thumbs">
                    {thumbs.map((b) => (
                      <div
                        key={b._id}
                        className="ex-thumb"
                        style={{ backgroundImage: `url(${coverOf(b)})` }}
                      />
                    ))}
                    {thumbs.length === 0 && <div className="ex-thumbs-empty">No books selected</div>}
                  </div>

                  <div className="ex-card-bottom">
                    <div className="ex-updated">Updated {formatWhen(ex.updatedAt)}</div>
                    <div className="ex-cta">View / Respond →</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {!!completed.length && (
        <section className="ex-section">
          <h3 className="ex-section-title">Completed</h3>
          <div className="ex-grid">
            {completed.map((ex) => {
              const ou = otherUser(ex);
              const thumbs = [
                ...(ex.requesterBooks || []),
                ...(ex.responderBooks || []),
              ].slice(0, 6);

              return (
                <Link key={ex._id} to={`/exchanges/${ex._id}`} className="ex-card">
                  <div className="ex-card-top">
                    <div className="ex-user">
                      <div className="ex-user-name">{ou?.username || "Unknown"}</div>
                      <div className="ex-user-meta">
                        {ou?.location ? ou.location : "No location"} ·{" "}
                        {ou?.ratingsAvg ? ou.ratingsAvg.toFixed(1) : (ou?.ratings ?? 0)}
                      </div>
                    </div>

                    <div className="ex-status done">Completed</div>
                  </div>

                  <div className="ex-thumbs">
                    {thumbs.map((b) => (
                      <div
                        key={b._id}
                        className="ex-thumb"
                        style={{ backgroundImage: `url(${coverOf(b)})` }}
                      />
                    ))}
                  </div>

                  <div className="ex-card-bottom">
                    <div className="ex-updated">Completed {formatWhen(ex.updatedAt)}</div>
                    <div className="ex-cta">View →</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
