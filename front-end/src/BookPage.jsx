import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { authFetch, isSessionExpiredError } from './auth';
import BookCover from './BookCover';
import { formatDistance } from './distance';
import Feedback, { DoneButton } from './Feedback';
import useFeedback from './useFeedback';
import UserLink from './UserLink';
import PhotoGallery from './PhotoGallery';
import PhotoManager from './PhotoManager';
import ReportDialog from './UserPage/ReportDialog';
import useAccountPrompt from './useAccountPrompt';

const BookPage = () => {
  const { id } = useParams();
  const [book, setBook] = useState({});
  const [notFound, setNotFound] = useState(false);

  const [isInWishlist, setIsInWishlist] = useState(false);
  const [adding, setAdding] = useState(false);
  const [reporting, setReporting] = useState(false);
  // How the last action here went, under the buttons.
  const { feedback, done, fail, clear } = useFeedback();
  const photos = book.photos || [];
  const setPhotos = (next) => setBook((current) => ({ ...current, photos: next }));
  const navigate = useNavigate();
  const { signedIn, gate } = useAccountPrompt();

  const addToWishlist = async () => {
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

    setAdding(true);
    clear();
    try {
      const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/add-wishlist-book`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bookData)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setIsInWishlist(true);
    } catch (err) {
      // RedirectOnSessionEnd is already redirecting to the login page.
      if (isSessionExpiredError(err)) return;

      console.error('Error:', err);
      fail("This book couldn't be added to your wishlist. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  useEffect(() => {
    // For a signed-in reader, a book whose owner is blocked either way reads as not found.
    authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/books/${id}`)
      .then(res => {
        setNotFound(res.status === 404);
        return res.ok ? res.json() : {};
      })
      .then(data => {
        setBook(data);
      })
      .catch(err => {
        if (isSessionExpiredError(err)) return;
        console.error('Failed to fetch book:', err);
        setBook({});
      });
  }, [id]);

  async function openConversationWithOwner() {
    clear();
    let reason = "Could not open conversation. Please try again.";
    try {
      const res = await authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/messages/${book.owner?.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: `Hey, I'm interested in your listing for ${book.title}` })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // A refusal the reader can act on, such as a block, is shown as the API words it.
        if (res.status === 403 && body.message) reason = body.message;
        throw new Error(`HTTP ${res.status}`);
      }
      navigate(`/messages/${book.owner?.id}`);
    } catch (err) {
      // RedirectOnSessionEnd is already redirecting to the login page.
      if (isSessionExpiredError(err)) return;

      console.log("Failed to open conversation:", err);
      fail(reason);
    }
  }
  useEffect(() => {
    // A visitor has no wishlist to look the book up in.
    if (book.isbn && signedIn) {
      authFetch(`${import.meta.env.VITE_SERVER_ADDRESS}/user/wishlist/${book.isbn}`)
        .then(res => res.json())
        .then(data => setIsInWishlist(data.exists))
        .catch(err => {
          console.error('Error checking wishlist status:', err);
        });
    }
  }, [book.isbn, signedIn]);

  return (
    <main className="page page--reading">
      <button className="back-link" onClick={() => navigate(-1)}>
        <span className="back-link__mark" aria-hidden="true">&larr;</span>
        Back
      </button>

      {notFound ? (
        <div className="empty">
          <p>This book is no longer available.</p>
          <p>It may have been traded or taken off the market.</p>
        </div>
      ) : (
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
              <DoneButton
                className="button button--primary button--block"
                done={isInWishlist}
                doneLabel="On your wishlist"
                busy={adding}
                busyLabel="Adding…"
                onClick={gate('add books to your wishlist', addToWishlist)}
              >
                Add to Wishlist
              </DoneButton>

              <button
                className="button button--secondary button--block"
                onClick={gate('contact the owner', openConversationWithOwner)}
              >
                Contact Owner
              </button>

              <Feedback feedback={feedback} />
            </div>
          </div>

          <div className="book__main">
            <section className="book__section">
              <h2 className="fact__term">Offered by</h2>
              <p className="fact__value">
                <UserLink user={book.owner} className="textlink" />
              </p>
              {/* The owner's town, never their ZIP, and how far it is from you. */}
              {(book.owner?.location || formatDistance(book.distanceMiles, book.distanceLabel)) && (
                <p className="hint">
                  {[book.owner?.location, formatDistance(book.distanceMiles, book.distanceLabel)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </section>

            {/* The owner's own photos of their copy; the catalogue cover stays the main image. */}
            {(photos.length > 0 || book.photoUploads) && (
              <section className="book__section">
                <h2 className="fact__term">{book.isOwner ? 'Your photos of this copy' : 'Photos of this copy'}</h2>
                <PhotoGallery photos={photos} title={book.title} />
                {book.isOwner ? (
                  book.locked ? (
                    <p className="hint mt-3">
                      This book is in an accepted trade, so its photos can't change until the trade is over.
                    </p>
                  ) : (
                    <PhotoManager bookId={id} photos={photos} canUpload={book.photoUploads} onChange={setPhotos} />
                  )
                ) : (
                  // Photos are the owner's; reporting them is reporting the owner.
                  book.owner?.id && (
                    <p className="hint mt-3">
                      <button type="button" className="textlink-quiet" onClick={gate('report readers', () => setReporting(true))}>
                        Report these photos
                      </button>
                    </p>
                  )
                )}
              </section>
            )}

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
      )}

      {reporting && (
        <ReportDialog
          user={{ _id: book.owner.id, username: book.owner.username }}
          initialReason="INAPPROPRIATE"
          initialDetails={`About the photos of "${book.title}": ${window.location.origin}/books/${id}\n`}
          onClose={() => setReporting(false)}
          onReported={(message) => {
            setReporting(false);
            done(message);
          }}
        />
      )}
    </main>
  );
};

export default BookPage;
