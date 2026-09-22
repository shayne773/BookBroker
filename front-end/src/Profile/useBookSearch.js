import { useEffect, useState } from 'react';
import { isSessionExpiredError } from '../auth';
import { searchGoogleBooks } from '../googleBooks';

// The Google Books lookup behind one "add a book" dialog: debounced search as
// the reader types, and the volume they picked. Profile keeps one per dialog,
// so each remembers its own text and pick between openings.
const useBookSearch = () => {
  const [text, setText] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isTyping) return;

    const q = text.trim();
    if (q.length < 3) return;

    const t = setTimeout(async () => {
      try {
        setSearching(true);
        setResults(await searchGoogleBooks(q));
      } catch (err) {
        // RequireAuth is already redirecting to the login page.
        if (isSessionExpiredError(err)) return;

        console.error(err);
        setResults([]);
        setError(err.message);
      } finally {
        setSearching(false);
      }
    }, 500);

    return () => clearTimeout(t);
  }, [text, isTyping]);

  const type = (value) => {
    setText(value);
    setIsTyping(true);
    setError('');
    if (value.trim().length < 3) setResults([]);
  };

  const pick = (book) => {
    setSelected(book);
    setText(book.title);
    setResults([]);
    setIsTyping(false);
  };

  // Closing the dialog drops the live results but keeps the text and the pick.
  const dismiss = () => {
    setResults([]);
    setError('');
    setIsTyping(false);
  };

  // After a book is added, start the next search from nothing.
  const reset = () => {
    setSelected(null);
    setText('');
    setResults([]);
    setIsTyping(false);
  };

  return { text, results, selected, searching, error, type, pick, dismiss, reset };
};

export default useBookSearch;
