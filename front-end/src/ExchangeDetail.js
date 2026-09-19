import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import "./ExchangeDetail.css";
import { authFetch, isSessionExpiredError } from "./auth";
import { FaAngleLeft } from "react-icons/fa";

const STATUSES = ["PENDING", "COUNTERED", "ACCEPTED", "COMPLETED"];

function statusIndex(s) {
  const i = STATUSES.indexOf(s);
  return i === -1 ? 0 : i;
}

function coverOf(book) {
  return book?.cover || "/default-book.png";
}

export default function ExchangeDetail() {
  const { exchangeId } = useParams();
  const navigate = useNavigate();

  const userId = localStorage.getItem("userId");
  const server = process.env.REACT_APP_SERVER_ADDRESS;

  const [ex, setEx] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  // counter modal state
  const [showCounter, setShowCounter] = useState(false);
  const [reqSelected, setReqSelected] = useState(new Set());
  const [resSelected, setResSelected] = useState(new Set());
  const [counterMsg, setCounterMsg] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  // rating state
  const [rating, setRating] = useState(5);
  const [toast, setToast] = useState("");

  const meIsRequester = useMemo(() => {
    if (!ex?.requester?._id) return false;
    return String(ex.requester._id) === String(userId);
  }, [ex, userId]);

  const otherUser = useMemo(() => {
    if (!ex) return null;
    return meIsRequester ? ex.responder : ex.requester;
  }, [ex, meIsRequester]);

  // load exchange
  useEffect(() => {
    let alive = true;
    async function run() {
      setLoading(true);
      setErr("");
      try {
        const res = await authFetch(`${server}/exchanges/${exchangeId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (alive) setEx(data);
      } catch (e) {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(e)) return;

        console.error(e);
        if (alive) setErr("Failed to load exchange.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    run();
    return () => (alive = false);
  }, [server, exchangeId]);

  function popToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 1800);
  }

  async function post(path, body) {
    const res = await authFetch(`${server}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : "{}",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  }

  async function refresh() {
    const res = await authFetch(`${server}/exchanges/${exchangeId}`);
    const data = await res.json();
    setEx(data);
  }

  async function onAccept() {
    try {
      setActionBusy(true);
      await post(`/exchanges/${exchangeId}/accept`);
      popToast("Accepted!");
      await refresh();
    } catch (e) {
      console.error(e);
      popToast(e.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function onDecline() {
    try {
      setActionBusy(true);
      await post(`/exchanges/${exchangeId}/decline`);
      popToast("Declined");
      await refresh();
    } catch (e) {
      console.error(e);
      popToast(e.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function onCancel() {
    try {
      setActionBusy(true);
      await post(`/exchanges/${exchangeId}/cancel`);
      popToast("Cancelled");
      await refresh();
    } catch (e) {
      console.error(e);
      popToast(e.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function onConfirmComplete() {
    try {
      setActionBusy(true);
      await post(`/exchanges/${exchangeId}/confirm-complete`);
      popToast("Marked complete");
      await refresh();
    } catch (e) {
      console.error(e);
      popToast(e.message);
    } finally {
      setActionBusy(false);
    }
  }

  async function onSubmitCounter() {
    try {
      setActionBusy(true);
      const requesterBooks = Array.from(reqSelected);
      const responderBooks = Array.from(resSelected);
      await post(`/exchanges/${exchangeId}/counter`, {
        requesterBooks,
        responderBooks,
        message: counterMsg,
      });
      popToast("Counter sent");
      setShowCounter(false);
      await refresh();
    } catch (e) {
      console.error(e);
      popToast(e.message);
    } finally {
      setActionBusy(false);
    }
  }

  const myRatedAlready = useMemo(() => {
    if (!ex) return false;
    if (String(ex.requester?._id) === String(userId)) return !!ex.requesterRating;
    return !!ex.responderRating;
  }, [ex, userId]);

  async function onRate() {
    try {
      setActionBusy(true);
      await post(`/exchanges/${exchangeId}/rate`, { rating });
      popToast("Rating saved");
      await refresh();
    } catch (e) {
      console.error(e);
      popToast(e.message);
    } finally {
      setActionBusy(false);
    }
  }

  // initialize counter selections when opening modal
  useEffect(() => {
    if (!showCounter || !ex) return;
    setReqSelected(new Set((ex.requesterBooks || []).map((b) => b._id)));
    setResSelected(new Set((ex.responderBooks || []).map((b) => b._id)));
    setCounterMsg(ex.message || "");
  }, [showCounter, ex]);

  // for counter UI: we need both users' offered lists
  const [myOffered, setMyOffered] = useState([]);
  const [theirOffered, setTheirOffered] = useState([]);

  useEffect(() => {
    if (!showCounter || !ex) return;

    const meId = userId;
    const otherId = otherUser?._id;

    async function loadLists() {
      try {
        const [mineRes, theirsRes] = await Promise.all([
          authFetch(`${server}/users/${meId}/offered`),
          authFetch(`${server}/users/${otherId}/offered`),
        ]);
        const mine = await mineRes.json();
        const theirs = await theirsRes.json();
        setMyOffered(Array.isArray(mine) ? mine : []);
        setTheirOffered(Array.isArray(theirs) ? theirs : []);
      } catch (e) {
        console.error(e);
        setMyOffered([]);
        setTheirOffered([]);
      }
    }
    loadLists();
  }, [showCounter, ex, server, userId, otherUser]);

  if (loading) {
    return (
      <main className="ExchangeDetailPage">
        <div className="exd-header">
          <button className="iconButton backButton" onClick={() => navigate(-1)}>
            <FaAngleLeft />
          </button>
          <h1 className="exd-title">Exchange</h1>
        </div>
        <div className="exd-loading">Loading…</div>
      </main>
    );
  }

  if (err || !ex) {
    return (
      <main className="ExchangeDetailPage">
        <div className="exd-header">
          <button className="iconButton backButton" onClick={() => navigate(-1)}>
            <FaAngleLeft />
          </button>
          <h1 className="exd-title">Exchange</h1>
        </div>
        <div className="exd-error">{err || "Not found"}</div>
      </main>
    );
  }

  const canRespond = ["PENDING", "COUNTERED"].includes(ex.status);
  const canAccept = canRespond;
  const canDecline = canRespond;
  const canCancel = canRespond; // both can cancel for now; you can restrict to requester only
  const canComplete = ex.status === "ACCEPTED";
  const canRate = ex.status === "COMPLETED" && !myRatedAlready;

  const stepsDone = statusIndex(ex.status);

  return (
    <main className="ExchangeDetailPage">
      {toast && <div className="exd-toast">{toast}</div>}

      <div className="exd-header">
        <button className="iconButton backButton" onClick={() => navigate(-1)}>
          <FaAngleLeft />
        </button>
        <div className="exd-header-text">
          <div className="exd-title">Exchange</div>
          <div className="exd-subtitle">
            with <span className="exd-strong">{otherUser?.username || "Unknown"}</span>
          </div>
        </div>
        <Link className="exd-mini-link" to={`/messages/${otherUser?._id}`}>Chat</Link>
      </div>

      {/* Timeline */}
      <section className="exd-card">
        <div className="exd-card-title">Status</div>

        <div className="exd-timeline">
          {STATUSES.map((s, i) => (
            <div key={s} className={`exd-step ${i <= stepsDone ? "on" : ""}`}>
              <div className="dot" />
              <div className="label">{s}</div>
            </div>
          ))}
        </div>

        <div className="exd-status-row">
          <span className={`pill ${ex.status}`}>{ex.status}</span>
          <span className="muted">Updated {new Date(ex.updatedAt).toLocaleString()}</span>
        </div>

        {!!ex.message && <div className="exd-message">“{ex.message}”</div>}
      </section>

      {/* Books */}
      <section className="exd-card">
        <div className="exd-card-title">Books</div>

        <div className="exd-twoCols">
          <div className="exd-col">
            <div className="exd-col-head">
              <span className="exd-strong">{ex.requester?.username || "Requester"}</span>
              <span className="muted">gives</span>
            </div>
            <BookStrip books={ex.requesterBooks || []} />
          </div>

          <div className="exd-col">
            <div className="exd-col-head">
              <span className="exd-strong">{ex.responder?.username || "Responder"}</span>
              <span className="muted">gives</span>
            </div>
            <BookStrip books={ex.responderBooks || []} />
          </div>
        </div>

        <div className="exd-help muted">
          Tip: If you want to change the book(s), hit <b>Counter</b>.
        </div>
      </section>

      {/* Actions */}
      <section className="exd-actions">
        {canAccept && (
          <button disabled={actionBusy} className="btn primary" onClick={onAccept}>
            Accept
          </button>
        )}

        {canRespond && (
          <button disabled={actionBusy} className="btn" onClick={() => setShowCounter(true)}>
            Counter
          </button>
        )}

        {canDecline && (
          <button disabled={actionBusy} className="btn danger" onClick={onDecline}>
            Decline
          </button>
        )}

        {canCancel && (
          <button disabled={actionBusy} className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}

        {canComplete && (
          <button disabled={actionBusy} className="btn primary" onClick={onConfirmComplete}>
            Confirm Completed
          </button>
        )}
      </section>

      {/* Completion state */}
      {ex.status === "ACCEPTED" && (
        <section className="exd-card">
          <div className="exd-card-title">Completion</div>
          <div className="exd-complete-grid">
            <CompletionRow
              label={ex.requester?.username || "Requester"}
              done={!!ex.requesterConfirmedComplete}
            />
            <CompletionRow
              label={ex.responder?.username || "Responder"}
              done={!!ex.responderConfirmedComplete}
            />
          </div>
          <div className="muted exd-help">
            Both users must confirm to mark the trade complete and remove books from listings.
          </div>
        </section>
      )}

      {/* Rating */}
      {ex.status === "COMPLETED" && (
        <section className="exd-card">
          <div className="exd-card-title">Rate {otherUser?.username || "User"}</div>

          {myRatedAlready ? (
            <div className="exd-rated">
              <span className="pill done">Already rated</span>
              <span className="muted">Thanks for helping keep BookBroker safe.</span>
            </div>
          ) : (
            <div className="exd-rate">
              <div className="exd-rate-row">
                <StarPicker value={rating} onChange={setRating} />
                <button disabled={actionBusy} className="btn primary" onClick={onRate}>
                  Submit Rating
                </button>
              </div>
              <div className="muted">Only rate after you’ve completed the exchange.</div>
            </div>
          )}
        </section>
      )}

      {/* Counter Modal */}
      {showCounter && (
        <div className="exd-modalOverlay" onClick={() => setShowCounter(false)}>
          <div className="exd-modalSheet" onClick={(e) => e.stopPropagation()}>
            <div className="exd-modalTitle">Counter Offer</div>

            <div className="exd-modalCols">
              <div className="exd-modalCol">
                <div className="exd-modalColTitle">Your offered books</div>
                <SelectableGrid
                  books={myOffered}
                  selected={reqSelected}
                  setSelected={setReqSelected}
                  // IMPORTANT: requesterBooks must be requester’s books
                  forceRequesterSide={meIsRequester}
                />
              </div>

              <div className="exd-modalCol">
                <div className="exd-modalColTitle">{otherUser?.username || "Their"} offered books</div>
                <SelectableGrid
                  books={theirOffered}
                  selected={resSelected}
                  setSelected={setResSelected}
                  // IMPORTANT: responderBooks must be responder’s books
                  forceRequesterSide={!meIsRequester}
                />
              </div>
            </div>

            <textarea
              className="exd-textarea"
              value={counterMsg}
              onChange={(e) => setCounterMsg(e.target.value)}
              placeholder="Optional message..."
            />

            <div className="exd-modalActions">
              <button className="btn ghost" disabled={actionBusy} onClick={() => setShowCounter(false)}>
                Close
              </button>
              <button className="btn primary" disabled={actionBusy} onClick={onSubmitCounter}>
                Send Counter
              </button>
            </div>

            <div className="muted exd-help">
              Note: We only allow selecting books that are currently offered (unlocked).
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function BookStrip({ books }) {
  if (!books.length) return <div className="muted">No books selected.</div>;
  return (
    <div className="exd-strip">
      {books.map((b) => (
        <Link key={b._id} to={`/books/${b._id}`} className="exd-book">
          <div className="exd-cover" style={{ backgroundImage: `url(${coverOf(b)})` }} />
          <div className="exd-bookTitle">{b.title || "Untitled"}</div>
        </Link>
      ))}
    </div>
  );
}

function CompletionRow({ label, done }) {
  return (
    <div className="exd-complete-row">
      <div className="exd-strong">{label}</div>
      <div className={`pill ${done ? "done" : "muted"}`}>{done ? "Confirmed" : "Waiting"}</div>
    </div>
  );
}

function StarPicker({ value, onChange }) {
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star ${n <= value ? "on" : ""}`}
          onClick={() => onChange(n)}
          aria-label={`${n} star`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

/**
 * SelectableGrid needs to map "my books" -> correct side arrays:
 * - If I'm requester, my selection goes to requesterBooks
 * - If I'm responder, my selection goes to responderBooks
 *
 * To keep it simple, we pass `forceRequesterSide`:
 * - true means selection is requesterBooks
 * - false means selection is responderBooks
 *
 * In this component we only manage selected IDs; parent decides how to send.
 */
function SelectableGrid({ books, selected, setSelected }) {
  if (!books?.length) return <div className="muted">No offerings found.</div>;

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <div className="exd-grid">
      {books.map((b) => (
        <button
          key={b._id}
          type="button"
          className={`exd-pick ${selected.has(b._id) ? "picked" : ""}`}
          onClick={() => toggle(b._id)}
          title={b.title}
        >
          <div className="exd-pickCover" style={{ backgroundImage: `url(${coverOf(b)})` }} />
          <div className="exd-pickTitle">{b.title || "Untitled"}</div>
        </button>
      ))}
    </div>
  );
}
