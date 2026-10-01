import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AccountPromptProvider } from './AccountPrompt';
import BookPage from './BookPage';
import Home from './Home';
import UserPage from './UserPage';
import UserPageOffered from './UserPageOffered';
import Search from './Browse/Search';
import SearchBar from './BookMap/SearchBar';
import { EMPTY_SEARCH } from './mapSearch';

// A visitor browses without an account; every action that needs one stays in
// view and opens the sign-up prompt instead of acting.

const book = {
  _id: 'b1',
  title: 'The Hobbit',
  author: 'J. R. R. Tolkien',
  isbn: '9780261103344',
  owner: { id: 'rob', username: 'rob', location: 'Queens, NY' },
};
const reader = { _id: 'rob', username: 'rob', location: 'Queens, NY', ratingsAvg: 0, ratingsCount: 0, blockedByMe: false };

let calls;

beforeEach(() => {
  localStorage.clear();
  calls = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = vi.fn(async (url, options = {}) => {
    // The API base is unset under test, so the URL is "undefined/<path>".
    const path = String(url).replace(/^[^/]*/, '').split('?')[0];
    const method = options.method || 'GET';
    calls.push({ method, path, auth: options.headers?.Authorization });
    const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

    if (path === '/books/b1') return reply(book);
    if (path === '/feed') return reply([book]);
    if (path === '/users/rob') return reply(reader);
    if (path === '/users/rob/offered') return reply([{ _id: 'b1', title: 'The Hobbit' }]);
    return reply([]);
  });
});

afterEach(() => {
  delete global.fetch;
  vi.restoreAllMocks();
});

// Where the prompt's links lead, with the page they carry back.
const Destination = ({ name }) => {
  const location = useLocation();
  return <h1>{`${name} from ${location.state?.from?.pathname}`}</h1>;
};

// `pattern` is the route `path` matches, e.g. "/books/:id".
const renderAt = (path, pattern, element) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AccountPromptProvider>
        <Routes>
          <Route path={pattern} element={element} />
          <Route path="/signup" element={<Destination name="Sign up" />} />
          <Route path="/login" element={<Destination name="Sign in" />} />
          <Route path="/messages/:user" element={<h1>Conversation</h1>} />
        </Routes>
      </AccountPromptProvider>
    </MemoryRouter>
  );

const prompt = (name) => screen.getByRole('dialog', { name });
const writes = () => calls.filter((c) => c.method !== 'GET');

describe('a visitor on a book page', () => {
  beforeEach(async () => {
    renderAt('/books/b1', '/books/:id', <BookPage />);
    await screen.findByRole('heading', { name: 'The Hobbit' });
  });

  test('is asked to sign up to add a book to their wishlist, and nothing is sent', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add to Wishlist' }));

    expect(prompt('Sign up to add books to your wishlist')).toBeInTheDocument();
    expect(writes()).toEqual([]);
    // A visitor has no wishlist to look the book up in, and no session is sent.
    expect(calls.map((c) => c.path)).not.toContain('/user/wishlist/9780261103344');
    expect(calls.every((c) => !c.auth)).toBe(true);
  });

  test('is asked to sign up to contact the owner, and stays on the page', () => {
    fireEvent.click(screen.getByRole('button', { name: 'Contact Owner' }));

    expect(prompt('Sign up to contact the owner')).toBeInTheDocument();
    expect(writes()).toEqual([]);
    expect(screen.queryByRole('heading', { name: 'Conversation' })).not.toBeInTheDocument();
  });

  test('can sign up from the prompt, carrying the page to come back to', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add to Wishlist' }));
    fireEvent.click(within(prompt('Sign up to add books to your wishlist')).getByRole('link', { name: 'Sign up' }));

    expect(await screen.findByRole('heading', { name: 'Sign up from /books/b1' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('can sign in from the prompt instead', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Contact Owner' }));
    fireEvent.click(within(prompt('Sign up to contact the owner')).getByRole('link', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Sign in from /books/b1' })).toBeInTheDocument();
  });

  test('can dismiss the prompt with Not now, the close button or Escape', () => {
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Add to Wishlist' }));

    open();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'The Hobbit' })).toBeInTheDocument();
  });
});

test("a visitor sees a book's photos and is asked to sign up to report them", async () => {
  const photos = [{ _id: 'p1', url: 'https://blob.example/books/b1/1.jpg', width: 1600, height: 1200 }];
  const answer = global.fetch;
  global.fetch = vi.fn(async (url, options) =>
    String(url).endsWith('/books/b1')
      ? { ok: true, status: 200, json: async () => ({ ...book, photos }) }
      : answer(url, options)
  );
  renderAt('/books/b1', '/books/:id', <BookPage />);

  expect(await screen.findByRole('heading', { name: 'Photos of this copy' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Enlarge photo/ })).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: 'Report these photos' }));
  expect(prompt('Sign up to report readers')).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Report rob' })).not.toBeInTheDocument();
});

