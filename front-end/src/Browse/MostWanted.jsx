import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import BookList from './BookList';
import { authFetch } from '../auth';

const MostWanted = () => {
    const [books, setBooks] = useState([]);

    useEffect(() => {
        authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/popular`)
            .then(res => res.json())
            .then(data => setBooks(data))
            .catch(err => {
                console.error("Failed to fetch most wanted books:", err);
                setBooks([]);
            });
    }, []);

    return (
        <main className="page page--reading">
            <div className="page-head">
                <div className="page-head__main">
                    <p className="kicker">Browse</p>
                    <h1 className="page-title">Most wanted</h1>
                </div>

                <div className="page-head__aside">
                    <Link to="/browse" className="textlink-quiet">
                        <span className="textlink-arrow__mark textlink-arrow__mark--back" aria-hidden="true">&larr;</span>
                        All of Browse
                    </Link>
                </div>
            </div>

            <BookList books={books} emptyLabel="No books on the market yet." />
        </main>
    );
};

export default MostWanted;
