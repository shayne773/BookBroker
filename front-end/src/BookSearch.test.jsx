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
