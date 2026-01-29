import './Profile/MyBooks.css';
import { useEffect, useState } from 'react';
import { FaBookOpen, FaAngleLeft } from 'react-icons/fa';
import { useNavigate, useParams } from 'react-router-dom';

const UserPageWishlist = () => {
  const { id } = useParams(); // user id
  const navigate = useNavigate();
  const [wishlistBooks, setWishlistBooks] = useState([]);

  const token = localStorage.getItem('token');

  useEffect(() => {
    fetch(`${process.env.REACT_APP_SERVER_ADDRESS}/users/${id}/wishlist`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setWishlistBooks(data))
      .catch(err => {
        console.error('Failed to fetch user wishlist:', err);
        setWishlistBooks([]);
      });
  }, [id, token]);

  return (
    <div>
      <main className="profile">

        <div className="mybooksContainer fade-in">
            <div className="titlebox mybooksTitlebox">
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
              wishlistBooks.map(book => (
                <li key={book._id || book.isbn} className="wishlistItem">
                  <FaBookOpen className="bookIcon" />
                  <strong>{book.title}</strong>
                </li>
              ))
            ) : (
              <li>No items in wishlist</li>
            )}
          </ul>
        </div>

      </main>
    </div>
  );
};

export default UserPageWishlist;
