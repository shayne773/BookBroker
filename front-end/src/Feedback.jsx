// The app's one way of saying how an action went: a short line in place, next to
// the control that did it, never a pop-up. The line is a polite live region that
// is always in the page, so a screen reader hears each change; its entrance uses
// the motion tokens, which collapse under prefers-reduced-motion.

// The line itself, with its state from useFeedback. Render it where the reader
// is looking when they act.
export default function Feedback({ feedback, className = '' }) {
  const classes = ['feedback', feedback && `feedback--${feedback.tone}`, className].filter(Boolean);
  return (
    <p className={classes.join(' ')} role="status" aria-live="polite">
      {feedback && (
        // Keyed, so a repeat of the same message plays its entrance again.
        <span key={feedback.key} className="feedback__text">{feedback.message}</span>
      )}
    </p>
  );
}

// A button whose action leaves it checked, e.g. "Add to Wishlist" turning into
// "On your wishlist". Busy or done, it is aria-disabled rather than disabled, so
// focus stays on it; a hidden live region beside it announces the new state.
export function DoneButton({ done, doneLabel, busy = false, busyLabel, className = 'button', onClick, children }) {
  const inert = done || busy;
  return (
    <>
      <button
        type="button"
        className={`${className}${done ? ' is-done' : ''}`}
        aria-disabled={inert || undefined}
        onClick={inert ? undefined : onClick}
      >
        {done ? (
          <span key="done" className="button__done">
            <span className="button__check" aria-hidden="true">&#10003;</span>
            {doneLabel}
          </span>
        ) : busy && busyLabel ? (
          busyLabel
        ) : (
          children
        )}
      </button>
      <span className="visually-hidden" role="status">{done ? doneLabel : ''}</span>
    </>
  );
}
