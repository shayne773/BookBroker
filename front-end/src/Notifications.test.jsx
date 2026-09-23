import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import NotificationSettings from './Profile/NotificationSettings';
import Unsubscribe from './Unsubscribe';

const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'token');
  global.fetch = vi.fn();
});

afterEach(() => {
  delete global.fetch;
});

const renderUnsubscribe = (path) =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/unsubscribe" element={<Unsubscribe />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>
  );

test('the unsubscribe link turns its category off once, without signing in', async () => {
  global.fetch.mockResolvedValue(respond(200, { category: 'trades' }));
  renderUnsubscribe('/unsubscribe?token=abc');

  expect(await screen.findByRole('heading', { name: 'Unsubscribed' })).toBeInTheDocument();
  expect(screen.getByText('You will no longer get emails about trades.')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toMatch(/\/notifications\/unsubscribe$/);
  expect(init.headers).not.toHaveProperty('Authorization');
  expect(JSON.parse(init.body)).toEqual({ token: 'abc' });
  expect(screen.getByRole('link', { name: 'Email settings' })).toHaveAttribute('href', '/profile#notifications');
});

test('an invalid unsubscribe link says so', async () => {
  global.fetch.mockResolvedValue(respond(400, { message: 'This unsubscribe link is not valid.' }));
  renderUnsubscribe('/unsubscribe?token=bad');

  expect(await screen.findByRole('alert')).toHaveTextContent('This unsubscribe link is not valid.');
});

test('an unsubscribe link without a token sends nothing', async () => {
  renderUnsubscribe('/unsubscribe');

  expect(screen.getByRole('alert')).toHaveTextContent('This unsubscribe link is incomplete.');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('the settings save each switch as it is flipped', async () => {
  global.fetch.mockResolvedValue(
    respond(200, { notifications: { messages: true, trades: false, wishlist: true } })
  );
  render(
    <NotificationSettings settings={{ messages: true, trades: true, wishlist: true }} />,
    { wrapper: MemoryRouter }
  );

  const trades = screen.getByRole('checkbox', { name: /Trades/ });
  expect(trades).toBeChecked();
  await userEvent.click(trades);

  await waitFor(() => expect(trades).not.toBeChecked());
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toMatch(/\/user\/notifications$/);
  expect(JSON.parse(init.body)).toEqual({ trades: false });
  expect(screen.getByRole('checkbox', { name: /New messages/ })).toBeChecked();
});

test('a setting that could not be saved flips back and says so', async () => {
  global.fetch.mockResolvedValue(respond(500, { message: 'Internal server error' }));
  render(
    <NotificationSettings settings={{ messages: true, trades: true, wishlist: true }} />,
    { wrapper: MemoryRouter }
  );

  const wishlist = screen.getByRole('checkbox', { name: /Wishlist matches/ });
  await userEvent.click(wishlist);

  expect(await screen.findByRole('alert')).toHaveTextContent('Your setting could not be saved. Please try again.');
  expect(wishlist).toBeChecked();
});
