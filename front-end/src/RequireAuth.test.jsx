import { vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import RequireAuth from './RequireAuth';
import { authFetch, expireSession } from './auth';

const LoginStub = () => {
  const location = useLocation();
  return <div>Login page for {location.state?.from?.pathname || 'nowhere'}</div>;
};

const renderAt = (path, Protected = () => <div>Protected page</div>) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginStub />} />
        <Route element={<RequireAuth />}>
          <Route path="/messages" element={<Protected />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn();
});

afterEach(() => {
  delete global.fetch;
});

test('sends a visitor without a token to the login page', () => {
  renderAt('/messages');

  expect(screen.getByText('Login page for /messages')).toBeInTheDocument();
});

test('renders the page when a token is present', () => {
  localStorage.setItem('token', 't0ken');

  renderAt('/messages');

  expect(screen.getByText('Protected page')).toBeInTheDocument();
});

test('sends the visitor to login as soon as the session expires', async () => {
  localStorage.setItem('token', 't0ken');
  localStorage.setItem('userId', 'u1');

  renderAt('/messages');
  expect(screen.getByText('Protected page')).toBeInTheDocument();

  act(() => expireSession());

  expect(await screen.findByText(/Login page for/)).toBeInTheDocument();
  expect(localStorage.getItem('token')).toBeNull();
  expect(localStorage.getItem('userId')).toBeNull();
});

test('a 401 from any page ends the session and redirects', async () => {
  localStorage.setItem('token', 'expired');
  global.fetch.mockResolvedValue({ status: 401, ok: false, json: async () => ({}) });

  const Protected = () => {
    authFetch('/messages').catch(() => {});
    return <div>Protected page</div>;
  };

  renderAt('/messages', Protected);

  expect(await screen.findByText(/Login page for/)).toBeInTheDocument();
  expect(localStorage.getItem('token')).toBeNull();
});
