import UserLink from "../UserLink";

// The conversation itself, oldest first. `listRef` is the scrolling element,
// which MessagesDetail keeps pinned to the newest message. Every message not
// yours is from `otherUser`, whose name links to their profile.
export default function MessageThread({ listRef, loading, messages, myUserId, otherUser }) {
  return (
    <section ref={listRef} className="thread" aria-label="Messages">
      {loading && <p className="hint">Loading messages…</p>}

      {!loading && messages.length === 0 && (
        <p className="hint">No messages yet. Say hi 👋</p>
      )}

      {messages.map((m) => {
        const senderId = String(m.sender?._id || m.sender?.id || m.sender);
        const isMine = senderId === String(myUserId);

        return (
          <div
            key={m.id || m._id || `${m.timestamp}-${m.content}`}
            className={`message${isMine ? " message--mine" : ""}`}
          >
            {!isMine && (
              <span className="message__sender">
                <UserLink user={otherUser} fallback="User" />
              </span>
            )}

            <p className="message__bubble">{m.content}</p>

            <span className="message__time">
              {m.timestamp
                ? new Date(m.timestamp).toLocaleString([], {
                    month: "short",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
            </span>
          </div>
        );
      })}
    </section>
  );
}
