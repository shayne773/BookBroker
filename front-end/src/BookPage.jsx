import { useParams, useNavigate, Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { authFetch, isSessionExpiredError } from './auth';
import BookCover from './BookCover';

const BookPage = () => {
  const { id } = useParams();
  const [book, setBook] = useState({});

  const [isInWishlist, setIsInWishlist] = useState(false);
  const navigate = useNavigate();

  const addToWishlist = () => {
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

    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/add-wishlist-book`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.error('Error:', err);
        alert('An error occurred. Please try again.');
      });
  };

  useEffect(() => {
    fetch(`${import.meta.env.VITE_SERVER_ADDRESS}/books/${id}`)
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
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/messages/${book.owner?.id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: `Hey, I'm interested in your listing for ${book.title}` })
    }).then((res) => {
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
      .then((data)=>navigate(`/messages/${book.owner?.id}`))
      .then(res => console.log(res))
      .catch((err) => {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.log("Failed to open conversation:", err)
        alert("Could not open conversation. Please try again.");
      })
  }
  useEffect(() => {
    if (book.isbn) {
      authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/wishlist/${book.isbn}`)
        .then(res => res.json())
        .then(data => setIsInWishlist(data.exists))
        .catch(err => {
          console.error('Error checking wishlist status:', err);
        });
    }
  }, [book.isbn]);

  return (
    <main className="page page--reading">
      <button className="back-link" onClick={() => navigate(-1)}>
        <span className="back-link__mark" aria-hidden="true">&larr;</span>
        Back
      </button>

      <article className="book">
        <header className="book__head">
          <p className="kicker">{book.genre || "[NO GENRE]"}</p>

          <h1 className="book__title">{book.title || "[NO TITLE]"}</h1>

          <p className="book__byline">
            {book.author || "[NO AUTHOR]"}, {book.year || "[NO DATE]"}
          </p>
        </header>

        <div className="book__body">
          <div className="book__aside">
            <div className="cover">
              <BookCover src={book.cover} />
            </div>

            <div className="book__actions">
              {isInWishlist ? (
                <p className="notice" role="status">
                  <span aria-hidden="true">&#10003;</span> In your wishlist
                </p>
              ) : (
                <button className="button button--primary button--block" onClick={addToWishlist}>
                  Add to Wishlist
                </button>
              )}

              <button
                className="button button--secondary button--block"
                onClick={openConversationWithOwner}
              >
                Contact Owner
              </button>
            </div>
          </div>

          <div className="book__main">
            <section className="book__section">
              <h2 className="fact__term">Offered by</h2>
              <p className="fact__value">
                <Link to={`/users/${book.owner?.id}`} className="textlink">
                  {book.owner?.username || "[NO USER]"}
                </Link>
              </p>
            </section>

            <section className="book__section">
              <h2 className="fact__term">About this book</h2>
              <p className="prose">{book.desc || "[NO DESC]"}</p>
            </section>

            <section className="book__section">
              <div className="facts facts--pair">
                <div>
                  <h2 className="fact__term">ISBN</h2>
                  <p className="fact__value">{book.isbn || "[NO ISBN]"}</p>
                </div>

                <div>
                  <h2 className="fact__term">Genre</h2>
                  <p className="fact__value">{book.genre || "[NO GENRE]"}</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </article>
    </main>
  );
};

export default BookPage;
