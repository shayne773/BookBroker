// A search on the map: a keyword and filters, kept in the map page's query
// string (so it survives a reload and can be shared) under the same keys the
// API reads (back-end/lib/mapSearch.js), so the page passes it on as it is.

export const EMPTY_SEARCH = {
  q: '',
  genre: '',
  author: '',
  from: '',
  to: '',
  listed: '',
  wishlist: false,
};

const TEXT_KEYS = ['q', 'genre', 'author'];
const YEAR = /^\d{4}$/;

// How recently a book was listed, as the API names it, with its label.
export const LISTED_CHOICES = [
  ['', 'Any time'],
  ['week', 'Past week'],
  ['month', 'Past month'],
];

/** The search in `params` (URLSearchParams), every key present. */
export const readSearch = (params) => ({
  ...EMPTY_SEARCH,
  ...Object.fromEntries(
    ['q', 'genre', 'author', 'from', 'to', 'listed'].map((key) => [key, params.get(key) ?? ''])
  ),
  wishlist: params.get('wishlist') === '1',
});

/**
 * `search` as URLSearchParams, holding only the terms that narrow it, in a
 * fixed order: text trimmed, years only when they are four digits (earliest
 * first), and the listing window only when it is one the API knows.
 */
export const searchParams = (search) => {
  const params = new URLSearchParams();
  for (const key of TEXT_KEYS) {
    const value = String(search[key] ?? '').trim();
    if (value) params.set(key, value);
  }
  const years = [search.from, search.to].map((year) => String(year ?? '').trim());
  const [from, to] = years.every((year) => YEAR.test(year)) && years[0] > years[1] ? [years[1], years[0]] : years;
  if (YEAR.test(from)) params.set('from', from);
  if (YEAR.test(to)) params.set('to', to);
  if (LISTED_CHOICES.some(([value]) => value && value === search.listed)) params.set('listed', search.listed);
  if (search.wishlist) params.set('wishlist', '1');
  return params;
};

/** `search` as a query string, "" when it narrows nothing. */
export const searchQuery = (search) => searchParams(search).toString();
