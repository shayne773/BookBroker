import './Profile/MyTrades.css';
import { useEffect, useState } from 'react';
import { FaBookOpen, FaAngleLeft } from 'react-icons/fa';
import { useNavigate, useParams } from 'react-router-dom';

const UserPageOffered = () => {
  const { id } = useParams(); // user id
  const navigate = useNavigate();
  const [offeredBooks, setOfferedBooks] = useState([]);

  const token = localStorage.getItem('token');

  useEffect(() => {
    fetch(`${process.env.REACT_APP_SERVER_ADDRESS}/users/${id}/offered`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => setOfferedBooks(data))
      .catch(err => {
        console.error('Failed to fetch user offerings:', err);
        setOfferedBooks([]);
      });
  }, [id, token]);

  return (
    <div>
      <main className="profile">
        <div className="titlebox myTradesTitlebox">
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
        <div className="mytradesContainer fade-in">
          <ul className="offerings">
            {offeredBooks.length > 0 ? (
              offeredBooks.map(book => (
                <li key={book._id || book.isbn} className="offeringItem">
                  <FaBookOpen className="bookIcon" />
                  <strong>{book.title}</strong>
                </li>
              ))
            ) : (
              <li>No offerings</li>
            )}
          </ul>
        </div>

      </main>
    </div>
  );
};

export default UserPageOffered;
