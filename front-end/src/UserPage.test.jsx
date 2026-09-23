import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import UserPage from './UserPage';

const reader = { _id: 'them', username: 'rob', location: 'Queens', ratingsAvg: 0, ratingsCount: 0 };

let blockedByMe;
let calls;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'token');
  localStorage.setItem('userId', 'me');
  blockedByMe = false;
  calls = [];

  global.fetch = vi.fn(async (url, options = {}) => {
    // The API base is unset under test, so the URL is "undefined/<path>".
    const path = String(url).replace(/^[^/]*/, '').split('?')[0];
    const method = options.method || 'GET';
    calls.push({ method, path, body: options.body && JSON.parse(options.body) });
    const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

    if (path === '/users/them/block') {
      blockedByMe = method === 'POST';
      return reply({ blockedByMe });
    }
    if (path === '/users/them/report') return reply({ message: 'Thanks. Your report has been recorded.' }, 201);
    if (path === '/users/them') return reply({ ...reader, blockedByMe });
    if (path === '/users/me') return reply({ _id: 'me', username: 'me', blockedByMe: false });
    if (path === '/users/them/offered') return reply(blockedByMe ? [] : [{ _id: 'b1', title: 'Their Hobbit' }]);
    return reply([]);
  });
});

afterEach(() => {
  delete global.fetch;
});

const renderPage = (id = 'them') =>
  render(
    <MemoryRouter initialEntries={[`/users/${id}`]}>
      <Routes>
        <Route path="/users/:id" element={<UserPage />} />
      </Routes>
    </MemoryRouter>
  );

test('blocking asks for confirmation, then hides their offers and offers an unblock', async () => {
  renderPage();
  expect(await screen.findByText('Their Hobbit')).toBeInTheDocument();

  fireEvent.click(await screen.findByRole('button', { name: 'Block' }));
  const dialog = screen.getByRole('dialog', { name: 'Block rob?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Block' }));

  expect(await screen.findByRole('button', { name: 'Unblock' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Their Hobbit')).not.toBeInTheDocument());
  expect(calls).toContainEqual(expect.objectContaining({ method: 'POST', path: '/users/them/block' }));

  fireEvent.click(screen.getByRole('button', { name: 'Unblock' }));

  expect(await screen.findByRole('button', { name: 'Block' })).toBeInTheDocument();
  expect(calls).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/users/them/block' }));
  expect(await screen.findByText('Their Hobbit')).toBeInTheDocument();
});

test('a report needs a reason and sends it with the optional details', async () => {
  renderPage();

  fireEvent.click(await screen.findByRole('button', { name: 'Report' }));
  const dialog = screen.getByRole('dialog', { name: 'Report rob' });

  fireEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose a reason');
  expect(calls.some((c) => c.path === '/users/them/report')).toBe(false);

  fireEvent.click(within(dialog).getByLabelText('Scam or fraud'));
  fireEvent.change(within(dialog).getByLabelText('Details (optional)'), {
    target: { value: 'Never sent the book.' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));

  expect(await screen.findByText('Thanks. Your report has been recorded.')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls).toContainEqual({
    method: 'POST',
    path: '/users/them/report',
    body: { reason: 'SCAM', details: 'Never sent the book.' },
  });
});

test('your own page offers neither block nor report', async () => {
  renderPage('me');

  await waitFor(() => expect(calls.length).toBeGreaterThan(0));
  expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Report' })).not.toBeInTheDocument();
});
