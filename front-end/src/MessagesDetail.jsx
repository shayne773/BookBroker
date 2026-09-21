import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { authFetch, isSessionExpiredError } from "./auth";
import MessageThread from "./MessagesDetail/MessageThread";
import Composer from "./MessagesDetail/Composer";
import ProposeTradeDialog from "./MessagesDetail/ProposeTradeDialog";

const MessagesDetail = () => {
  const { user: otherUserId } = useParams();
  const navigate = useNavigate();

  const myUserId = localStorage.getItem("userId");

  const [otherUser, setOtherUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);

  // ---- Exchange modal state ----
  const [showTradeModal, setShowTradeModal] = useState(false);

  const listRef = useRef(null);

  const server = import.meta.env.VITE_SERVER_ADDRESS;

  const jsonHeaders = useMemo(() => ({ "Content-Type": "application/json" }), []);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const loadOtherUser = useCallback(async () => {
    const res = await authFetch(`${server}/users/${otherUserId}`);
    if (!res.ok) throw new Error(`Failed to load user: ${res.status}`);
    return res.json();
  }, [server, otherUserId]);

  const loadMessages = useCallback(async () => {
    const res = await authFetch(`${server}/messages/${otherUserId}`);
    if (!res.ok) throw new Error(`Failed to load messages: ${res.status}`);
    const data = await res.json();

    // oldest -> newest
    const sorted = [...data].sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );
    setMessages(sorted);
  }, [server, otherUserId]);

  // Initial load
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const u = await loadOtherUser();
        if (!cancelled) setOtherUser(u);

        await loadMessages();
        if (!cancelled) setLoading(false);

        setTimeout(scrollToBottom, 0);
      } catch (err) {
        console.error(err);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadOtherUser, loadMessages, scrollToBottom]);

  // Gentle polling
  useEffect(() => {
    const t = setInterval(() => {
      loadMessages().catch(() => {});
    }, 7000);
    return () => clearInterval(t);
  }, [loadMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function handleMessageSend(e) {
    e.preventDefault();
    const content = text.trim();
    if (!content) return;

    try {
      const res = await authFetch(`${server}/messages/${otherUserId}`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ content }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Send failed: ${res.status} ${body}`);
      }

      setText("");
      await loadMessages();
      scrollToBottom();
    } catch (err) {
      // RequireAuth is already redirecting to the login page.
      if (isSessionExpiredError(err)) return;

      console.error("Failed to send message:", err);
      alert("Failed to send message.");
    }
  }

  return (
    <main className="page page--reading page--chat">
      <div>
        <button type="button" className="back-link" onClick={() => navigate(-1)}>
          <span className="back-link__mark" aria-hidden="true">&larr;</span>
          Back
        </button>
      </div>

      <div className="page-head">
        <div className="page-head__main person">
          <span className="avatar" aria-hidden="true">
            {(otherUser?.username || "?").slice(0, 1)}
          </span>
          <div className="person__text">
            <p className="kicker">Conversation with</p>
            <h1 className="page-title">{otherUser?.username || "Loading..."}</h1>
          </div>
        </div>

        {otherUser?.location && (
          <div className="page-head__aside">
            <span className="hint">{otherUser.location}</span>
          </div>
        )}
      </div>

      <MessageThread
        listRef={listRef}
        loading={loading}
        messages={messages}
        myUserId={myUserId}
        otherUser={otherUser}
      />

      <Composer
        text={text}
        setText={setText}
        onSend={handleMessageSend}
        onTrade={() => setShowTradeModal(true)}
      />

      {showTradeModal && (
        <ProposeTradeDialog
          otherUserId={otherUserId}
          otherUser={otherUser}
          onClose={() => setShowTradeModal(false)}
        />
      )}
    </main>
  );
};

export default MessagesDetail;
