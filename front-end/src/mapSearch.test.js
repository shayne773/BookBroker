import { EMPTY_SEARCH, readSearch, searchQuery } from './mapSearch';

const FULL = {
  q: 'dune',
  genre: 'Science Fiction',
  author: 'Herbert',
  from: '1960',
  to: '1970',
  listed: 'month',
  wishlist: true,
};

test('keeps a search in the query string and reads it back unchanged', () => {
  const query = searchQuery(FULL);
  expect(query).toBe('q=dune&genre=Science+Fiction&author=Herbert&from=1960&to=1970&listed=month&wishlist=1');
  expect(readSearch(new URLSearchParams(query))).toEqual(FULL);
  expect(searchQuery(readSearch(new URLSearchParams(query)))).toBe(query);
});

test('reads a missing search as the empty one, which narrows nothing', () => {
  expect(readSearch(new URLSearchParams(''))).toEqual(EMPTY_SEARCH);
  expect(searchQuery(EMPTY_SEARCH)).toBe('');
  expect(searchQuery({})).toBe('');
});

test('leaves out what would not narrow the search, or that the API would refuse', () => {
  expect(searchQuery({ ...EMPTY_SEARCH, q: '  ', author: ' Austen ', from: '19', to: 'soon', listed: 'year' })).toBe(
    'author=Austen'
  );
  expect(searchQuery({ ...EMPTY_SEARCH, from: '1990', to: '1980' })).toBe('from=1980&to=1990');
  expect(searchQuery({ ...EMPTY_SEARCH, to: '1900' })).toBe('to=1900');
});

test('escapes what a reader types', () => {
  const query = searchQuery({ ...EMPTY_SEARCH, q: 'C++ & sons?' });
  expect(query).toBe('q=C%2B%2B+%26+sons%3F');
  expect(readSearch(new URLSearchParams(query)).q).toBe('C++ & sons?');
});
