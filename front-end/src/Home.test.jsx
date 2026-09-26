import { vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from './Home';

const books = [
  { _id: 'a', title: 'Dune', isbn: '111' },
  { _id: 'b', title: 'Emma', isbn: '222' },
  { _id: 'c', title: 'Ulysses', isbn: '333' },
];

const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });
let wishlist;
let posts;

beforeAll(() => {
  // Home reveals its sections on scroll; jsdom has no IntersectionObserver.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.setItem('token', 'token');
  wishlist = [];
  posts = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = vi.fn((url, options = {}) => {
    // The API base is unset under test, so the URL is "undefined/<path>".
    const path = String(url).replace(/^[^/]*/, '');
    if (options.method === 'POST') {
      // Each add stays in flight until the test answers it.
      return new Promise((resolve) => {
        posts.push({ book: JSON.parse(options.body), answer: () => resolve(respond(201, {})) });
      });
    }
    if (path === '/feed') return Promise.resolve(respond(200, books));
    if (path === '/user/wishlist') return Promise.resolve(respond(200, wishlist));
    return Promise.resolve(respond(200, {}));
  });
});

afterEach(() => {
  delete global.fetch;
  localStorage.clear();
  vi.restoreAllMocks();
});

const renderHome = async () => {
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  );
  await screen.findByRole('link', { name: 'Dune' });
};

const tile = (title) => screen.getAllByText(title)[0].closest('article');

test('each add in flight keeps its own button busy until it returns', async () => {
  await renderHome();

  fireEvent.click(within(tile('Dune')).getByRole('button', { name: 'Add to Wishlist' }));
  fireEvent.click(within(tile('Emma')).getByRole('button', { name: 'Add to Wishlist' }));
  await act(async () => posts[1].answer());

  expect(await within(tile('Emma')).findByRole('button', { name: /On your wishlist/ })).toBeInTheDocument();
  const dune = within(tile('Dune')).getByRole('button', { name: 'Adding…' });
  expect(dune).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(dune);
  expect(posts.map((p) => p.book._id)).toEqual(['a', 'b']);

  await act(async () => posts[0].answer());
  expect(await within(tile('Dune')).findByRole('button', { name: /On your wishlist/ })).toBeInTheDocument();
});

test('only an add the reader made is announced, not a book already on the wishlist', async () => {
  wishlist = [{ isbn: '333' }];
  await renderHome();

  await within(tile('Ulysses')).findByRole('button', { name: /On your wishlist/ });
  const announced = () => screen.getAllByRole('status').filter((s) => s.textContent === 'On your wishlist');
  expect(announced()).toHaveLength(0);

  fireEvent.click(within(tile('Emma')).getByRole('button', { name: 'Add to Wishlist' }));
  await act(async () => posts[0].answer());

  await within(tile('Emma')).findByRole('button', { name: /On your wishlist/ });
  expect(announced()).toHaveLength(1);
});
