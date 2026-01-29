import './BookPage.css';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { FaAngleLeft } from 'react-icons/fa';

const BookPage = () => {
  const { id } = useParams();
  const [book, setBook] = useState({});

  const [isInWishlist, setIsInWishlist] = useState(false);
  const navigate = useNavigate();
  const token = localStorage.getItem('token');
  const userId = localStorage.getItem("userId");

  const addToWishlist = () => {
    if (!token) {
      alert("You must be logged in to add a book to your wishlist.");
      return;
    }

    const bookData = {
      title: book.title,
      author: book.author,
      publisher: book.publisher,
      year: book.year,
      cover: book.cover,
      isbn: book.isbn,
      genre: book.genre,
      desc: book.desc
    };

    fetch(`${process.env.REACT_APP_SERVER_ADDRESS}/user/add-wishlist-book`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(bookData)
    })
      .then(res => res.json())
      .then(data => {
        if (data.message) {
          console.log('Book added to wishlist successfully!');
          setIsInWishlist(true);
        } else {
          console.log('Failed to add book to wishlist.');
        }
      })
      .catch(err => {
        console.error('Error:', err);
        alert('An error occurred. Please try again.');
      });
  };

  useEffect(() => {
    fetch(`${process.env.REACT_APP_SERVER_ADDRESS}/books/${id}`)
      .then(res => res.json())
      .then(data => {
        setBook(data);
      })
      .catch(err => {
        console.error('Failed to fetch book:', err);
        setBook({});
      });
  }, [id]);

  async function openConversationWithOwner() {
    fetch(`${process.env.REACT_APP_SERVER_ADDRESS}/messages/${book.owner?.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ content: `Hey, I'm interested in your listing for ${book.title}` })
    }).then((res) => {
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
      .then((data)=>navigate(`/messages/${book.owner?.id}`))
      .then(res => console.log(res))
      .catch((err) => {
        console.log("Failed to open conversation:", err)
        alert("Could not open conversation. Please try again.");
      })
  }
  useEffect(() => {
    if (book.isbn && token) {
      fetch(`${process.env.REACT_APP_SERVER_ADDRESS}/user/wishlist/${book.isbn}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
        .then(res => res.json())
        .then(data => setIsInWishlist(data.exists))
        .catch(err => {
          console.error('Error checking wishlist status:', err);
        });
    }
  }, [book.isbn, token]);

  return (
    <main className="BookPage page-slide-in">
      <div className="bookpage-header">
        <button className="iconButton backButton" onClick={() => navigate(-1)}>
          <FaAngleLeft />
        </button>
      </div>

      <div className="book-title-section">
        <img
          src={book.cover || 'https://via.placeholder.com/128x192?text=No+Cover'}
          alt="book"
        />
        <div className="book-info-section">
          <h1 className="book-title">{book.title || "[NO TITLE]"}</h1>
          <h3 className="book-author">
            {book.author || "[NO AUTHOR]"}, {book.year || "[NO DATE]"}
          </h3>
          <h2 className="book-owner">
            Offered by:
            <Link to={`/users/${book.owner?.id}`}>
              {book.owner?.username || "[NO USER]"}
            </Link>
          </h2>
        </div>
      </div>

      <div className="book-page-actions">
        {isInWishlist ? (
          <div className="wishlist-pill">
            ✓ In your wishlist
          </div>
        ) : (
          <button className="book-action-btn wishlist-btn" onClick={addToWishlist}>
            Add to Wishlist
          </button>
        )}
        <button className="book-action-btn contact-btn" onClick={openConversationWithOwner}>
          Contact Owner
        </button>
      </div>

      <div className="book-description-section">
        <h1 className="about-this-book">About this book</h1>
        <p>{book.desc || "[NO DESC]"}</p>
      </div>

      <div className="isbn-section">
        <h1 className="isbn-header">ISBN</h1>
        <h3 className="book-isbn">{book.isbn || "[NO ISBN]"}</h3>
      </div>

      <div className="genre-section">
        <h1 className="genre-header">Genre</h1>
        <h3 className="book-genre">{book.genre || "[NO GENRE]"}</h3>
      </div>
    </main>
  );
};

export default BookPage;
