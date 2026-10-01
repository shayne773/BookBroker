import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from './auth';
import BookCover from './BookCover';
import DistanceLabel from './DistanceLabel';
import LocationPrompt from './LocationPrompt';
import useReaderArea from './useReaderArea';
import Feedback, { DoneButton } from './Feedback';
import useFeedback from './useFeedback';
import useAccountPrompt from './useAccountPrompt';
import Appear from './Appear';
import { BookGridSkeleton, LeadSkeleton } from './Skeletons';

const Home = () => {
    // null until the feed has answered.
    const [books, setBooks] = useState(null);
    // The books being added to the wishlist, and the one whose add failed, which
    // says so under its button.
    const [addingIds, setAddingIds] = useState(() => new Set());
    const [failedId, setFailedId] = useState(null);
    const { feedback, fail, clear } = useFeedback();
    // ISBNs on the reader's wishlist, so a book they already want is flagged
    // rather than offered to them again.
    const [wishlistIsbns, setWishlistIsbns] = useState(() => new Set());
    const area = useReaderArea();
    const { signedIn, gate } = useAccountPrompt();

    useEffect(() => {
        // Nearby books for a reader; every book on the market for a visitor.
        authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/feed`)
            .then(res => res.json())
            .then(data => {
                setBooks(Array.isArray(data) ? data : []);
            })
            .catch(err => {
                // RedirectOnSessionEnd is already redirecting to the login page.
                if (isSessionExpiredError(err)) return;

                console.error("Failed to fetch books:", err);
                setBooks([]);
            });

        // A visitor has no wishlist.
        if (!signedIn) return;
        authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/wishlist`)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) setWishlistIsbns(new Set(data.map(b => b.isbn).filter(Boolean)));
            })
            .catch(err => {
                if (isSessionExpiredError(err)) return;
                console.error("Failed to fetch wishlist:", err);
            });
    }, [signedIn]);

    const onWishlist = (book) => Boolean(book?.isbn) && wishlistIsbns.has(book.isbn);
   

    const handleAddBook = (book) => {
        setAddingIds(prev => new Set(prev).add(book._id));
        setFailedId(null);
        clear();
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
        .then(() => {
            if (book.isbn) setWishlistIsbns(prev => new Set(prev).add(book.isbn));
        })
        .catch(err => {
            if (isSessionExpiredError(err)) return;

            console.error("Error adding book to wishlist:", err);
            setFailedId(book._id);
            fail("This book couldn't be added. Please try again.");
        })
        .finally(() => setAddingIds(prev => {
            const next = new Set(prev);
            next.delete(book._id);
            return next;
        }));
    };

    // Add to Wishlist, which turns into "On your wishlist" once it is.
    const wishlistButton = (book, className) => (
        <DoneButton
            className={className}
            done={onWishlist(book)}
            doneLabel="On your wishlist"
            busy={addingIds.has(book._id)}
            busyLabel="Adding…"
            onClick={gate('add books to your wishlist', () => handleAddBook(book))}
        >
            Add to Wishlist
        </DoneButton>
    );

    const bookFeedback = (book) => <Feedback feedback={failedId === book._id ? feedback : null} />;

    // The first book runs as the lead story; the rest sit on the grid below it.
    const [lead, ...rest] = books ?? [];

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

        <Appear
            ready={books !== null}
            placeholder={
                <>
                    <LeadSkeleton />
                    <div className="section">
                        <BookGridSkeleton />
                    </div>
                </>
            }
        >
        {lead ? (
            <>
                <article className="lead rise">
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
                            {wishlistButton(lead, "button button--primary")}

                            <Link to={`/books/${lead._id}`} className="button button--secondary">
                                View Details
                            </Link>
                        </div>
                        {bookFeedback(lead)}
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
                                <article key={book._id || index}>
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

                                    <span className="tile-action">
                                        {wishlistButton(book, "button button--secondary button--small button--block")}
                                    </span>
                                    {bookFeedback(book)}
                                </article>
                            ))}
                        </div>
                    </section>
                )}
            </>
        ) : (
            <p className="no-books">No books found in this genre.</p>
        )}
        </Appear>
    </main>
    );

};

export default Home;
