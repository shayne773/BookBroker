// src/Browse/Search.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleSuggestions, GoogleSelection, MarketResults } from "./SearchResults";
import { authFetch, isSessionExpiredError } from "../auth";
import { searchGoogleBooks } from "../googleBooks";
import useFeedback from "../useFeedback";

export default function Search() {
  const navigate = useNavigate();

  const userId = localStorage.getItem("userId");

  const [mode, setMode] = useState("market"); // "market" | "google"
  const [inputValue, setInputValue] = useState("");

  // Marketplace results
  const [booksData, setBooksData] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Google results + selection
  const [googleResults, setGoogleResults] = useState([]);
  const [selectedGoogleBook, setSelectedGoogleBook] = useState(null);
  const selectedRef = useRef(null);
  useEffect(() => {
    selectedRef.current = selectedGoogleBook;
  }, [selectedGoogleBook]);

  // What the selected book has become ({ wishlist, offered }), which action is
  // under way, and why one failed.
  const [added, setAdded] = useState({});
  const [adding, setAdding] = useState(null); // "wishlist" | "offered" | null
  const selectionFeedback = useFeedback();
  const { clear: clearSelectionFeedback } = selectionFeedback;

  // Dropdown control
  const [showDropdown, setShowDropdown] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const query = useMemo(() => inputValue.trim(), [inputValue]);

  const clearAll = () => {
    setInputValue("");
    setError("");
    setLoading(false);

    setBooksData([]);
    setHasSearched(false);

    setGoogleResults([]);
    setSelectedGoogleBook(null);
    setShowDropdown(false);
    setAdded({});
    clearSelectionFeedback();
  };

  // IMPORTANT: don't clear selectedGoogleBook inside the google search effect,
  // because that can cause the dropdown to reappear “sometimes”.
  // Instead, clear selectedGoogleBook only when the user edits input again.
  const onChangeInput = (val) => {
    setInputValue(val);
    if (selectedGoogleBook) {
      setSelectedGoogleBook(null);
      setAdded({});
      clearSelectionFeedback();
    }
  };

  // Google live dropdown (debounced)
  useEffect(() => {
    const run = async () => {
      if (mode !== "google") return;

      setError("");

      if (query.length < 2) {
        setGoogleResults([]);
        setShowDropdown(false);
        return;
      }

      try {
        setLoading(true);
        const results = await searchGoogleBooks(query);
        setGoogleResults(results.slice(0, 8));

        // Only show dropdown if user is actively searching (not after selection)
        if (!selectedGoogleBook) setShowDropdown(true);
      } catch (e) {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(e)) return;

        console.error(e);
        setGoogleResults([]);
        setShowDropdown(false);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    const t = setTimeout(run, 250);
    return () => clearTimeout(t);
  }, [mode, query, selectedGoogleBook]);

  const handleMarketSearch = async () => {
    if (query.length < 2) return;

    setLoading(true);
    setError("");

    try {
      const res = await authFetch(
        `${import.meta.env.VITE_SERVER_ADDRESS}/books?query=${encodeURIComponent(query)}`
      );

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Server did not return JSON.");
      }

      if (!res.ok) throw new Error(data?.message || `Search failed (HTTP ${res.status})`);

      setBooksData(Array.isArray(data) ? data : []);
      setHasSearched(true);
    } catch (err) {
      // RequireAuth is already redirecting to the login page.
      if (isSessionExpiredError(err)) return;

      console.error(err);
      setBooksData([]);
      setHasSearched(true);
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "market") handleMarketSearch();
      // google mode stays live
    }
  };

  // Close dropdown when input loses focus (no timeout needed once we use onMouseDown/onTouchStart)
  const handleInputBlur = () => setShowDropdown(false);

  const handleInputFocus = () => {
    if (mode === "google" && query.length >= 2 && googleResults.length > 0 && !selectedGoogleBook) {
      setShowDropdown(true);
    }
  };

  // Selecting a google suggestion (use mousedown/touchstart so it always wins vs blur)
  const pickGoogleBook = (book, e) => {
    if (e?.preventDefault) e.preventDefault();

    setSelectedGoogleBook(book);
    setAdded({});
    clearSelectionFeedback();
    setInputValue(book.title);
    setGoogleResults([]);
    setShowDropdown(false);
  };

  // Adds the selected book to a shelf; its button then reads as done.
  const addTo = async (shelf, path, body) => {
    const book = selectedGoogleBook;
    if (!book) return;

    setAdding(shelf);
    selectionFeedback.clear();
    try {
      const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || data?.error || `Request failed (HTTP ${res.status})`);

      if (selectedRef.current === book) setAdded((prev) => ({ ...prev, [shelf]: true }));
    } catch (e) {
      // RequireAuth is already redirecting to the login page.
      if (isSessionExpiredError(e)) return;

      console.error(e);
      if (selectedRef.current !== book) return;
      selectionFeedback.fail(
        e.message || (shelf === "wishlist" ? "Failed to add to wishlist." : "Failed to add to offerings.")
      );
    } finally {
      setAdding(null);
    }
  };

  const addToWishlist = () => addTo("wishlist", "/user/add-wishlist-book", selectedGoogleBook);

  const addToOfferings = () =>
    addTo("offered", "/user/add-offered-book", { ...selectedGoogleBook, owner: userId });

  return (
    <main className="page page--reading">
      <button className="back-link" onClick={() => navigate("/browse")}>
        <span className="back-link__mark" aria-hidden="true">&larr;</span>
        Browse
      </button>

      <div className="page-head">
        <div className="page-head__main">
          <p className="kicker">Find a book</p>
          <h1 className="page-title">Search</h1>
        </div>

        <div className="page-head__aside">
          <div className="segmented" role="group" aria-label="Where to search">
            <button
              type="button"
              className={`segmented__option ${mode === "market" ? "is-active" : ""}`}
              aria-pressed={mode === "market"}
              onClick={() => {
                setMode("market");
                setError("");
                setGoogleResults([]);
                setSelectedGoogleBook(null);
                setShowDropdown(false);
                setBooksData([]);
                setHasSearched(false);
              }}
            >
              Marketplace
            </button>

            <button
              type="button"
              className={`segmented__option ${mode === "google" ? "is-active" : ""}`}
              aria-pressed={mode === "google"}
              onClick={() => {
                setMode("google");
                setError("");
                setBooksData([]);
                setHasSearched(false);
                // keep input
              }}
            >
              Google Books
            </button>
          </div>
        </div>
      </div>

      <div className="search-bar">
        <label className="visually-hidden" htmlFor="search-input">
          {mode === "market" ? "Search offered books" : "Search Google Books"}
        </label>

        <input
          id="search-input"
          type="text"
          className="input search-bar__input"
          placeholder={mode === "market" ? "Search offered books (title/author)" : "Search Google Books"}
          value={inputValue}
          onChange={(e) => onChangeInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleInputBlur}
          onFocus={handleInputFocus}
          autoComplete="off"
        />

        {inputValue && (
          <button className="button button--quiet" onClick={clearAll} aria-label="Clear">
            Clear
          </button>
        )}

        {mode === "market" ? (
          <button
            className="button button--primary"
            onClick={handleMarketSearch}
            disabled={loading || query.length < 2}
          >
            {loading ? "Searching\u2026" : "Search"}
          </button>
        ) : (
          <button className="button button--secondary" disabled>
            {loading ? "Searching\u2026" : "Live"}
          </button>
        )}

        {mode === "google" && showDropdown && googleResults.length > 0 && !selectedGoogleBook && (
          <GoogleSuggestions results={googleResults} onPick={pickGoogleBook} />
        )}
      </div>

      {error && (
        <p className="notice notice--error" role="alert">
          <span className="notice__title">Search failed.</span> {error}
        </p>
      )}

      {/* Google selected card */}
      {mode === "google" && selectedGoogleBook && (
        <GoogleSelection
          book={selectedGoogleBook}
          added={added}
          adding={adding}
          feedback={selectionFeedback.feedback}
          onWishlist={addToWishlist}
          onOffer={addToOfferings}
          onCancel={clearAll}
        />
      )}

      {/* Marketplace results */}
      {mode === "market" && (
        <section>
          {!hasSearched && (
            <p className="hint search-note">
              Type at least <b>2</b> characters, then press <b>Enter</b> or choose <b>Search</b>.
            </p>
          )}

          {hasSearched && !loading && <MarketResults books={booksData} />}
        </section>
      )}

      {/* Google hint */}
      {mode === "google" && !selectedGoogleBook && query.length < 2 && (
        <p className="hint search-note">
          Type at least <b>2</b> characters to see suggestions.
        </p>
      )}
    </main>
  );
}
