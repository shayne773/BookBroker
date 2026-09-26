import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { authFetch, isSessionExpiredError } from "./auth";
import { readerMeta } from "./rating";
import ExchangeProgress from "./ExchangeDetail/ExchangeProgress";
import ExchangeBooks from "./ExchangeDetail/ExchangeBooks";
import { CompletionPanel, RatingPanel } from "./ExchangeDetail/ExchangeWrapUp";
import CounterOfferDialog from "./ExchangeDetail/CounterOfferDialog";

export default function ExchangeDetail() {
  const { exchangeId } = useParams();

  const userId = localStorage.getItem("userId");
  const server = import.meta.env.VITE_SERVER_ADDRESS;

  const [ex, setEx] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  // counter modal state
  const [showCounter, setShowCounter] = useState(false);
  const [counterError, setCounterError] = useState("");
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

  function openCounter() {
    setCounterError("");
    setShowCounter(true);
  }

  async function onSubmitCounter({ requesterBooks, responderBooks, message }) {
    try {
      setActionBusy(true);
      setCounterError("");
      await post(`/exchanges/${exchangeId}/counter`, {
        requesterBooks,
        responderBooks,
        message,
      });
      popToast("Counter sent");
      setShowCounter(false);
      await refresh();
    } catch (e) {
      if (isSessionExpiredError(e)) return;
      console.error(e);
      setCounterError(e.message);
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

  if (loading || err || !ex) {
    return (
      <main className="page page--reading">
        <BackLink />
        <div className="page-head">
          <div className="page-head__main">
            <h1 className="page-title">Exchange</h1>
          </div>
        </div>
        {loading ? (
          <p className="empty" role="status">Loading…</p>
        ) : (
          <div className="section">
            <p className="notice notice--error" role="alert">{err || "Not found"}</p>
          </div>
        )}
      </main>
    );
  }

  const canRespond = ["PENDING", "COUNTERED"].includes(ex.status);
  // Only the side that received the offer on the table may accept it. Older
  // exchanges carry no proposedBy; a pending one was proposed by the requester.
  const proposer = ex.proposedBy ?? (ex.status === "PENDING" ? ex.requester?._id : null);
  const canAccept = canRespond && String(proposer) !== String(userId);
  const canDecline = canRespond;
  const canComplete = ex.status === "ACCEPTED";
  // Either side can cancel an offer, or back out of an accepted trade until the
  // other side confirms it complete, which releases both sides' books.
  const otherConfirmed = meIsRequester ? ex.responderConfirmedComplete : ex.requesterConfirmedComplete;
  const myConfirmed = meIsRequester ? ex.requesterConfirmedComplete : ex.responderConfirmedComplete;
  const canCancel = canRespond || (canComplete && !otherConfirmed);

  return (
    <main className="page page--reading">
      {toast && <div className="toast" role="status">{toast}</div>}

      <BackLink />

      <div className="page-head">
        <div className="page-head__main">
          <p className="kicker">Exchange with</p>
          <h1 className="page-title">{otherUser?.username || "Unknown"}</h1>
          {readerMeta(otherUser) && <p className="page-lede">{readerMeta(otherUser)}</p>}
        </div>
        <div className="page-head__aside">
          <Link className="button button--secondary button--small" to={`/messages/${otherUser?._id}`}>
            Chat
          </Link>
        </div>
      </div>

      <ExchangeProgress ex={ex} />

      <ExchangeBooks ex={ex} />

      {(canRespond || canComplete) && (
        <section className="section">
          <div className="button-row">
            {canAccept && (
              <button disabled={actionBusy} className="button button--primary" onClick={onAccept}>
                Accept
              </button>
            )}

            {canRespond && (
              <button disabled={actionBusy} className="button button--secondary" onClick={openCounter}>
                Counter
              </button>
            )}

            {canDecline && (
              <button disabled={actionBusy} className="button button--secondary" onClick={onDecline}>
                Decline
              </button>
            )}

            {canCancel && (
              <button disabled={actionBusy} className="button button--quiet" onClick={onCancel}>
                Cancel
              </button>
            )}

            {canComplete && (
              <button disabled={actionBusy} className="button button--primary" onClick={onConfirmComplete}>
                Confirm Completed
              </button>
            )}
          </div>
        </section>
      )}

      {ex.status === "ACCEPTED" && <CompletionPanel ex={ex} confirmedByMe={!!myConfirmed} />}

      {ex.status === "COMPLETED" && (
        <RatingPanel
          otherName={otherUser?.username}
          ratedAlready={myRatedAlready}
          rating={rating}
          setRating={setRating}
          busy={actionBusy}
          onRate={onRate}
        />
      )}

      {showCounter && (
        <CounterOfferDialog
          ex={ex}
          meIsRequester={meIsRequester}
          otherUser={otherUser}
          busy={actionBusy}
          error={counterError}
          onClose={() => setShowCounter(false)}
          onSubmit={onSubmitCounter}
        />
      )}
    </main>
  );
}

function BackLink() {
  const navigate = useNavigate();
  return (
    <button type="button" className="back-link" onClick={() => navigate(-1)}>
      <span className="back-link__mark" aria-hidden="true">&larr;</span>
      Back
    </button>
  );
}
