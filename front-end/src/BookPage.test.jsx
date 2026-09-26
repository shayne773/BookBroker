import { vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import BookPage from './BookPage';

const book = {
  _id: 'b1',
  title: 'The Hobbit',
  author: 'J. R. R. Tolkien',
  isbn: '9780261103344',
  owner: { id: 'rob', username: 'rob', location: 'Queens, NY' },
};

const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });
let routes;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'token');
  localStorage.setItem('userId', 'me');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  routes = {
    'GET /books/b1': respond(200, book),
    'GET /user/wishlist/9780261103344': respond(200, { exists: false }),
    'POST /user/add-wishlist-book': respond(201, { message: 'Added' }),
  };
  global.fetch = vi.fn(async (url, options = {}) => {
    // The API base is unset under test, so the URL is "undefined/<path>".
    const key = `${options.method || 'GET'} ${String(url).replace(/^[^/]*/, '')}`;
    return routes[key] ?? respond(404, { message: `no route for ${key}` });
  });
});

afterEach(() => {
  delete global.fetch;
  vi.restoreAllMocks();
});

const renderPage = async () => {
  render(
    <MemoryRouter initialEntries={['/books/b1']}>
      <Routes>
        <Route path="/books/:id" element={<BookPage />} />
        <Route path="/users/:id" element={<h1>Owner profile</h1>} />
        <Route path="/messages/:user" element={<h1>Conversation</h1>} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'The Hobbit' });
};

test("the owner's name links to their profile", async () => {
  await renderPage();

  const owner = await screen.findByRole('link', { name: 'rob' });
  expect(owner).toHaveAttribute('href', '/users/rob');
  fireEvent.click(owner);
  expect(await screen.findByRole('heading', { name: 'Owner profile' })).toBeInTheDocument();
});

test('Add to Wishlist turns into a checked "On your wishlist" in place', async () => {
  await renderPage();

  fireEvent.click(await screen.findByRole('button', { name: 'Add to Wishlist' }));

  expect(await screen.findByRole('button', { name: /On your wishlist/ })).toHaveClass('is-done');
});

test('a failed add says so under the buttons', async () => {
  routes['POST /user/add-wishlist-book'] = respond(500, {});
  await renderPage();

  fireEvent.click(await screen.findByRole('button', { name: 'Add to Wishlist' }));

  expect(
    await screen.findByText("This book couldn't be added to your wishlist. Please try again.")
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add to Wishlist' })).not.toHaveClass('is-done');
});

test('a conversation that cannot be opened says why under the buttons', async () => {
  routes['POST /messages/rob'] = respond(403, { message: "You can't message this reader." });
  await renderPage();

  fireEvent.click(await screen.findByRole('button', { name: 'Contact Owner' }));

  const actions = screen.getByRole('button', { name: 'Contact Owner' }).parentElement;
  expect(await within(actions).findByText("You can't message this reader.")).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Conversation' })).not.toBeInTheDocument();
});

test('Contact Owner opens the conversation with the owner', async () => {
  routes['POST /messages/rob'] = respond(201, { message: { id: 'm1' } });
  await renderPage();

  fireEvent.click(await screen.findByRole('button', { name: 'Contact Owner' }));

  expect(await screen.findByRole('heading', { name: 'Conversation' })).toBeInTheDocument();
});
