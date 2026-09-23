import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WishlistMatches from './Profile/WishlistMatches';
import MyBooks from './Profile/MyBooks';

const hobbit = { _id: 'w1', title: 'The Hobbit', author: 'Tolkien', isbn: '9780261102217' };
const dune = { _id: 'w2', title: 'Dune', author: 'Herbert', isbn: '9780441013593' };

const matches = [
  {
    wishlistBook: hobbit,
    offers: [
      { _id: 'o1', title: 'The Hobbit', owner: { _id: 'u1', username: 'rob', location: 'Queens', ratingsAvg: 4.5, ratingsCount: 2 } },
      { _id: 'o2', title: 'The Hobbit', owner: { _id: 'u2', username: 'ann', location: 'Bronx', ratingsAvg: 0, ratingsCount: 0 } },
    ],
  },
];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'token');
  global.fetch = vi.fn(async (url) => {
    // The API base is unset under test, so the URL is "undefined/<path>".
    const path = String(url).replace(/^[^/]*/, '').split('?')[0];
    const body = path === '/user/wishlist/matches' ? matches : path === '/user/wishlist' ? [hobbit, dune] : [];
    return { ok: true, status: 200, json: async () => body };
  });
});

afterEach(() => {
  delete global.fetch;
});

test('lists each wishlisted book on offer with every reader offering it', async () => {
  render(<WishlistMatches />, { wrapper: MemoryRouter });

  const offers = await screen.findByRole('list', { name: 'Readers offering The Hobbit' });
  const links = within(offers).getAllByRole('link');

  expect(links.map((a) => a.getAttribute('href'))).toEqual(['/books/o1', '/books/o2']);
  expect(links[0]).toHaveTextContent('rob');
  expect(links[0]).toHaveTextContent('Queens · 4.5 of 5 · 2 ratings');
  expect(screen.getByText('2 offers')).toBeInTheDocument();
  expect(screen.queryByText('Dune')).not.toBeInTheDocument();
});

test('says so when none of the wishlist is on offer', async () => {
  matches.length = 0;
  render(<WishlistMatches />, { wrapper: MemoryRouter });

  expect(await screen.findByText('None of your wishlist is on offer right now.')).toBeInTheDocument();
});

test('the wishlist marks only the books other readers are offering', async () => {
  matches.push({ wishlistBook: hobbit, offers: [{ _id: 'o1', owner: { username: 'rob' } }] });
  render(<MyBooks />, { wrapper: MemoryRouter });

  const flag = await screen.findByRole('link', { name: /Available from 1 reader/ });

  expect(flag).toHaveAttribute('href', '/profile/matches');
  expect(screen.getAllByRole('link', { name: /Available from/ })).toHaveLength(1);
});
