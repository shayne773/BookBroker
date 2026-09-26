import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authFetch, isSessionExpiredError } from "../auth";
import PickableBook from "../PickableBook";

// Propose an exchange from a conversation, in two steps: one of your offered
// books, then one of theirs. Every opening starts fresh and reloads both shelves.
export default function ProposeTradeDialog({ otherUserId, otherUser, onClose }) {
  const navigate = useNavigate();
  const titleId = useId();
  const server = import.meta.env.VITE_SERVER_ADDRESS;

  const [tradeStep, setTradeStep] = useState(1); // 1 = pick my book, 2 = pick their book
  const [myOffered, setMyOffered] = useState([]);
  const [theirOffered, setTheirOffered] = useState([]);
  const [myPick, setMyPick] = useState(null);
  const [theirPick, setTheirPick] = useState(null);
  const [tradeMsg, setTradeMsg] = useState("");
  const [tradeLoading, setTradeLoading] = useState(true);
  const [tradeError, setTradeError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setTradeLoading(true);

        // my offered
        const resMine = await authFetch(`${server}/user/offered`);
        const mine = resMine.ok ? await resMine.json() : [];
        setMyOffered(Array.isArray(mine) ? mine : []);

        // their offered
        const resTheirs = await authFetch(`${server}/users/${otherUserId}/offered`);
        const theirs = resTheirs.ok ? await resTheirs.json() : [];
        setTheirOffered(Array.isArray(theirs) ? theirs : []);

        // helpful default message
        setTradeMsg(
          `Want to trade? I can offer one of my books for one of yours.`
        );
      } catch (err) {
        if (isSessionExpiredError(err)) return;

        console.error(err);
        setTradeError("Failed to load offered books.");
      } finally {
        setTradeLoading(false);
      }
    })();
  }, [server, otherUserId]);

  const submitTrade = async () => {
    setTradeError("");

    if (!myPick?._id) {
      setTradeError("Pick one of your offered books first.");
      setTradeStep(1);
      return;
    }
    if (!theirPick?._id) {
      setTradeError("Pick one of their offered books.");
      setTradeStep(2);
      return;
    }

    try {
      setTradeLoading(true);

      const res = await authFetch(`${server}/exchanges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responderId: otherUserId,
          requesterBooks: [myPick._id],
          responderBooks: [theirPick._id],
          message: tradeMsg.trim() || "",
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // A refusal the reader can act on, such as a block or the hourly proposal
        // limit, is shown as the API words it.
        if ((res.status === 403 || res.status === 429) && body.message) {
          setTradeError(body.message);
          return;
        }
        throw new Error(`Create exchange failed: ${res.status} ${body.message || ""}`);
      }

      const ex = await res.json();
      const exchangeId = ex._id; // ✅ your backend returns full exchange doc

      onClose();
      navigate(`/exchanges/${exchangeId}`);
    } catch (err) {
      if (isSessionExpiredError(err)) return;

      console.error(err);
      setTradeError("Failed to create exchange. Try again.");
    } finally {
      setTradeLoading(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-content dialog-content--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__head">
          <h2 className="dialog__title" id={titleId}>Propose an exchange</h2>
          {/* Focus moves into the dialog as it opens. */}
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Close" autoFocus>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {tradeLoading && <p className="hint" role="status">Loading offered books…</p>}
          {tradeError && <p className="notice notice--error" role="alert">{tradeError}</p>}

          {!tradeLoading && (
            <>
              <div className="segmented" role="group" aria-label="Step">
                <button
                  className={`segmented__option${tradeStep === 1 ? " is-active" : ""}`}
                  aria-pressed={tradeStep === 1}
                  onClick={() => setTradeStep(1)}
                  type="button"
                >
                  1) Your book
                </button>
                <button
                  className={`segmented__option${tradeStep === 2 ? " is-active" : ""}`}
                  aria-pressed={tradeStep === 2}
                  onClick={() => setTradeStep(2)}
                  type="button"
                >
                  2) Their book
                </button>
              </div>

              {tradeStep === 1 && (
                <>
                  <p className="fact__term">Pick one of your offered books</p>

                  {myOffered.length === 0 ? (
                    <p className="hint">
                      You don’t have any offered books yet. Add one in Profile → Offerings.
                    </p>
                  ) : (
                    <div className="pick-grid">
                      {myOffered.map((b) => (
                        <PickableBook
                          key={b._id}
                          book={b}
                          showAuthor
                          selected={myPick?._id === b._id}
                          onClick={() => setMyPick(b)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {tradeStep === 2 && (
                <>
                  <p className="fact__term">
                    Pick one of {otherUser?.username || "their"} offered books
                  </p>

                  {theirOffered.length === 0 ? (
                    <p className="hint">They don’t have any offered books right now.</p>
                  ) : (
                    <div className="pick-grid">
                      {theirOffered.map((b) => (
                        <PickableBook
                          key={b._id}
                          book={b}
                          showAuthor
                          selected={theirPick?._id === b._id}
                          onClick={() => setTheirPick(b)}
                        />
                      ))}
                    </div>
                  )}

                  <label className="field">
                    <span className="field__label">Message (optional)</span>
                    <textarea
                      className="input"
                      value={tradeMsg}
                      onChange={(e) => setTradeMsg(e.target.value)}
                      rows={3}
                      placeholder="Add a note…"
                    />
                  </label>
                </>
              )}
            </>
          )}
        </div>

        {!tradeLoading && (
          <div className="dialog__foot">
            {tradeStep === 1 ? (
              <button
                className="button button--primary"
                type="button"
                onClick={() => setTradeStep(2)}
                disabled={!myPick?._id}
              >
                Next
              </button>
            ) : (
              <>
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => setTradeStep(1)}
                >
                  Back
                </button>
                <button
                  className="button button--primary"
                  type="button"
                  onClick={submitTrade}
                  disabled={!myPick?._id || !theirPick?._id}
                >
                  Send Offer
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
