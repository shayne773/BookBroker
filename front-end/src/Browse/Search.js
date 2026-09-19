// src/Browse/Search.js
import "./Search.css";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authFetch, isSessionExpiredError } from "../auth";

const fetchBooksFromGoogle = async (query) => {
  const response = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}`
  );
  const data = await response.json();
  return (data.items || []).map((item) => ({
    title: item.volumeInfo.title,
    author: item.volumeInfo.authors?.join(", ") || "Unknown",
    publisher: item.volumeInfo.publisher || "Unknown",
    year: item.volumeInfo.publishedDate?.substring(0, 4),
    cover: item.volumeInfo.imageLinks?.thumbnail,
    isbn: item.volumeInfo.industryIdentifiers?.[0]?.identifier || "",
    genre: item.volumeInfo.categories?.[0] || "Unknown",
    desc: item.volumeInfo.description || "",
  }));
};

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
        const results = await fetchBooksFromGoogle(query);
        setGoogleResults(results.slice(0, 8));

        // Only show dropdown if user is actively searching (not after selection)
        if (!selectedGoogleBook) setShowDropdown(true);
      } catch (e) {
        console.error(e);
        setGoogleResults([]);
        setShowDropdown(false);
        setError("Failed to search Google Books.");
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
      const res = await fetch(
        `${process.env.REACT_APP_SERVER_ADDRESS}/books?query=${encodeURIComponent(query)}`
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

      const res = await authFetch(`${process.env.REACT_APP_SERVER_ADDRESS}/user/add-wishlist-book`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(selectedGoogleBook),
      });

      const text = await res.text();
      let data = {};
      try { data = JSON.parse(text); } catch {}

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

      const res = await authFetch(`${process.env.REACT_APP_SERVER_ADDRESS}/user/add-offered-book`, {
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
    <main className="SearchPage">
      <div className="SearchSticky">
        <header className="SearchTop">
          <button className="SearchBack" onClick={() => navigate("/browse")} aria-label="Back">
            ←
          </button>
          <h1 className="SearchTitle">Search</h1>
          <div className="SearchTopSpacer" />
        </header>

        <div className="SearchToggleRow">
          <button
            className={`SearchToggle ${mode === "market" ? "active" : ""}`}
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
            className={`SearchToggle ${mode === "google" ? "active" : ""}`}
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

        <div className="SearchBar">
          <input
            type="text"
            placeholder={mode === "market" ? "Search offered books (title/author)" : "Search Google Books"}
            value={inputValue}
            onChange={(e) => onChangeInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleInputBlur}
            onFocus={handleInputFocus}
            autoComplete="off"
          />

          {inputValue && (
            <button className="SearchClear" onClick={clearAll} aria-label="Clear">
              ×
            </button>
          )}

          {mode === "market" ? (
            <button className="SearchBtn" onClick={handleMarketSearch} disabled={loading || query.length < 2}>
              {loading ? "..." : "Search"}
            </button>
          ) : (
            <button className="SearchBtn" disabled>
              {loading ? "..." : "Live"}
            </button>
          )}

          {/* ✅ Google dropdown (reliably closes) */}
          {mode === "google" && showDropdown && googleResults.length > 0 && !selectedGoogleBook && (
            <ul className="search-dropdown">
              {googleResults.map((book, idx) => (
                <li
                  key={idx}
                  onMouseDown={(e) => pickGoogleBook(book, e)}
                  onTouchStart={(e) => pickGoogleBook(book, e)}
                >
                  <img
                    src={book.cover || "/default-book.png"}
                    alt="cover"
                    width="40"
                    height="60"
                    style={{ marginRight: "10px", objectFit: "cover", borderRadius: "8px" }}
                    onError={(e) => {
                      e.currentTarget.src = "/default-book.png";
                    }}
                  />
                  <span className="DropdownText">
                    <span className="DropdownTitle">{book.title}</span>
                    <span className="DropdownSub">{book.author}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div className="SearchError compact">
            <div className="SearchErrorTitle">Search failed</div>
            <div className="SearchErrorText">{error}</div>
          </div>
        )}
      </div>

      <div className="SearchScrollArea">
        {/* Google selected card */}
        {mode === "google" && selectedGoogleBook && (
          <div className="GoogleSelectedCard">
            <div className="GoogleSelectedTop">
              <img
                className="GoogleSelectedCover"
                src={selectedGoogleBook.cover || "/default-book.png"}
                alt="cover"
                onError={(e) => {
                  e.currentTarget.src = "/default-book.png";
                }}
              />
              <div className="GoogleSelectedMeta">
                <div className="GoogleSelectedTitle">{selectedGoogleBook.title}</div>
                <div className="GoogleSelectedSub">
                  {selectedGoogleBook.author} {selectedGoogleBook.year ? `· ${selectedGoogleBook.year}` : ""}
                </div>
                <div className="GoogleSelectedSub subtle">
                  {selectedGoogleBook.publisher ? selectedGoogleBook.publisher : ""}
                  {selectedGoogleBook.isbn ? ` · ISBN ${selectedGoogleBook.isbn}` : ""}
                </div>
              </div>
            </div>

            <div className="GoogleSelectedActions">
              <button className="SearchInterestBtn" onClick={addToWishlist} disabled={loading}>
                Add to Wishlist
              </button>
              <button className="SearchInterestBtn" onClick={addToOfferings} disabled={loading}>
                Add to Offerings
              </button>
              <button className="SearchSecondaryBtn" onClick={clearAll} disabled={loading}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Marketplace results */}
        {mode === "market" && (
          <section className="SearchResults">
            {!hasSearched && (
              <div className="SearchHint">
                Type at least <b>2</b> characters, then press <b>Enter</b> or tap <b>Search</b>.
              </div>
            )}

            {hasSearched && !loading && (
              <>
                {booksData.length > 0 ? (
                  booksData.map((book, index) => (
                    <div key={book._id || index} className="SearchCard">
                      <div className="SearchCover">
                        <img
                          src={book.cover || "/default-book.png"}
                          alt={book.title ? `${book.title} cover` : "Book cover"}
                          onError={(e) => {
                            e.currentTarget.src = "/default-book.png";
                          }}
                        />
                      </div>

                      <div className="SearchMeta">
                        <div className="SearchCardTop">
                          <h2 className="SearchBookTitle">{book.title || "[NO TITLE]"}</h2>
                          {book.year && <span className="SearchYear">{book.year}</span>}
                        </div>

                        <div className="SearchSub">{book.author || "[NO AUTHOR]"}</div>

                        <div className="SearchActions">
                          {book._id ? (
                            <Link to={`/books/${book._id}`} className="SearchLink">
                              <button className="SearchInterestBtn">Show Interest</button>
                            </Link>
                          ) : (
                            <button className="SearchInterestBtn" disabled title="Missing book id">
                              Show Interest
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="SearchEmpty">No books found for this search.</p>
                )}
              </>
            )}
          </section>
        )}

        {/* Google hint */}
        {mode === "google" && !selectedGoogleBook && query.length < 2 && (
          <div className="SearchHint">
            Type at least <b>2</b> characters to see suggestions.
          </div>
        )}
      </div>
    </main>
  );
}
