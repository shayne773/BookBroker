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

test('the unsubscribe link names its category and turns it off only when asked, without signing in', async () => {
  global.fetch.mockResolvedValue(respond(200, { category: 'trades' }));
  renderUnsubscribe('/unsubscribe?token=u1.trades.mac');

  expect(screen.getByText('Stop getting emails about trades?')).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));

  expect(await screen.findByRole('heading', { name: 'Unsubscribed' })).toBeInTheDocument();
  expect(screen.getByText('You will no longer get emails about trades.')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toMatch(/\/notifications\/unsubscribe$/);
  expect(init.headers).not.toHaveProperty('Authorization');
  expect(JSON.parse(init.body)).toEqual({ token: 'u1.trades.mac' });
  expect(screen.getByRole('link', { name: 'Email settings' })).toHaveAttribute('href', '/profile#notifications');
});

test('an invalid unsubscribe link says so', async () => {
  global.fetch.mockResolvedValue(respond(400, { message: 'This unsubscribe link is not valid.' }));
  renderUnsubscribe('/unsubscribe?token=u1.trades.forged');

  await userEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('This unsubscribe link is not valid.');
});

test('an unsubscribe link naming no category sends nothing', async () => {
  renderUnsubscribe('/unsubscribe?token=bad');

  expect(screen.getByRole('alert')).toHaveTextContent('This unsubscribe link is incomplete.');
  expect(global.fetch).not.toHaveBeenCalled();
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

test('a failed switch flips back alone, keeping another switch saved meanwhile', async () => {
  let failTrades;
  global.fetch.mockImplementation((url, init) => {
    const body = JSON.parse(init.body);
    if ('trades' in body) {
      return new Promise((resolve) => {
        failTrades = () => resolve(respond(500, { message: 'Internal server error' }));
      });
    }
    return Promise.resolve(
      respond(200, { notifications: { messages: true, trades: true, wishlist: false } })
    );
  });
  render(
    <NotificationSettings settings={{ messages: true, trades: true, wishlist: true }} />,
    { wrapper: MemoryRouter }
  );

  const trades = screen.getByRole('checkbox', { name: /Trades/ });
  const wishlist = screen.getByRole('checkbox', { name: /Wishlist matches/ });
  await userEvent.click(trades);
  await userEvent.click(wishlist);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect(trades).not.toBeChecked();
  expect(wishlist).not.toBeChecked();

  failTrades();

  expect(await screen.findByRole('alert')).toHaveTextContent('Your setting could not be saved.');
  expect(trades).toBeChecked();
  expect(wishlist).not.toBeChecked();
});

test('a reply that arrives late never undoes a newer choice', async () => {
  const replies = [];
  global.fetch.mockImplementation(
    (url, init) =>
      new Promise((resolve) => {
        const trades = JSON.parse(init.body).trades;
        replies.push(() =>
          resolve(respond(200, { notifications: { messages: true, trades, wishlist: true } }))
        );
      })
  );
  render(
    <NotificationSettings settings={{ messages: true, trades: true, wishlist: true }} />,
    { wrapper: MemoryRouter }
  );

  const trades = screen.getByRole('checkbox', { name: /Trades/ });
  await userEvent.click(trades);
  await userEvent.click(trades);
  await waitFor(() => expect(replies).toHaveLength(2));
  expect(trades).toBeChecked();

  replies[1]();
  replies[0]();

  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  await new Promise((r) => setTimeout(r, 0));
  expect(trades).toBeChecked();
});
