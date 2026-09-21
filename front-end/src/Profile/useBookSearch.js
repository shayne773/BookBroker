import { useEffect, useState } from 'react';

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
        setResults(await fetchBooksFromGoogle(q));
      } catch (err) {
        console.error(err);
        setResults([]);
        const msg = String(err.message || '');
        setError(
          msg.includes('429')
            ? 'Google Books rate limit hit. Please wait ~1–2 minutes and try again.'
            : 'Google Books search failed.'
        );
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
