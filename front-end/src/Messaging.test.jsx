import { vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Messages from './Messages';
import MessagesDetail from './MessagesDetail';
import Navbar from './Navbar';
import { saveSession } from './auth';

const SERVER = import.meta.env.VITE_SERVER_ADDRESS;
const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });

// Answers each request by its path (and query), recording every call.
function serve(routes) {
  global.fetch = vi.fn(async (url, options = {}) => {
    const path = String(url).slice(String(SERVER).length);
    const key = `${options.method || 'GET'} ${path}`;
    const handler = routes[key] ?? routes[key.split('?')[0]];
    if (!handler) return respond(404, { message: `no route for ${key}` });
    return typeof handler === 'function' ? handler(options) : handler;
  });
}

const calls = (prefix) =>
  global.fetch.mock.calls
    .map(([url, options = {}]) => `${options.method || 'GET'} ${String(url).slice(String(SERVER).length)}`)
    .filter((call) => call.startsWith(prefix));

let visibility = 'visible';
function setVisibility(state) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

beforeEach(() => {
  localStorage.clear();
  visibility = 'visible';
  saveSession({ token: 'token', userId: 'me', username: 'ada' });
});

afterEach(() => {
  vi.useRealTimers();
  delete global.fetch;
});

const message = (id, sender, content, second) => ({
  id,
  sender,
  content,
  timestamp: `2026-09-23T10:00:${String(second).padStart(2, '0')}.000Z`,
});

test('the Messages link carries the number of unread conversations', async () => {
  serve({ 'GET /messages/unread': respond(200, { conversations: 3 }) });

  render(
    <MemoryRouter>
      <Navbar />
    </MemoryRouter>
  );

  const nav = screen.getByRole('navigation', { name: 'Primary' });
  expect(
    await within(nav).findByRole('link', { name: /^Messages\s+3 unread conversations$/ })
  ).toBeInTheDocument();
});

test('the inbox marks a conversation with unread messages', async () => {
  serve({
    'GET /messages': respond(200, [
      { id: 'c1', otherUser: { id: 'bea', username: 'bea' }, lastMessage: 'hi', unread: 2 },
      { id: 'c2', otherUser: { id: 'cal', username: 'cal' }, lastMessage: 'bye', unread: 0 },
    ]),
  });

  render(
    <MemoryRouter>
      <Messages />
    </MemoryRouter>
  );

  const bea = await screen.findByRole('link', { name: /bea/ });
  expect(bea).toHaveClass('list-row--unread');
  expect(within(bea).getByText(/2 new/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /cal/ })).not.toHaveClass('list-row--unread');
});

test('an open conversation marks itself read and polls only for newer messages, pausing while hidden', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let polls = 0;
  serve({
    'GET /users/bea': respond(200, { _id: 'bea', username: 'bea' }),
    'GET /messages/bea': respond(200, [message('m1', 'bea', 'hello', 1)]),
    'GET /messages/bea?after=m1': () => {
      polls += 1;
      return respond(200, polls === 1 ? [message('m2', 'bea', 'still there?', 2)] : []);
    },
    'GET /messages/bea?after=m2': respond(200, []),
    'POST /messages/bea/read': respond(204, null),
    'GET /messages/unread': respond(200, { conversations: 0 }),
  });

  render(
    <MemoryRouter initialEntries={['/messages/bea']}>
      <Routes>
        <Route path="/messages/:user" element={<MessagesDetail />} />
      </Routes>
    </MemoryRouter>
  );

  expect(await screen.findByText('hello')).toBeInTheDocument();
  await waitFor(() => expect(calls('POST /messages/bea/read')).toHaveLength(1));
  expect(JSON.parse(global.fetch.mock.calls.find(([u]) => u.endsWith('/read'))[1].body)).toEqual({
    upTo: 'm1',
  });

  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(await screen.findByText('still there?')).toBeInTheDocument();
  expect(calls('GET /messages/bea?after=m1')).toHaveLength(1);
  await waitFor(() => expect(calls('POST /messages/bea/read')).toHaveLength(2));

  act(() => setVisibility('hidden'));
  const before = calls('GET /messages/bea').length;
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(calls('GET /messages/bea')).toHaveLength(before);

  act(() => setVisibility('visible'));
  await waitFor(() => expect(calls('GET /messages/bea?after=m2')).toHaveLength(1));
});

test('a message sent from the thread does not skip one the other person sent just before it', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  serve({
    'GET /users/bea': respond(200, { _id: 'bea', username: 'bea' }),
    'GET /messages/bea': respond(200, [message('m1', 'bea', 'hello', 1)]),
    'POST /messages/bea': respond(200, { messageId: 'm3', message: message('m3', 'me', 'hi bea', 3) }),
    'GET /messages/bea?after=m1': respond(200, [
      message('m2', 'bea', 'are you there?', 2),
      message('m3', 'me', 'hi bea', 3),
    ]),
    'GET /messages/bea?after=m3': respond(200, []),
    'POST /messages/bea/read': respond(204, null),
    'GET /messages/unread': respond(200, { conversations: 0 }),
  });

  render(
    <MemoryRouter initialEntries={['/messages/bea']}>
      <Routes>
        <Route path="/messages/:user" element={<MessagesDetail />} />
      </Routes>
    </MemoryRouter>
  );

  expect(await screen.findByText('hello')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hi bea' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText('hi bea')).toBeInTheDocument();

  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(await screen.findByText('are you there?')).toBeInTheDocument();
  expect(calls('GET /messages/bea?after=')).toEqual(['GET /messages/bea?after=m1']);
  expect(screen.getAllByText('hi bea')).toHaveLength(1);
});
