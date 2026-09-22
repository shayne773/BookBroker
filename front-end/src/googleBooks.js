// Google Books search, through the BookBroker API: the browser never calls
// Google itself, because the API holds the key and the daily quota.
import { authFetch } from './auth';

export const BOOK_SEARCH_FAILED = 'Book search failed. Please try again.';

// Resolves to books in the shape the add-book routes take. Rejects with an
// Error whose message is fit to show: the API's own for a refusal (search
// temporarily unavailable, too many searches), a generic one otherwise.
export const searchGoogleBooks = async (query) => {
  const res = await authFetch(
    `${import.meta.env.VITE_SERVER_ADDRESS}/google-books/search?q=${encodeURIComponent(query)}`
  );
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(res.status !== 500 && data?.message ? data.message : BOOK_SEARCH_FAILED);
  }
  return Array.isArray(data.books) ? data.books : [];
};
