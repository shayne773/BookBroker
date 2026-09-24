import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Browse from './Browse';
import BookList from './Browse/BookList';
import LocationSettings from './Profile/LocationSettings';
import WishlistMatches from './Profile/WishlistMatches';

const book = (id, title, distanceMiles) => ({ _id: id, title, author: 'Tolkien', distanceMiles });

let routes;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'token');
  routes = {};
  global.fetch = vi.fn(async (url, options = {}) => {
    // The API base is unset under test, so the URL is "undefined/<path>".
    const path = String(url).replace(/^[^/]*/, '').split('?')[0];
    const reply = routes[path] ?? (() => ({ body: [] }));
    const { status = 200, body } = reply(options.body && JSON.parse(options.body));
    return { ok: status < 400, status, json: async () => body };
  });
});

afterEach(() => {
  delete global.fetch;
});

const browsePayload = (area) => ({
  q: '',
  area,
  searchResults: [],
  popular: [book('p1', 'Dune', 12)],
  newlyAdded: [book('n1', 'Emma', 0)],
  genres: [],
  genreRows: {},
});

test('each book on Browse says how far away it is, and Browse says where it looks', async () => {
  routes['/browse'] = () => ({ body: browsePayload({ place: 'Brooklyn, NY', miles: 25 }) });
  routes['/recommendations'] = () => ({ body: [book('r1', 'Earthsea', 3)] });
  render(<Browse />, { wrapper: MemoryRouter });

  expect(await screen.findByText('Books within 25 mi of Brooklyn, NY.', { exact: false })).toBeInTheDocument();
  const recommended = screen.getByRole('heading', { name: 'Recommended for you' }).closest('section');
  expect(within(recommended).getByText('Earthsea')).toBeInTheDocument();
  expect(within(recommended).getByText('3 mi away')).toBeInTheDocument();
  expect(screen.getByText('12 mi away')).toBeInTheDocument();
  expect(screen.getByText('less than 1 mi away')).toBeInTheDocument();
});

test('a reader without a ZIP code is asked for one and sees no distances', async () => {
  routes['/browse'] = () => ({
    body: { ...browsePayload(null), popular: [book('p1', 'Dune')], newlyAdded: [] },
  });
  render(<Browse />, { wrapper: MemoryRouter });

  const link = await screen.findByRole('link', { name: 'Add ZIP code' });
  expect(link).toHaveAttribute('href', '/profile#location');
  expect(screen.queryByText(/mi away/)).not.toBeInTheDocument();
});

test('a book row shows its distance under the author line', () => {
  render(<BookList books={[book('b1', 'The Hobbit', 7)]} emptyLabel="None" />, { wrapper: MemoryRouter });

  expect(screen.getByText('7 mi away')).toHaveClass('distance');
});

test('wishlist matches say how far each offer is', async () => {
  routes['/user/wishlist/matches'] = () => ({
    body: [
      {
        wishlistBook: { _id: 'w1', title: 'The Hobbit' },
        offers: [
          { _id: 'o1', distanceMiles: 2, owner: { _id: 'u1', username: 'rob', location: 'New York, NY' } },
        ],
      },
    ],
  });
  render(<WishlistMatches />, { wrapper: MemoryRouter });

  const offers = await screen.findByRole('list', { name: 'Readers offering The Hobbit' });
  expect(within(offers).getByRole('link')).toHaveTextContent('rob · New York, NY · No ratings yet · 2 mi away');
});

describe('where you trade', () => {
  const me = { _id: 'me', username: 'me', location: 'Brooklyn, NY', zip: '11201', maxDistanceMiles: 25 };

  test('asks a reader without a ZIP code to add one', () => {
    render(<LocationSettings user={{ _id: 'me', location: 'NYC', maxDistanceMiles: 25 }} />, {
      wrapper: MemoryRouter,
    });

    expect(screen.getByRole('status')).toHaveTextContent('Add your ZIP code to see the books near you');
  });

  test('saves a new ZIP code and distance', async () => {
    let sent;
    routes['/user/edit'] = (body) => {
      sent = body;
      return { body: { message: 'User updated', user: { ...me, zip: '07030' } } };
    };
    const onSaved = vi.fn();
    render(<LocationSettings user={me} onSaved={onSaved} />, { wrapper: MemoryRouter });

    expect(screen.getByText('Brooklyn, NY (11201).', { exact: false })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('New ZIP code'), '07030-1234');
    await userEvent.selectOptions(screen.getByLabelText('Show books within'), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(sent).toEqual({ user: { zip: '07030', maxDistanceMiles: 50 } });
    expect(onSaved).toHaveBeenCalled();
  });

  test('refuses a postal code that is not a US ZIP code without sending it', async () => {
    render(<LocationSettings user={me} />, { wrapper: MemoryRouter });

    await userEvent.type(screen.getByLabelText('New ZIP code'), 'SW1A 1AA');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a 5-digit US ZIP code.');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('shows the server refusal of a ZIP code it cannot place', async () => {
    routes['/user/edit'] = () => ({
      status: 400,
      body: { message: "We don't recognise that ZIP code. Check it and try again." },
    });
    render(<LocationSettings user={me} />, { wrapper: MemoryRouter });

    await userEvent.type(screen.getByLabelText('New ZIP code'), '00000');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("We don't recognise that ZIP code.");
  });
});
