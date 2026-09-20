import './MyBooks.css';
import { useEffect, useState } from 'react';
import { FaBookOpen, FaTrash, FaAngleLeft } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from '../auth';

const MyBooks = () => {
  const [wishlistBooks, setWishlistBooks] = useState([]);
  const navigate = useNavigate(); // ✅ add this

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/wishlist`)
      .then(res => res.json())
      .then(data => setWishlistBooks(data))
      .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.log("Failed to fetch wishlist:", err);
        setWishlistBooks([]);
      });
  }, []);

  const handleDelete = (bookId) => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/wishlist/${bookId}`, {
      method: "DELETE"
    })
      .then(res => {
        if (res.ok) setWishlistBooks(prev => prev.filter(b => b._id !== bookId));
        else console.error("Failed to delete book from wishlist");
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error("Error deleting book:", err);
      });
  };

  return (
    <div>
      <main className="profile">
        <div className="mybooksContainer fade-in">
          <div className="titlebox mybooksTitlebox">
            {/* ✅ Back button like BookPage */}
            <button
              className="iconButton backButton"
              onClick={() => navigate(-1)}
              aria-label="Back"
              type="button"
            >
              <FaAngleLeft />
            </button>

            <h1 className="title">Wishlist</h1>
          </div>

          <ul className="wishlist">
            {wishlistBooks.length > 0 ? (
              wishlistBooks.map((book) => (
                <li key={book._id} className="wishlistItem">
                  <FaBookOpen className="bookIcon" />
                  <strong>{book.title}</strong>
                  <button className="deleteButton" onClick={() => handleDelete(book._id)}>
                    <FaTrash />
                  </button>
                </li>
              ))
            ) : (
              <li>Loading wishlist...</li>
            )}
          </ul>
        </div>
      </main>
    </div>
  );
};

export default MyBooks;
