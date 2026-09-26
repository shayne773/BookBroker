import { vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Search from './Browse/Search';
import useBookSearch from './Profile/useBookSearch';

const UNAVAILABLE = 'Book search is temporarily unavailable. Please try again later.';

const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 't0ken');
  global.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete global.fetch;
  vi.restoreAllMocks();
});

const renderSearch = async () => {
  render(
    <MemoryRouter>
      <Search />
    </MemoryRouter>
  );
  await userEvent.click(screen.getByRole('button', { name: 'Google Books' }));
  await userEvent.type(screen.getByLabelText('Search Google Books'), 'dune');
};

test('Browse search asks the API, with the session, never Google directly', async () => {
  global.fetch.mockResolvedValue(
    respond(200, { books: [{ title: 'Dune', author: 'Frank Herbert', isbn: '9780441013593', cover: '' }] })
  );

  await renderSearch();

  expect(await screen.findByText('Dune')).toBeInTheDocument();
  for (const [url, options] of global.fetch.mock.calls) {
    expect(url).toMatch(/\/google-books\/search\?q=/);
    expect(url).not.toMatch(/googleapis/);
    expect(options.headers.Authorization).toBe('Bearer t0ken');
  }
});

test('Browse search says when book search is unavailable instead of showing nothing', async () => {
  global.fetch.mockResolvedValue(respond(503, { message: UNAVAILABLE, code: 'BOOK_SEARCH_UNAVAILABLE' }));

  await renderSearch();

  expect(await screen.findByRole('alert')).toHaveTextContent(UNAVAILABLE);
});

test('the add-a-book search reports an unavailable search clearly', async () => {
  global.fetch.mockResolvedValue(respond(503, { message: UNAVAILABLE, code: 'BOOK_SEARCH_UNAVAILABLE' }));

  const { result } = renderHook(() => useBookSearch());
  act(() => result.current.type('dune messiah'));

  await waitFor(() => expect(result.current.error).toBe(UNAVAILABLE));
  expect(result.current.results).toEqual([]);
  expect(global.fetch.mock.calls[0][0]).toMatch(/\/google-books\/search\?q=dune%20messiah$/);
});

test('an unexpected server failure shows a generic message, not the server text', async () => {
  global.fetch.mockResolvedValue(respond(500, { message: 'Internal server error' }));

  const { result } = renderHook(() => useBookSearch());
  act(() => result.current.type('dune'));

  await waitFor(() => expect(result.current.error).toBe('Book search failed. Please try again.'));
});

