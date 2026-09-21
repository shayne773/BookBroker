import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authFetch, isSessionExpiredError } from "./auth";
import BookCover from "./BookCover";

const Browse = () => {
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const server = import.meta.env.VITE_SERVER_ADDRESS;

  useEffect(() => {
    setLoading(true);

    const t = setTimeout(() => {
      authFetch(`${server}/browse?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((payload) => {
          setData(payload);
          setLoading(false);
        })
        .catch((err) => {
          // RequireAuth is already redirecting to the login page.
          if (isSessionExpiredError(err)) return;

          setData(null);
          setLoading(false);
        });
    }, 250); // debounce

    return () => clearTimeout(t);
  }, [query, server]);

  const showSearch = query.trim().length > 0;

  return (
    <main className="page">
      <div className="page-head">
        <div className="page-head__main">
          <p className="kicker">The marketplace</p>
          <h1 className="page-title">Browse</h1>
        </div>

        <div className="page-head__aside browse-search">
          <label className="visually-hidden" htmlFor="browse-search">
            Search title or author
          </label>
          <input
            id="browse-search"
            type="search"
            className="input"
            placeholder="Search title or author"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <nav className="browse-links" aria-label="Browse sections">
        <Link to="/browse/newly-added" className="textlink-quiet">Newly added</Link>
        <Link to="/browse/popular" className="textlink-quiet">Popular now</Link>
        <Link to="/browse/by-category" className="textlink-quiet">By category</Link>
        <Link to="/browse/search" className="textlink-quiet">Advanced search</Link>
      </nav>

      {loading && <BookRowSkeleton />}

      {!loading && data && (
        <>
          {showSearch && (
            <Section title="Search results" count={data.searchResults.length}>
              <BookRow books={data.searchResults} />
            </Section>
          )}

          {!showSearch && (
            <>
              <Section title="Recommended for you">
                <BookRow books={data.recommended} />
              </Section>

              <Section title="Popular now">
                <BookRow books={data.popular} />
              </Section>

              <Section title="Newly added">
                <BookRow books={data.newlyAdded} />
              </Section>

              {Object.entries(data.genreRows).map(([genre, books]) => (
                <Section key={genre} title={genre}>
                  <BookRow books={books} />
                </Section>
              ))}
            </>
          )}
        </>
      )}
    </main>
  );
};

const Section = ({ title, count, children }) => (
  <section className="section">
    <div className="section-head">
      <h2 className="section-title">{title}</h2>
      {count !== undefined && (
        <span className="section-count">
          {count} {count === 1 ? "book" : "books"}
        </span>
      )}
    </div>
    {children}
  </section>
);

const BookRow = ({ books }) => {
  if (!books?.length) return <div className="empty">No books</div>;

  return (
    <div className="book-grid book-grid--compact">
      {books.map((b) => (
        <Link key={b._id} to={`/books/${b._id}`} className="book-tile">
          <span className="cover">
            <BookCover src={b.cover} title={b.title} />
          </span>

          <span className="book-tile__title">{b.title || "[NO TITLE]"}</span>
          <span className="book-tile__meta">{b.author || "[NO AUTHOR]"}</span>
        </Link>
      ))}
    </div>
  );
};

// Placeholders in the shape of the row that is coming, so the page does not
// jump when the first payload lands.
const BookRowSkeleton = () => (
  <section className="section" aria-hidden="true">
    <div className="section-head">
      <span className="skeleton skeleton--line" style={{ width: "12rem" }} />
    </div>

    <div className="book-grid book-grid--compact">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="stack">
          <div className="skeleton skeleton--cover" />
          <div className="skeleton skeleton--line" />
          <div className="skeleton skeleton--line skeleton--line-short" />
        </div>
      ))}
    </div>
  </section>
);

export default Browse;
