import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { authFetch, isSessionExpiredError } from "./auth";
import MessageThread from "./MessagesDetail/MessageThread";
import Composer from "./MessagesDetail/Composer";
import ProposeTradeDialog from "./MessagesDetail/ProposeTradeDialog";
import usePolling from "./usePolling";
import { refreshUnread } from "./unread";

// How often an open conversation checks for new messages while the tab is visible.
const THREAD_INTERVAL = 3000;

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
  const messagesRef = useRef([]);
  // The newest message a fetch has returned, which the next poll asks after. A
  // message sent from here is shown straight away but never moves it, so one
  // from the other person that arrived first is still fetched.
  const cursorRef = useRef(null);
  // Changes each time a different conversation loads, so a poll still in flight
  // for the previous one is dropped.
  const threadRef = useRef(0);

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

  // Adds messages the thread does not hold yet, keeping it oldest first, or with
  // `replace` swaps the whole thread.
  const addMessages = useCallback((incoming, { replace = false } = {}) => {
    const base = replace ? [] : messagesRef.current;
    const known = new Set(base.map((m) => String(m.id)));
    const fresh = incoming.filter((m) => !known.has(String(m.id)));
    if (!fresh.length && !replace) return;

    const next = [...base, ...fresh].sort(
      (a, b) =>
        new Date(a.timestamp) - new Date(b.timestamp) ||
        String(a.id).localeCompare(String(b.id))
    );
    messagesRef.current = next;
    setMessages(next);
  }, []);

  // Messages returned by a fetch, oldest first: the only ones that move the cursor.
  const addFetched = useCallback((fetched, options) => {
    if (fetched.length) cursorRef.current = fetched[fetched.length - 1].id;
    addMessages(fetched, options);
  }, [addMessages]);

  // Records that this user has seen the thread up to the newest fetched message,
  // and lets the navigation bar's count catch up. Only while the tab is in view.
  const markRead = useCallback(async () => {
    const upTo = cursorRef.current;
    if (!upTo || document.visibilityState === "hidden") return;
    const res = await authFetch(`${server}/messages/${otherUserId}/read`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ upTo }),
    });
    if (res.ok) await refreshUnread();
  }, [server, otherUserId, jsonHeaders]);

  // With a cursor, asks only for messages newer than the newest one on screen.
  const fetchMessages = useCallback(async (after) => {
    const query = after ? `?after=${encodeURIComponent(after)}` : "";
    const res = await authFetch(`${server}/messages/${otherUserId}${query}`);
    if (!res.ok) throw new Error(`Failed to load messages: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }, [server, otherUserId]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    threadRef.current += 1;
    cursorRef.current = null;

    (async () => {
      try {
        setLoading(true);
        const u = await loadOtherUser();
        if (!cancelled) setOtherUser(u);

        const thread = await fetchMessages();
        if (cancelled) return;
        addFetched(thread, { replace: true });
        setLoading(false);

        setTimeout(scrollToBottom, 0);
        await markRead();
      } catch (err) {
        if (isSessionExpiredError(err)) return;
        console.error(err);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadOtherUser, fetchMessages, addFetched, markRead, scrollToBottom]);

  // Live delivery by short polling: often while the conversation is in view,
  // not at all while the tab is hidden (it catches up the moment it returns).
  const poll = useCallback(async () => {
    const thread = threadRef.current;
    const fresh = await fetchMessages(cursorRef.current);
    if (threadRef.current !== thread) return;
    addFetched(fresh);
    if (fresh.some((m) => String(m.sender) !== String(myUserId))) await markRead();
  }, [fetchMessages, addFetched, markRead, myUserId]);
  usePolling(poll, { interval: THREAD_INTERVAL, enabled: !loading });

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

      const sent = await res.json();
      setText("");
      if (sent?.message) addMessages([sent.message]);
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
