import './Profile.css';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { authFetch, isSessionExpiredError } from './auth';
import {
  FaMapMarkerAlt,
  FaEnvelope,
  FaStar,
  FaBookOpen,
  FaAngleRight,
  FaAngleLeft
} from 'react-icons/fa';

const UserPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [user, setUser] = useState({});
  const [wishlistBooks, setWishlistBooks] = useState([]);
  const [offeredBooks, setOfferedBooks] = useState([]);

  const [fadeInClass, setFadeInClass] = useState({
    profile: 'fade-start',
    wishlist: 'fade-start',
    offerings: 'fade-start'
  });

  useEffect(() => {
    setTimeout(() => setFadeInClass(p => ({ ...p, profile: 'fade-in' })), 200);
    setTimeout(() => setFadeInClass(p => ({ ...p, wishlist: 'fade-in' })), 300);
    setTimeout(() => setFadeInClass(p => ({ ...p, offerings: 'fade-in' })), 500);
  }, []);

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}`)
      .then(res => res.json())
      .then(data => setUser(Array.isArray(data) ? data[0] : data))
      .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;
        setUser({});
      });

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}/wishlist`)
      .then(res => res.json())
      .then(setWishlistBooks)
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        setWishlistBooks([]);
      });

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/users/${id}/offered`)
      .then(res => res.json())
      .then(setOfferedBooks)
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        setOfferedBooks([]);
      });
  }, [id]);

  return (
    <div>
      <main className="profile">
        <button className="iconButton" onClick={() => navigate(-1)}>
            <FaAngleLeft />
        </button>
        <div className="titlebox">
          <h1 className="title">User</h1>
        </div>

        {/* Profile card */}
        <div className={`infoContainer ${fadeInClass.profile}`}>
          <div className="photoAndButton">
            <div className="profilePhoto">
              {(user?.username?.[0] || '?').toUpperCase()}
            </div>
          </div>

          <ul className="infoList">
            <li>
              <div className="infoRow">
                <span className="truncate usernameText">{user.username}</span>
              </div>
            </li>
            <li>
              <div className="infoRow">
                <FaEnvelope className="infoIcon" />
                <span className="truncate">{user.email}</span>
              </div>
            </li>
            <li>
              <div className="infoRow">
                <FaMapMarkerAlt className="infoIcon" />
                <span className="truncate">{user.location ?? 'N/A'}</span>
              </div>
            </li>
            <li>
              <div className="infoRow">
                <FaStar className="infoIcon" />
                <span className="truncate">{user.ratings}</span>
              </div>
            </li>
          </ul>
        </div>

        {/* Wishlist */}
        <div className={`wishlistContainer ${fadeInClass.wishlist}`}>
          <div className="sectionHeader">
            <div /> {/* placeholder for grid */}
            <h2 className="sectionTitle">Wishlist</h2>
            <Link to={`/users/${id}/wishlist`} className="iconButton">
              <FaAngleRight />
            </Link>
          </div>

          <ul className="wishlist">
            {wishlistBooks.length > 0 ? (
              wishlistBooks.slice(0, 4).map((book, i) => (
                <li key={i} className="wishlistItem">
                  <FaBookOpen className="bookIcon" />
                  <strong>{book.title}</strong>
                </li>
              ))
            ) : (
              <li>No items in wishlist</li>
            )}
          </ul>
        </div>

        {/* Offerings */}
        <div className={`offeringsContainer ${fadeInClass.offerings}`}>
          <div className="sectionHeader">
            <div /> {/* placeholder */}
            <h2 className="sectionTitle">Offerings</h2>
            <Link to={`/users/${id}/offered`} className="iconButton">
              <FaAngleRight />
            </Link>
          </div>

          <ul className="offerings">
            {offeredBooks.length > 0 ? (
              offeredBooks.slice(0, 4).map((book, i) => (
                <li key={i} className="offeringItem">
                  <FaBookOpen className="bookIcon" />
                  <strong>{book.title}</strong>
                </li>
              ))
            ) : (
              <li>No open offerings</li>
            )}
          </ul>
        </div>
      </main>
    </div>
  );
};

export default UserPage;
