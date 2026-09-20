import './PopularNow.css';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';

const PopularNow = () => {
    const [books, setBooks] = useState([]);

    useEffect(() => {
        fetch(`${import.meta.env.VITE_SERVER_ADDRESS}/popular`)
            .then(res => res.json())
            .then(data => setBooks(data))
            .catch(err => {
                console.error("Failed to fetch popular books:", err);
                setBooks([]);
            });
    }, []);

    return (
        <main className="PopularNow">
            <h1 className="popular-title">Popular Now</h1>

            <div className="popular-books">
                {books.length > 0 ? (
                    books.map((book) => (
                        <div key={book._id || book.id} className="popular-book">
                            <img
                                src={book.cover || '/default-book.png'}
                                alt="Book Cover"
                            />

                            <div className="popular-book-text">
                                <h2>{book.title || "[NO TITLE]"}</h2>
                                <p>{book.year || "[NO DATE]"}</p>
                                <p>{book.author || "[NO AUTHOR]"}</p>
                            </div>

                            <Link to={`/books/${book._id || book.id}`}>
                                <button className="interest-btn">Show Interest</button>
                            </Link>
                        </div>
                    ))
                ) : (
                    <p className="no-books">No popular books found.</p>
                )}
            </div>
        </main>
    );
};

export default PopularNow;