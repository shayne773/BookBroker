import './Profile.css';
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Popup from 'reactjs-popup';
import { authFetch, clearSession, isSessionExpiredError } from './auth';
import { FaMapMarkerAlt, FaEnvelope, FaStar, FaBookOpen, FaPlus, FaAngleRight } from 'react-icons/fa';

const fetchBooksFromGoogle = async (query) => {
  const response = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}`
  );

  // If rate limited etc, throw so UI shows message
  if (!response.ok) {
    throw new Error(`Google Books HTTP ${response.status}`);
  }

  const data = await response.json();
  const items = data.items || [];

  return items.map(item => ({
    title: item.volumeInfo?.title || '',
    author: item.volumeInfo?.authors?.join(', ') || 'Unknown',
    publisher: item.volumeInfo?.publisher || 'Unknown',
    year: item.volumeInfo?.publishedDate?.substring(0, 4) || '',
    cover: item.volumeInfo?.imageLinks?.thumbnail || '',
    isbn: item.volumeInfo?.industryIdentifiers?.[0]?.identifier || '',
    genre: item.volumeInfo?.categories?.[0] || 'Unknown',
    desc: item.volumeInfo?.description || ''
  }));
};

const Profile = () => {
  const navigate = useNavigate();
  const userId = localStorage.getItem('userId');

  const [user, setUser] = useState({});
  const [wishlistBooks, setWishlistBooks] = useState([]);
  const [offeredBooks, setOfferedBooks] = useState([]);

  const [fadeInClass, setFadeInClass] = useState({
    profile: 'fade-start',
    wishlist: 'fade-start',
    offerings: 'fade-start'
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddOfferingsModal, setShowAddOfferingsModal] = useState(false);

  const [showToastWishlist, setShowToastWishlist] = useState(false);
  const [showToastOfferings, setShowToastOfferings] = useState(false);

  // Wishlist search
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [isTypingWishlist, setIsTypingWishlist] = useState(false);
  const [isSearchingWishlist, setIsSearchingWishlist] = useState(false);
  const [googleErrorWishlist, setGoogleErrorWishlist] = useState("");

  // Offerings search
  const [searchTextOffer, setSearchTextOffer] = useState("");
  const [searchResultsOffer, setSearchResultsOffer] = useState([]);
  const [selectedBookOffer, setSelectedBookOffer] = useState(null);
  const [isTypingOffer, setIsTypingOffer] = useState(false);
  const [isSearchingOffer, setIsSearchingOffer] = useState(false);
  const [googleErrorOffer, setGoogleErrorOffer] = useState("");

  // Edit profile fields
  const [location, setLocation] = useState('');
  const [customLocation, setCustomLocation] = useState('');

  const fetchUserData = () => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user?id=${userId}`)
      .then(res => res.json())
      .then(data => setUser(data))
      .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;
        console.log('Failed to fetch user:', err);
      });
  };

  useEffect(() => {
    setTimeout(() => setFadeInClass(prev => ({ ...prev, profile: 'fade-in' })), 200);
    setTimeout(() => setFadeInClass(prev => ({ ...prev, wishlist: 'fade-in' })), 300);
    setTimeout(() => setFadeInClass(prev => ({ ...prev, offerings: 'fade-in' })), 500);
  }, []);

  useEffect(() => {
    fetchUserData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/wishlist`)
      .then(res => res.json())
      .then(data => setWishlistBooks(data))
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.log("Failed to fetch wishlist:", err);
      });

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/offered`)
      .then(res => res.json())
      .then(data => setOfferedBooks(data))
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.log("Failed to fetch offerings", err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wishlist search effect
  useEffect(() => {
    if (!isTypingWishlist) return;

    const q = searchText.trim();
    setGoogleErrorWishlist("");

    if (q.length < 3) {
      setSearchResults([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setIsSearchingWishlist(true);
        const results = await fetchBooksFromGoogle(q);
        setSearchResults(results);
      } catch (err) {
        console.error(err);
        setSearchResults([]);
        const msg = String(err.message || "");
        setGoogleErrorWishlist(
          msg.includes("429")
            ? "Google Books rate limit hit. Please wait ~1–2 minutes and try again."
            : "Google Books search failed."
        );
      } finally {
        setIsSearchingWishlist(false);
      }
    }, 500);

    return () => clearTimeout(t);
  }, [searchText, isTypingWishlist]);

  // Offerings search effect
  useEffect(() => {
    if (!isTypingOffer) return;

    const q = searchTextOffer.trim();
    setGoogleErrorOffer("");

    if (q.length < 3) {
      setSearchResultsOffer([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setIsSearchingOffer(true);
        const results = await fetchBooksFromGoogle(q);
        setSearchResultsOffer(results);
      } catch (err) {
        console.error(err);
        setSearchResultsOffer([]);
        const msg = String(err.message || "");
        setGoogleErrorOffer(
          msg.includes("429")
            ? "Google Books rate limit hit. Please wait ~1–2 minutes and try again."
            : "Google Books search failed."
        );
      } finally {
        setIsSearchingOffer(false);
      }
    }, 500);

    return () => clearTimeout(t);
  }, [searchTextOffer, isTypingOffer]);

  const handleAddBook = (e) => {
    e.preventDefault();
    if (!selectedBook) return;

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/add-wishlist-book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selectedBook)
    })
      .then(res => res.json())
      .then(() => {
        setShowToastWishlist(true);
        setTimeout(() => setShowToastWishlist(false), 2000);
        setShowAddModal(false);

        // reset modal state
        setSelectedBook(null);
        setSearchText("");
        setSearchResults([]);
        setIsTypingWishlist(false);
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error(err);
      });
  };

  const handleAddOffering = (e) => {
    e.preventDefault();
    if (!selectedBookOffer) return;

    const payload = { ...selectedBookOffer, owner: userId };

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/add-offered-book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(() => {
        setShowToastOfferings(true);
        setTimeout(() => setShowToastOfferings(false), 2000);
        setShowAddOfferingsModal(false);

        // reset modal state
        setSelectedBookOffer(null);
        setSearchTextOffer("");
        setSearchResultsOffer([]);
        setIsTypingOffer(false);
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error(err);
      });
  };

  const handleProfileEdit = (e, close) => {
    e.preventDefault();
    const username = e.target.username.value;
    const email = e.target.email.value;
    const finalLocation = location === 'Other' ? customLocation : location;

    const data = { user: { username, email, location: finalLocation } };

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
      .then(res => res.json())
      .then(() => {
        fetchUserData();
        close();
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error(err);
      });
  };

  const handleLogout = () => {
    fetch(`${import.meta.env.VITE_SERVER_ADDRESS}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
      .catch(err => console.error("Logout error:", err))
      .finally(() => {
        // The local session goes either way; the server call is best effort.
        clearSession();
        navigate('/login', { replace: true });
      });
  };

  // Close + reset wishlist modal
  const closeWishlistModal = () => {
    setShowAddModal(false);
    setSearchResults([]);
    setGoogleErrorWishlist("");
    setIsTypingWishlist(false);
  };

  // Close + reset offerings modal
  const closeOfferModal = () => {
    setShowAddOfferingsModal(false);
    setSearchResultsOffer([]);
    setGoogleErrorOffer("");
    setIsTypingOffer(false);
  };

  return (
    <div>
      <main className="profile">
        <div className="titlebox">
          <h1 className="title">Profile</h1>
        </div>

        <div className={`infoContainer ${fadeInClass.profile}`}>
          <div className="photoAndButton">
            <div className="profilePhoto">
              {(user?.username?.[0] || "?").toUpperCase()}
            </div>
            <div className="profile-buttons">
              <Popup trigger={<button className="editProfileBtn">Edit Profile</button>} modal>
                {(close) => (
                  <div className="edit-popup">
                    <form onSubmit={(e) => handleProfileEdit(e, close)}>
                      <div className="form-group">
                        <label htmlFor="username">Enter username:</label>
                        <input type="text" name="username" id="username" />
                      </div>

                      <div className="form-group">
                        <label htmlFor="email">Enter email:</label>
                        <input type="text" name="email" id="email" />
                      </div>

                      <div className="form-group">
                        <label htmlFor="location">Select city:</label>
                        <select
                          id="location"
                          name="location"
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                        >
                          <option value="">--Choose a city--</option>
                          <option value="New York">New York, NY</option>
                          <option value="Los Angeles">Los Angeles, CA</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>

                      {location === 'Other' && (
                        <div className="edit-profile-custom-location">
                          <label htmlFor="customLocation">Enter your city:</label>
                          <input
                            type="text"
                            id="customLocation"
                            name="customLocation"
                            value={customLocation}
                            onChange={(e) => setCustomLocation(e.target.value)}
                            required
                          />
                        </div>
                      )}

                      <button type="submit" className="editProfileBtn">Submit</button>
                    </form>
                  </div>
                )}
              </Popup>

              <button className="editProfileBtn logout-button" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>

          <ul className="infoList">
            <li><div className="infoRow"><span className="truncate usernameText">{user.username}</span></div></li>
            <li><div className="infoRow"><FaEnvelope className="infoIcon" /><span className="truncate">{user.email}</span></div></li>
            <li><div className="infoRow"><FaMapMarkerAlt className="infoIcon" /><span className="truncate">{user.location ?? 'N/A'}</span></div></li>
            <li><div className="infoRow"><FaStar className="infoIcon" /><span className="truncate">{user.ratings}</span></div></li>
          </ul>
        </div>

        <div className={`wishlistContainer ${fadeInClass.wishlist}`}>
          <div className="sectionHeader">
            <button className="iconButton" onClick={() => setShowAddModal(true)}><FaPlus /></button>
            <h2 className="sectionTitle">Wishlist</h2>
            <Link to="/profile/my-books" className="iconButton"><FaAngleRight /></Link>
          </div>

          <ul className="wishlist">
            {wishlistBooks.length > 0 ? wishlistBooks.slice(0, 4).map((book) => (
              <li key={book._id || book.isbn} className="wishlistItem">
                <FaBookOpen className="bookIcon" />
                <strong>{book.title}</strong>
              </li>
            )) : <li>Loading wishlist...</li>}
          </ul>
        </div>

        <div className={`offeringsContainer ${fadeInClass.offerings}`}>
          <div className="sectionHeader">
            <button className="iconButton" onClick={() => setShowAddOfferingsModal(true)}><FaPlus /></button>
            <h2 className="sectionTitle">Offerings</h2>
            <Link to="/profile/my-trades" className="iconButton"><FaAngleRight /></Link>
          </div>

          <ul className="offerings">
            {offeredBooks.length > 0 ? offeredBooks.slice(0, 4).map((book) => (
              <li key={book._id || book.isbn} className="offeringItem">
                <FaBookOpen className="bookIcon" />
                <strong>{book.title}</strong>
              </li>
            )) : <li>Loading offerings...</li>}
          </ul>
        </div>
      </main>

      {/* Wishlist modal */}
      {showAddModal && (
        <div className="modalOverlay" onClick={closeWishlistModal}>
          <div className="modalSheet" onClick={(e) => e.stopPropagation()}>
            <h2>Add Book to Wishlist</h2>
            <form onSubmit={handleAddBook}>
              <div className="modalFields">
                <div className="fieldRow" style={{ position: 'relative' }}>
                  <label>Search Book:</label>
                  <input
                    type="text"
                    value={searchText}
                    onChange={(e) => {
                      setSearchText(e.target.value);
                      setIsTypingWishlist(true);
                    }}
                    placeholder="Type book name..."
                  />

                  {isSearchingWishlist && <div className="search-hint">Searching…</div>}
                  {googleErrorWishlist && <div className="search-error">{googleErrorWishlist}</div>}

                  {searchResults.length > 0 && (
                    <ul className="search-dropdown">
                      {searchResults.map((book, idx) => (
                        <li
                          key={idx}
                          onClick={() => {
                            setSelectedBook(book);
                            setSearchText(book.title);
                            setSearchResults([]);
                            setIsTypingWishlist(false);
                          }}
                        >
                          <img src={book.cover} alt="cover" width="40" style={{ borderRadius: 8 }} />
                          <span>{book.title} — {book.author}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <button type="submit" className="editProfileBtn" disabled={!selectedBook}>
                Add
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Offerings modal */}
      {showAddOfferingsModal && (
        <div className="modalOverlay" onClick={closeOfferModal}>
          <div className="modalSheet" onClick={(e) => e.stopPropagation()}>
            <h2>Add Book to Offerings</h2>
            <form onSubmit={handleAddOffering}>
              <div className="modalFields">
                <div className="fieldRow" style={{ position: 'relative' }}>
                  <label>Search Book:</label>
                  <input
                    type="text"
                    value={searchTextOffer}
                    onChange={(e) => {
                      setSearchTextOffer(e.target.value);
                      setIsTypingOffer(true);
                    }}
                    placeholder="Type book name..."
                  />

                  {isSearchingOffer && <div className="search-hint">Searching…</div>}
                  {googleErrorOffer && <div className="search-error">{googleErrorOffer}</div>}

                  {searchResultsOffer.length > 0 && (
                    <ul className="search-dropdown">
                      {searchResultsOffer.map((book, idx) => (
                        <li
                          key={idx}
                          onClick={() => {
                            setSelectedBookOffer(book);
                            setSearchTextOffer(book.title);
                            setSearchResultsOffer([]);
                            setIsTypingOffer(false);
                          }}
                        >
                          <img src={book.cover} alt="cover" width="40" style={{ borderRadius: 8 }} />
                          <span>{book.title} — {book.author}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <button type="submit" className="editProfileBtn" disabled={!selectedBookOffer}>
                Add
              </button>
            </form>
          </div>
        </div>
      )}

      {showToastWishlist && <div className="toast-success-wishlist">Book added to wishlist!</div>}
      {showToastOfferings && <div className="toast-success-offerings">Book added to offerings!</div>}
    </div>
  );
};

export default Profile;