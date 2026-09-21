import { statusClass } from '../exchangeStatus';

const STATUSES = ["PENDING", "COUNTERED", "ACCEPTED", "COMPLETED"];

function statusIndex(s) {
  const i = STATUSES.indexOf(s);
  return i === -1 ? 0 : i;
}

// Where the exchange stands: the stage track, the current status and the
// note that came with the latest offer.
export default function ExchangeProgress({ ex }) {
  const stepsDone = statusIndex(ex.status);

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Status</h2>
        <span className={statusClass(ex.status)}>{ex.status}</span>
      </div>

      <ol className="steps">
        {STATUSES.map((s, i) => (
          <li key={s} className={`step${i <= stepsDone ? " is-done" : ""}`}>
            {s}
          </li>
        ))}
      </ol>

      <p className="hint mt-4">Updated {new Date(ex.updatedAt).toLocaleString()}</p>

      {!!ex.message && <blockquote className="quote mt-4">“{ex.message}”</blockquote>}
    </section>
  );
}
