import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ExchangeDetail from './ExchangeDetail';

const LIMIT_MESSAGE =
  'You have sent a lot of trade offers in the last hour. Please wait a while before sending another.';

const exchange = {
  _id: 'ex1',
  status: 'PENDING',
  requester: { _id: 'them', username: 'rob' },
  responder: { _id: 'me', username: 'me' },
  proposedBy: 'them',
  requesterBooks: [{ _id: 'theirs', title: 'Their Dune' }],
  responderBooks: [{ _id: 'mine', title: 'My Hobbit' }],
  message: '',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'token');
  localStorage.setItem('userId', 'me');
  global.fetch = vi.fn(async (url, options = {}) => {
    // The API base is unset under test, so the URL is "undefined/<path>".
    const path = String(url).replace(/^[^/]*/, '');
    const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

    if (path === '/exchanges/ex1') return reply(exchange);
    if (path === '/exchanges/ex1/counter' && options.method === 'POST') return reply({ message: LIMIT_MESSAGE }, 429);
    if (path === '/users/me/offered') return reply([{ _id: 'mine', title: 'My Hobbit' }]);
    if (path === '/users/them/offered') return reply([{ _id: 'theirs', title: 'Their Dune' }]);
    return reply([]);
  });
});

afterEach(() => {
  delete global.fetch;
});

test('says so in the counter dialog when the hourly offer limit is reached', async () => {
  render(
    <MemoryRouter initialEntries={['/exchanges/ex1']}>
      <Routes>
        <Route path="/exchanges/:exchangeId" element={<ExchangeDetail />} />
      </Routes>
    </MemoryRouter>
  );

  await userEvent.click(await screen.findByRole('button', { name: 'Counter' }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Send Counter' }));

  expect(await within(dialog).findByRole('alert')).toHaveTextContent(LIMIT_MESSAGE);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
