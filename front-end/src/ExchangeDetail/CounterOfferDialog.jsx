import { useEffect, useId, useState } from "react";
import { authFetch } from "../auth";
import PickableBook from "../PickableBook";

// Rework the books on both sides and send the offer back. Opens with the
// exchange's current books and message already chosen.
export default function CounterOfferDialog({ ex, meIsRequester, otherUser, busy, onClose, onSubmit }) {
  const titleId = useId();
  const userId = localStorage.getItem("userId");
  const server = import.meta.env.VITE_SERVER_ADDRESS;

  const [reqSelected, setReqSelected] = useState(new Set());
  const [resSelected, setResSelected] = useState(new Set());
  const [counterMsg, setCounterMsg] = useState("");

  // for counter UI: we need both users' offered lists
  const [myOffered, setMyOffered] = useState([]);
  const [theirOffered, setTheirOffered] = useState([]);

  // initialize counter selections when opening modal
  useEffect(() => {
    setReqSelected(new Set((ex.requesterBooks || []).map((b) => b._id)));
    setResSelected(new Set((ex.responderBooks || []).map((b) => b._id)));
    setCounterMsg(ex.message || "");
  }, [ex]);

  useEffect(() => {
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
  }, [ex, server, userId, otherUser]);

  const send = () =>
    onSubmit({
      requesterBooks: Array.from(reqSelected),
      responderBooks: Array.from(resSelected),
      message: counterMsg,
    });

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
          <h2 className="dialog__title" id={titleId}>Counter Offer</h2>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          <div className="split">
            <div>
              <p className="fact__term">Your offered books</p>
              <SelectableGrid
                books={myOffered}
                selected={reqSelected}
                setSelected={setReqSelected}
                // IMPORTANT: requesterBooks must be requester’s books
                forceRequesterSide={meIsRequester}
              />
            </div>

            <div>
              <p className="fact__term">{otherUser?.username || "Their"} offered books</p>
              <SelectableGrid
                books={theirOffered}
                selected={resSelected}
                setSelected={setResSelected}
                // IMPORTANT: responderBooks must be responder’s books
                forceRequesterSide={!meIsRequester}
              />
            </div>
          </div>

          <label className="field">
            <span className="field__label">Message</span>
            <textarea
              className="input"
              value={counterMsg}
              onChange={(e) => setCounterMsg(e.target.value)}
              placeholder="Optional message..."
            />
          </label>

          <p className="hint">
            Note: We only allow selecting books that are currently offered (unlocked).
          </p>
        </div>

        <div className="dialog__foot">
          <button className="button button--quiet" disabled={busy} onClick={onClose}>
            Close
          </button>
          <button className="button button--primary" disabled={busy} onClick={send}>
            Send Counter
          </button>
        </div>
      </div>
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
  if (!books?.length) return <p className="hint">No offerings found.</p>;

  function toggle(id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <div className="pick-grid">
      {books.map((b) => (
        <PickableBook
          key={b._id}
          book={b}
          selected={selected.has(b._id)}
          onClick={() => toggle(b._id)}
        />
      ))}
    </div>
  );
}
