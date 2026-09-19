import './MyTrades.css';
import { useEffect, useState } from 'react';
import { FaBookOpen, FaTrash, FaAngleLeft } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { authFetch, isSessionExpiredError } from '../auth';

const MyTrades = () => {
  const [offeringsBooks, setOfferingsBooks] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    authFetch(`${process.env.REACT_APP_SERVER_ADDRESS}/user/offered`)
      .then(res => res.json())
      .then(data => setOfferingsBooks(data))
      .catch(err => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.log("Failed to fetch offerings:", err);
        setOfferingsBooks([]);
      });
  }, []);

  const handleDelete = (bookId) => {
    authFetch(`${process.env.REACT_APP_SERVER_ADDRESS}/user/offered/${bookId}`, {
      method: "DELETE"
    })
      .then(res => {
        if (res.ok) {
          setOfferingsBooks(prev => prev.filter(book => book._id !== bookId));
        } else {
          console.error("Failed to delete book from offerings");
        }
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error("Error deleting book:", err);
      });
  };

  return (
    <div>
      <main className="profile">
        <div className="mytradesContainer fade-in">
          <div className="titlebox mytradesTitlebox">
            <button
              className="iconButton backButton"
              onClick={() => navigate(-1)}
              aria-label="Back"
              type="button"
            >
              <FaAngleLeft />
            </button>

            <h1 className="title">Offerings</h1>
          </div>

          <ul className="offerings">
            {offeringsBooks.length > 0 ? (
              offeringsBooks.map((book) => (
                <li key={book._id} className="offeringItem">
                  <FaBookOpen className="bookIcon" />
                  <strong>{book.title}</strong>
                  <button className="deleteButton" onClick={() => handleDelete(book._id)}>
                    <FaTrash />
                  </button>
                </li>
              ))
            ) : (
              <li>Loading Offerings...</li>
            )}
          </ul>
        </div>
      </main>
    </div>
  );
};

export default MyTrades;
