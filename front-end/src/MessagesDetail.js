import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FaAngleLeft } from "react-icons/fa";
import "./MessagesDetail.css";
import { authFetch, isSessionExpiredError } from "./auth";

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
  const [tradeStep, setTradeStep] = useState(1); // 1 = pick my book, 2 = pick their book
  const [myOffered, setMyOffered] = useState([]);
  const [theirOffered, setTheirOffered] = useState([]);
  const [myPick, setMyPick] = useState(null);
  const [theirPick, setTheirPick] = useState(null);
  const [tradeMsg, setTradeMsg] = useState("");
  const [tradeLoading, setTradeLoading] = useState(false);
  const [tradeError, setTradeError] = useState("");

  const listRef = useRef(null);

  const server = process.env.REACT_APP_SERVER_ADDRESS;

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

  // ----------------------------
  // TRADE: open modal + load books
  // ----------------------------
  const openTradeModal = async () => {
    setShowTradeModal(true);
    setTradeStep(1);
    setTradeError("");
    setTradeMsg("");
    setMyPick(null);
    setTheirPick(null);

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
  };

  const closeTradeModal = () => {
    setShowTradeModal(false);
  };

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
        headers: jsonHeaders,
        body: JSON.stringify({
          responderId: otherUserId,
          requesterBooks: [myPick._id],     
          responderBooks: [theirPick._id],  
          message: tradeMsg.trim() || "",
          expiresInHours: 48,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Create exchange failed: ${res.status} ${body}`);
      }

      const ex = await res.json();
      const exchangeId = ex._id; // ✅ your backend returns full exchange doc

      closeTradeModal();
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
    <main className="MsgDetail">
      {/* Header */}
      <header className="MsgHeader">
        <button
          className="MsgBackBtn"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          <FaAngleLeft />
        </button>

        <div className="MsgHeaderText">
          <div className="MsgHeaderTitle">
            {otherUser?.username || "Loading..."}
          </div>
          <div className="MsgHeaderSub">
            {otherUser?.location ? `📍 ${otherUser.location}` : "\u00A0"}
          </div>
        </div>
      </header>

      {/* Messages */}
      <section className="MsgBody">
        <div ref={listRef} className="MsgList">
          {loading && <div className="MsgHint">Loading messages…</div>}

          {!loading && messages.length === 0 && (
            <div className="MsgHint">No messages yet. Say hi 👋</div>
          )}

          {messages.map((m) => {
            const senderId = String(m.sender?._id || m.sender?.id || m.sender);
            const isMine = senderId === String(myUserId);

            return (
              <div
                key={m.id || m._id || `${m.timestamp}-${m.content}`}
                className={`MsgRow ${isMine ? "mine" : "theirs"}`}
              >
                <div className="MsgBubbleWrap">
                  {!isMine && (
                    <div className="MsgSender">
                      {m.sender?.username || otherUser?.username || "User"}
                    </div>
                  )}

                  <div className={`MsgBubble ${isMine ? "mine" : "theirs"}`}>
                    <div className="MsgText">{m.content}</div>
                  </div>

                  <div className={`MsgTime ${isMine ? "mine" : "theirs"}`}>
                    {m.timestamp
                      ? new Date(m.timestamp).toLocaleString([], {
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Composer (fixed above bottom nav) */}
      <form className="MsgComposer" onSubmit={handleMessageSend}>
        <button
          type="button"
          className="MsgTradeBtn"
          onClick={openTradeModal}
          aria-label="Propose trade"
        >
          Trade
        </button>

        <input
          className="MsgInput"
          type="text"
          value={text}
          placeholder="Send a message…"
          onChange={(e) => setText(e.target.value)}
        />

        <button className="MsgSend" type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>

      {/* ---------- TRADE MODAL ---------- */}
      {showTradeModal && (
        <div className="TradeOverlay" onClick={closeTradeModal}>
          <div className="TradeModal" onClick={(e) => e.stopPropagation()}>
            <div className="TradeHeader">
              <div className="TradeTitle">Propose an exchange</div>
              <button className="TradeClose" onClick={closeTradeModal}>
                ✕
              </button>
            </div>

            {tradeLoading && (
              <div className="TradeHint">Loading offered books…</div>
            )}
            {tradeError && <div className="TradeError">{tradeError}</div>}

            {!tradeLoading && (
              <>
                <div className="TradeSteps">
                  <button
                    className={`TradeStep ${tradeStep === 1 ? "active" : ""}`}
                    onClick={() => setTradeStep(1)}
                    type="button"
                  >
                    1) Your book
                  </button>
                  <button
                    className={`TradeStep ${tradeStep === 2 ? "active" : ""}`}
                    onClick={() => setTradeStep(2)}
                    type="button"
                  >
                    2) Their book
                  </button>
                </div>

                {tradeStep === 1 && (
                  <>
                    <div className="TradeSectionTitle">
                      Pick one of your offered books
                    </div>

                    {myOffered.length === 0 ? (
                      <div className="TradeEmpty">
                        You don’t have any offered books yet. Add one in Profile →
                        Offerings.
                      </div>
                    ) : (
                      <div className="TradeGrid">
                        {myOffered.map((b) => (
                          <button
                            type="button"
                            key={b._id}
                            className={`TradeCard ${
                              myPick?._id === b._id ? "selected" : ""
                            }`}
                            onClick={() => setMyPick(b)}
                          >
                            <div
                              className="TradeCover"
                              style={{
                                backgroundImage: `url(${
                                  b.cover || "/default-book.png"
                                })`,
                              }}
                            />
                            <div className="TradeCardMeta">
                              <div className="TradeCardTitle">
                                {b.title || "Untitled"}
                              </div>
                              <div className="TradeCardSub">
                                {b.author || "Unknown"}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="TradeFooter">
                      <button
                        className="TradePrimary"
                        type="button"
                        onClick={() => setTradeStep(2)}
                        disabled={!myPick?._id}
                      >
                        Next
                      </button>
                    </div>
                  </>
                )}

                {tradeStep === 2 && (
                  <>
                    <div className="TradeSectionTitle">
                      Pick one of {otherUser?.username || "their"} offered books
                    </div>

                    {theirOffered.length === 0 ? (
                      <div className="TradeEmpty">
                        They don’t have any offered books right now.
                      </div>
                    ) : (
                      <div className="TradeGrid">
                        {theirOffered.map((b) => (
                          <button
                            type="button"
                            key={b._id}
                            className={`TradeCard ${
                              theirPick?._id === b._id ? "selected" : ""
                            }`}
                            onClick={() => setTheirPick(b)}
                          >
                            <div
                              className="TradeCover"
                              style={{
                                backgroundImage: `url(${
                                  b.cover || "/default-book.png"
                                })`,
                              }}
                            />
                            <div className="TradeCardMeta">
                              <div className="TradeCardTitle">
                                {b.title || "Untitled"}
                              </div>
                              <div className="TradeCardSub">
                                {b.author || "Unknown"}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="TradeMsgBox">
                      <label className="TradeLabel">Message (optional)</label>
                      <textarea
                        className="TradeTextarea"
                        value={tradeMsg}
                        onChange={(e) => setTradeMsg(e.target.value)}
                        rows={3}
                        placeholder="Add a note…"
                      />
                    </div>

                    <div className="TradeFooter dual">
                      <button
                        className="TradeSecondary"
                        type="button"
                        onClick={() => setTradeStep(1)}
                      >
                        Back
                      </button>
                      <button
                        className="TradePrimary"
                        type="button"
                        onClick={submitTrade}
                        disabled={!myPick?._id || !theirPick?._id}
                      >
                        Send Offer
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
};

export default MessagesDetail;