test('a visitor on the home page sees every book and is asked to sign up to wishlist one', async () => {
  renderAt('/home', '/home', <Home />);
  await screen.findByRole('link', { name: 'The Hobbit' });

  expect(screen.queryByText(/ZIP code/)).not.toBeInTheDocument();
  expect(calls.map((c) => c.path)).toEqual(['/feed']);

  fireEvent.click(screen.getByRole('button', { name: 'Add to Wishlist' }));

  expect(prompt('Sign up to add books to your wishlist')).toBeInTheDocument();
  expect(writes()).toEqual([]);
});

describe("a visitor on a reader's profile", () => {
  beforeEach(async () => {
    renderAt('/users/rob', '/users/:id', <UserPage />);
    await screen.findByRole('heading', { name: 'rob' });
  });

  test('is asked to sign up to message them', () => {
    fireEvent.click(screen.getByRole('link', { name: 'Message' }));

    expect(prompt('Sign up to message readers')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Conversation' })).not.toBeInTheDocument();
  });

  test.each([
    ['Report', 'Sign up to report readers'],
    ['Block', 'Sign up to block readers'],
  ])('is asked to sign up to %s them, and nothing is sent', (button, title) => {
    fireEvent.click(screen.getByRole('button', { name: button }));

    expect(prompt(title)).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });
});

test("a visitor on a reader's offerings is asked to sign up to message them", async () => {
  renderAt('/users/rob/offered', '/users/:id/offered', <UserPageOffered />);
  await screen.findByText('The Hobbit');

  fireEvent.click(await screen.findByRole('link', { name: 'Message' }));

  expect(prompt('Sign up to message readers')).toBeInTheDocument();
});

test('a visitor searching is asked to sign up to add books from Google Books', () => {
  renderAt('/browse/search', '/browse/search', <Search />);

  fireEvent.click(screen.getByRole('button', { name: 'Google Books' }));

  expect(prompt('Sign up to add books from Google Books')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Marketplace' })).toHaveAttribute('aria-pressed', 'true');
});

test("a visitor on the map is asked to sign up to match books to their wishlist", () => {
  const onSearch = vi.fn();
  render(
    <MemoryRouter>
      <AccountPromptProvider>
        <SearchBar search={EMPTY_SEARCH} active={false} genres={[]} onSearch={onSearch} onClear={() => {}} />
      </AccountPromptProvider>
    </MemoryRouter>
  );

  fireEvent.click(screen.getByRole('checkbox', { name: 'Only my wishlist matches' }));

  expect(prompt('Sign up to match books to your wishlist')).toBeInTheDocument();
  expect(onSearch).not.toHaveBeenCalled();
  expect(screen.getByRole('checkbox', { name: 'Only my wishlist matches' })).not.toBeChecked();
});

test('a signed-in reader acts at once, with no prompt', async () => {
  localStorage.setItem('token', 'token');
  localStorage.setItem('userId', 'me');
  renderAt('/books/b1', '/books/:id', <BookPage />);
  await screen.findByRole('heading', { name: 'The Hobbit' });

  fireEvent.click(screen.getByRole('button', { name: 'Add to Wishlist' }));

  await waitFor(() => expect(writes().map((c) => c.path)).toEqual(['/user/add-wishlist-book']));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
