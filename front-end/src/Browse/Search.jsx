// src/Browse/Search.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GoogleSuggestions, GoogleSelection, MarketResults } from "./SearchResults";
import { authFetch, isSessionExpiredError } from "../auth";
import { searchGoogleBooks } from "../googleBooks";

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
  };

  // IMPORTANT: don't clear selectedGoogleBook inside the google search effect,
  // because that can cause the dropdown to reappear “sometimes”.
  // Instead, clear selectedGoogleBook only when the user edits input again.
  const onChangeInput = (val) => {
    setInputValue(val);
    if (selectedGoogleBook) setSelectedGoogleBook(null);
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
    setInputValue(book.title);
    setGoogleResults([]);
    setShowDropdown(false);
  };

  const addToWishlist = async () => {
    if (!selectedGoogleBook) return;

    try {
      setLoading(true);
      setError("");

      const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/add-wishlist-book`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(selectedGoogleBook),
      });

      const text = await res.text();
      let data = {};
      try { data = JSON.parse(text); } catch { /* not JSON: report the status below */ }

      if (!res.ok) {
        console.log("Backend error body:", text);
        throw new Error(data?.message || data?.error || `Request failed (HTTP ${res.status})`);
      }

      alert("Added to wishlist!");
      clearAll();
    } catch (e) {
      // RequireAuth is already redirecting to the login page.
      if (isSessionExpiredError(e)) return;

      console.error(e);
      setError(e.message || "Failed to add to wishlist.");
    } finally {
      setLoading(false);
    }
  };

  const addToOfferings = async () => {
    if (!selectedGoogleBook) return;

    try {
      setLoading(true);
      setError("");

      const payload = { ...selectedGoogleBook, owner: userId };

      const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/add-offered-book`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.message || "Failed to add to offerings.");

      alert("Added to offerings!");
      clearAll();
    } catch (e) {
      if (isSessionExpiredError(e)) return;

      console.error(e);
      setError(e.message || "Failed to add to offerings.");
    } finally {
      setLoading(false);
    }
  };

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
          loading={loading}
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
