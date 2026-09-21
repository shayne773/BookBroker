// The line under the thread: propose a trade, or write and send a message.
export default function Composer({ text, setText, onSend, onTrade }) {
  return (
    <form className="composer" onSubmit={onSend}>
      <button
        type="button"
        className="button button--secondary"
        onClick={onTrade}
        aria-label="Propose trade"
      >
        Trade
      </button>

      <label className="visually-hidden" htmlFor="message-text">Message</label>
      <input
        id="message-text"
        className="input"
        type="text"
        value={text}
        placeholder="Send a message…"
        onChange={(e) => setText(e.target.value)}
      />

      <button className="button button--primary" type="submit" disabled={!text.trim()}>
        Send
      </button>
    </form>
  );
}