describe('adding the chosen Google Books volume', () => {
  const dune = { title: 'Dune', author: 'Frank Herbert', isbn: '9780441013593', cover: '' };
  let added;

  beforeEach(() => {
    added = [];
    global.fetch.mockImplementation(async (url) => {
      if (String(url).includes('/google-books/search')) return respond(200, { books: [dune] });
      added.push(String(url).replace(/^[^/]*/, ''));
      return respond(201, { message: 'Added' });
    });
  });

  const choose = async () => {
    await renderSearch();
    await userEvent.click(await screen.findByRole('button', { name: /Dune/ }));
  };

  test('turns Add to Wishlist into a checked "On your wishlist", without a pop-up', async () => {
    const alert = vi.spyOn(window, 'alert');
    await choose();

    await userEvent.click(screen.getByRole('button', { name: 'Add to Wishlist' }));

    const done = await screen.findByRole('button', { name: /On your wishlist/ });
    expect(done).toHaveClass('is-done');
    expect(done).toHaveAttribute('aria-disabled', 'true');
    // The change is announced, and the book stays in view to offer as well.
    expect(screen.getAllByRole('status').some((s) => s.textContent === 'On your wishlist')).toBe(true);
    expect(screen.getByRole('button', { name: 'Add to Offerings' })).toBeInTheDocument();
    expect(added).toEqual(['/user/add-wishlist-book']);
    expect(alert).not.toHaveBeenCalled();

    // A done button does nothing more.
    await userEvent.click(done);
    expect(added).toEqual(['/user/add-wishlist-book']);
  });

  test('turns Add to Offerings into a checked "Offered"', async () => {
    await choose();

    await userEvent.click(screen.getByRole('button', { name: 'Add to Offerings' }));

    expect(await screen.findByRole('button', { name: /Offered/ })).toHaveClass('is-done');
    expect(screen.getByRole('button', { name: 'Add to Wishlist' })).not.toHaveClass('is-done');
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(added).toEqual(['/user/add-offered-book']);
  });

  test('while one add is under way, neither button sends another', async () => {
    let answer;
    global.fetch.mockImplementation((url) => {
      if (String(url).includes('/google-books/search')) return Promise.resolve(respond(200, { books: [dune] }));
      added.push(String(url).replace(/^[^/]*/, ''));
      return new Promise((resolve) => {
        answer = () => resolve(respond(201, { message: 'Added' }));
      });
    });
    await choose();

    await userEvent.click(screen.getByRole('button', { name: 'Add to Wishlist' }));
    const offer = screen.getByRole('button', { name: 'Add to Offerings' });
    expect(offer).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(offer);
    await userEvent.click(screen.getByRole('button', { name: 'Adding…' }));
    expect(added).toEqual(['/user/add-wishlist-book']);

    await act(async () => answer());
    expect(await screen.findByRole('button', { name: /On your wishlist/ })).toHaveClass('is-done');
    expect(screen.getByRole('button', { name: 'Add to Offerings' })).not.toHaveAttribute('aria-disabled');
  });

  test("an add that answers after another book is chosen leaves that book's buttons alone", async () => {
    const messiah = { title: 'Dune Messiah', author: 'Frank Herbert', isbn: '9780593098233', cover: '' };
    const answers = [];
    global.fetch.mockImplementation((url) => {
      if (String(url).includes('/google-books/search')) {
        return Promise.resolve(respond(200, { books: String(url).includes('messiah') ? [messiah] : [dune] }));
      }
      return new Promise((resolve) => answers.push(resolve));
    });
    await choose();

    await userEvent.click(screen.getByRole('button', { name: 'Add to Wishlist' }));
    const input = screen.getByLabelText('Search Google Books');
    await userEvent.clear(input);
    await userEvent.type(input, 'messiah');
    await userEvent.click(await screen.findByRole('button', { name: /Dune Messiah/ }));

    await act(async () => answers[0](respond(201, { message: 'Added' })));

    expect(screen.queryByRole('button', { name: /On your wishlist/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Wishlist' })).not.toHaveClass('is-done');
    expect(screen.getByRole('button', { name: 'Add to Wishlist' })).not.toHaveAttribute('aria-disabled');
  });

  test("a failed add that answers after another book is chosen does not show its error there", async () => {
    const messiah = { title: 'Dune Messiah', author: 'Frank Herbert', isbn: '9780593098233', cover: '' };
    const answers = [];
    global.fetch.mockImplementation((url) => {
      if (String(url).includes('/google-books/search')) {
        return Promise.resolve(respond(200, { books: String(url).includes('messiah') ? [messiah] : [dune] }));
      }
      return new Promise((resolve) => answers.push(resolve));
    });
    await choose();

    await userEvent.click(screen.getByRole('button', { name: 'Add to Wishlist' }));
    const input = screen.getByLabelText('Search Google Books');
    await userEvent.clear(input);
    await userEvent.type(input, 'messiah');
    await userEvent.click(await screen.findByRole('button', { name: /Dune Messiah/ }));

    await act(async () => answers[0](respond(409, { message: 'That book is already on your wishlist.' })));

    expect(screen.queryByText('That book is already on your wishlist.')).not.toBeInTheDocument();
  });

  test('a failed add says why beside the buttons and leaves the button to try again', async () => {
    global.fetch.mockImplementation(async (url) =>
      String(url).includes('/google-books/search')
        ? respond(200, { books: [dune] })
        : respond(409, { message: 'That book is already on your wishlist.' })
    );
    await choose();

    await userEvent.click(screen.getByRole('button', { name: 'Add to Wishlist' }));

    expect(await screen.findByText('That book is already on your wishlist.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Wishlist' })).not.toHaveClass('is-done');
    expect(screen.queryByText(/Search failed/)).not.toBeInTheDocument();
  });
});
