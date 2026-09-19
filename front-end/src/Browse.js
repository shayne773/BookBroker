import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import "./Browse.css";
import { authFetch, isSessionExpiredError } from "./auth";

const Browse = () => {
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const server = process.env.REACT_APP_SERVER_ADDRESS;

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
    <main className="BrowseOnePage">
      <div className="browse-header">
        <div className="titlebox">
            <h1 className="title">Browse</h1>
        </div>
        <input
          className="browse-search"
          placeholder="Search title or author..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading && <div className="browse-loading">Loading…</div>}

      {!loading && data && (
        <>
          {showSearch && (
            <Section title={`Search results (${data.searchResults.length})`}>
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

const Section = ({ title, children }) => (
  <section className="browse-section">
    <h3 className="browse-section-title">{title}</h3>
    {children}
  </section>
);

const BookRow = ({ books }) => {
  if (!books?.length) return <div className="browse-empty">No books</div>;

  return (
    <div className="book-row">
      {books.map((b) => (
        <Link key={b._id} to={`/books/${b._id}`} className="book-card">
          <div
            className="book-cover"
            style={{
              backgroundImage: `url(${b.cover || "/default-book.png"})`,
            }}
          />
        </Link>
      ))}
    </div>
  );
};

export default Browse;
