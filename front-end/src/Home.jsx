import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from './auth';
import BookCover from './BookCover';
import DistanceLabel from './DistanceLabel';
import LocationPrompt from './LocationPrompt';
import useReaderArea from './useReaderArea';

const Home = () => {
    const [books, setBooks] = useState([]);
    const screenRefs = useRef([]);
    const [showToast, setShowToast] = useState(false);
    // ISBNs on the reader's wishlist, so a book they already want is flagged
    // rather than offered to them again.
    const [wishlistIsbns, setWishlistIsbns] = useState(() => new Set());
    const area = useReaderArea();

    useEffect(() => {
        // Fetch real offered books from backend
        authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/feed`)
            .then(res => res.json())
            .then(data => {
                setBooks(data);
            })
            .catch(err => {
                // RequireAuth is already redirecting to the login page.
                if (isSessionExpiredError(err)) return;

                console.error("Failed to fetch books:", err);
                setBooks([]);
            });

        authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/wishlist`)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) setWishlistIsbns(new Set(data.map(b => b.isbn).filter(Boolean)));
            })
            .catch(err => {
                if (isSessionExpiredError(err)) return;
                console.error("Failed to fetch wishlist:", err);
            });
    }, []);

    const onWishlist = (book) => Boolean(book?.isbn) && wishlistIsbns.has(book.isbn);
   

    useEffect(() => {
        // Intersection Observer for the scroll reveal
        const callback = (entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-revealed');
                }
            });
        };

        const observer = new IntersectionObserver(callback, { threshold: 0.2 });

        screenRefs.current.forEach(screen => {
            if (screen) observer.observe(screen);
        });

        return () => observer.disconnect();
    }, [books]);

    const handleAddBook = (book) => {
        authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/add-wishlist-book`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(book)
        })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            console.log("Book added to wishlist:", data);
            if (book.isbn) setWishlistIsbns(prev => new Set(prev).add(book.isbn));
            setShowToast(true);
            setTimeout(() => setShowToast(false), 2000);
        })
        .catch(err => {
            if (isSessionExpiredError(err)) return;

            console.error("Error adding book to wishlist:", err);
        });
    };

    // The first book runs as the lead story; the rest sit on the grid below it.
    const [lead, ...rest] = books;

    return (
    <main className="page">
        <div className="page-head">
            <div className="page-head__main">
                <p className="kicker">Today's picks</p>
                <h1 className="page-title">Home</h1>
            </div>

            <div className="page-head__aside">
                <Link to="/browse" className="textlink-quiet">
                    Browse the full feed
                    <span className="textlink-arrow__mark" aria-hidden="true">&rarr;</span>
                </Link>
            </div>
        </div>

        <LocationPrompt area={area} />

        {/* success toast for adding book */}
        {showToast && (
        <div className="toast" role="status">
            Book added to wishlist
        </div>
        )}

        {books.length > 0 ? (
            <>
                <article
                    className="lead reveal"
                    ref={(el) => (screenRefs.current[0] = el)}
                >
                    <Link to={`/books/${lead._id}`} className="lead__cover cover">
                        <BookCover src={lead.cover} />
                    </Link>

                    <div className="lead__body">
                        <p className="kicker">Lead pick</p>

                        <h2 className="lead__title">
                            <Link to={`/books/${lead._id}`} className="headline-link">
                                {lead.title || "[NO TITLE]"}
                            </Link>
                        </h2>

                        <p className="lead__byline">
                            {lead.author || "[NO AUTHOR]"} &middot; {lead.year || "[NO DATE]"}
                        </p>
                        <DistanceLabel miles={lead.distanceMiles} block />

                        {lead.desc && <p className="prose lead__desc">{lead.desc}</p>}

                        <div className="button-row lead__actions">
                            {onWishlist(lead) ? (
                                <span className="tag">
                                    <span aria-hidden="true">&#10003;</span> On your wishlist
                                </span>
                            ) : (
                                <button
                                    className="button button--primary"
                                    onClick={() => handleAddBook(lead)}
                                >
                                    Add to Wishlist
                                </button>
                            )}

                            <Link to={`/books/${lead._id}`} className="button button--secondary">
                                View Details
                            </Link>
                        </div>
                    </div>
                </article>

                {rest.length > 0 && (
                    <section className="section">
                        <div className="section-head">
                            <h2 className="section-title">More in your feed</h2>
                            <span className="section-count">
                                {rest.length} {rest.length === 1 ? 'book' : 'books'}
                            </span>
                        </div>

                        <div className="book-grid">
                            {rest.map((book, index) => (
                                <article
                                    key={book._id || index}
                                    className="reveal"
                                    ref={(el) => (screenRefs.current[index + 1] = el)}
                                >
                                    <Link to={`/books/${book._id}`} className="book-tile">
                                        <span className="cover">
                                            <BookCover src={book.cover} />
                                        </span>

                                        <span className="book-tile__title">
                                            {book.title || "[NO TITLE]"}
                                        </span>

                                        <span className="book-tile__meta">
                                            {book.author || "[NO AUTHOR]"}
                                            <br />
                                            {book.year || "[NO DATE]"}
                                        </span>
                                        <DistanceLabel miles={book.distanceMiles} block />
                                    </Link>

                                    {onWishlist(book) ? (
                                        <span className="tile-action">
                                            <span className="tag">
                                                <span aria-hidden="true">&#10003;</span> On your wishlist
                                            </span>
                                        </span>
                                    ) : (
                                        <button
                                            className="button button--secondary button--small button--block tile-action"
                                            onClick={() => handleAddBook(book)}
                                        >
                                            Add to Wishlist
                                        </button>
                                    )}
                                </article>
                            ))}
                        </div>
                    </section>
                )}
            </>
        ) : (
            <p className="no-books">No books found in this genre.</p>
        )}
    </main>
    );

};

export default Home;
