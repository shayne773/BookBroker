import { deadlineDate } from "../exchangeStatus";
import Feedback from "../Feedback";
import UserLink from "../UserLink";

// The two stages after both sides agree: confirming the hand-over, then
// rating the other reader.

export function CompletionPanel({ ex, confirmedByMe }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Completion</h2>
      </div>

      <dl className="facts facts--row">
        <CompletionRow
          label={<UserLink user={ex.requester} fallback="Requester" />}
          done={!!ex.requesterConfirmedComplete}
        />
        <CompletionRow
          label={<UserLink user={ex.responder} fallback="Responder" />}
          done={!!ex.responderConfirmedComplete}
        />
      </dl>

      <p className="hint mt-4">
        The trade completes, and its books leave the listings, when you both confirm, or
        automatically on a set date once one of you has.
      </p>

      {ex.autoCompletesAt && ex.requesterConfirmedComplete !== ex.responderConfirmedComplete && (
        <p className="notice mt-4">
          {confirmedByMe
            ? `Completes automatically on ${deadlineDate(ex.autoCompletesAt)} unless you cancel.`
            : `Completes automatically on ${deadlineDate(ex.autoCompletesAt)}. Confirm, or message them if something is wrong.`}
        </p>
      )}
    </section>
  );
}

function CompletionRow({ label, done }) {
  return (
    <div>
      <dt className="fact__term">{label}</dt>
      <dd className="fact__value">
        <span className={done ? "status status--done" : "status status--waiting"}>
          {done ? "Confirmed" : "Waiting"}
        </span>
      </dd>
    </div>
  );
}

// `feedback` says how submitting the rating went.
export function RatingPanel({ other, ratedAlready, rating, setRating, busy, onRate, feedback }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">
          Rate <UserLink user={other} fallback="User" />
        </h2>
      </div>

      {ratedAlready ? (
        <div className="button-row">
          <span className="status status--done">Already rated</span>
          <span className="hint">Thanks for helping keep BookBroker safe.</span>
        </div>
      ) : (
        <div className="stack">
          <div className="button-row">
            <StarPicker value={rating} onChange={setRating} />
            <button disabled={busy} className="button button--primary" onClick={onRate}>
              Submit Rating
            </button>
          </div>
          <p className="hint">Only rate after you’ve completed the exchange.</p>
        </div>
      )}

      <Feedback feedback={feedback} />
    </section>
  );
}

function StarPicker({ value, onChange }) {
  return (
    <div className="rating-picker">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className="rating-picker__star"
          onClick={() => onChange(n)}
          aria-label={`${n} star`}
          aria-pressed={n <= value}
        >
          {n <= value ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}
