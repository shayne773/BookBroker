import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ProposeTradeDialog from './MessagesDetail/ProposeTradeDialog';

const LIMIT_MESSAGE =
  'You have proposed a lot of trades in the last hour. Please wait a while before proposing another.';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'token');
  global.fetch = vi.fn(async (url, options = {}) => {
    // The API base is unset under test, so the URL is "undefined/<path>".
    const path = String(url).replace(/^[^/]*/, '');
    const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

    if (path === '/user/offered') return reply([{ _id: 'mine', title: 'My Hobbit' }]);
    if (path === '/users/them/offered') return reply([{ _id: 'theirs', title: 'Their Dune' }]);
    if (path === '/exchanges' && options.method === 'POST') return reply({ message: LIMIT_MESSAGE }, 429);
    return reply([]);
  });
});

afterEach(() => {
  delete global.fetch;
});

test('says so in the dialog when the hourly proposal limit is reached', async () => {
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <ProposeTradeDialog otherUserId="them" otherUser={{ username: 'rob' }} onClose={onClose} />
    </MemoryRouter>
  );

  await userEvent.click(await screen.findByRole('button', { name: /My Hobbit/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  await userEvent.click(screen.getByRole('button', { name: /Their Dune/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Send Offer' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(LIMIT_MESSAGE);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});
