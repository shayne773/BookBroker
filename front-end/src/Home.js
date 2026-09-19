import { useState, useEffect, useRef } from 'react';
import './Home.css';
import { Link } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from './auth';

const Home = () => {
    const [books, setBooks] = useState([]);
    const [user, setUser] = useState(null);
    const screenRefs = useRef([]);
    const [showToast, setShowToast] = useState(false);


    const userId = localStorage.getItem('userId');


    useEffect(() => {
        // Fetch real offered books from backend
        authFetch(`${process.env.REACT_APP_SERVER_ADDRESS}/feed`)
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
    }, []);
   

    useEffect(() => {
        // Fetch real user data
        if (userId) {
            authFetch(`${process.env.REACT_APP_SERVER_ADDRESS}/user?id=${userId}`)
            .then(res => res.json())
            .then(data => {
                setUser(data);
            })
            .catch(err => {
                if (isSessionExpiredError(err)) return;

                console.error('Failed to fetch user:', err);
                setUser(null);
            });
        }
    }, [userId]);

    useEffect(() => {
        // Intersection Observer for fade-in
        const callback = (entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('fade-in');
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
        authFetch(`${process.env.REACT_APP_SERVER_ADDRESS}/user/add-wishlist-book`, {
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
            setShowToast(true);
            setTimeout(() => setShowToast(false), 2000);
        })
        .catch(err => {
            if (isSessionExpiredError(err)) return;

            console.error("Error adding book to wishlist:", err);
        });
    };

    return (
    <main className="Home">
        <div className="home-header">
        <div className="titlebox">
            <h1 className="title">Home</h1>
        </div>

        <div className="home-header-message">
            <h3 className="subtle">Today's picks</h3>

            <Link to="/browse" className="home-cta">
            Browse the full feed →
            </Link>
        </div>
        </div>

        {/* success toast for adding book */}
        {showToast && (
        <div className="toast-success">
            Book added to wishlist!
        </div>
        )}

        <div>
        {books.length > 0 ? (
            books.map((book, index) => (
            <div
                key={book._id || index}
                className="home-book-screen fade-start"
                ref={(el) => (screenRefs.current[index] = el)}
            >
                <div className="home-book-wrapper">
                <div
                    className="home-book-blur"
                    style={{
                    backgroundImage: `url(${book.cover || '/default-book.png'})`
                    }}
                />

                <Link to={`/books/${book._id}`} className="home-book-link">
                    <img
                    src={book.cover || "/default-book.png"}
                    alt="Book Cover"
                    className="home-book-image"
                    />
                    <div className="home-book-info-centered">
                    <p className="home-book-title">{book.title || "[NO TITLE]"}</p>
                    <p className="home-book-year">{book.year || "[NO DATE]"}</p>
                    <p className="home-book-author">{book.author || "[NO AUTHOR]"}</p>
                    </div>
                </Link>

                <div className="home-book-actions">
                    <button
                    className="home-book-btn wishlist-btn"
                    onClick={() => handleAddBook(book)}
                    >
                    Add to Wishlist
                    </button>

                    <Link to={`/books/${book._id}`}>
                    <button className="home-book-btn details-btn">
                        View Details
                    </button>
                    </Link>
                </div>
                </div>
            </div>
            ))
        ) : (
            <p className="no-books">No books found in this genre.</p>
        )}
        </div>
    </main>
    );

};

export default Home;
