import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Login from './Login';

const renderLogin = (entry = { pathname: '/login' }) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/home" element={<div>Home page</div>} />
        <Route path="/messages" element={<div>Messages page</div>} />
      </Routes>
    </MemoryRouter>
  );

const fillAndSubmit = async () => {
  await userEvent.type(screen.getByLabelText('Email'), 'reader@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'hunter2');
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
};

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn();
});

afterEach(() => {
  delete global.fetch;
});

test('shows the server error when the password is wrong', async () => {
  global.fetch.mockResolvedValue({
    ok: false,
    status: 401,
    json: async () => ({ message: 'Invalid credentials' })
  });

  renderLogin();
  await fillAndSubmit();

  expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
});

test('stores the session and goes to home after a successful login', async () => {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ token: 't0ken', user: { id: 'u1', username: 'reader' } })
  });

  renderLogin();
  await fillAndSubmit();

  expect(await screen.findByText('Home page')).toBeInTheDocument();
  expect(localStorage.getItem('token')).toBe('t0ken');
  expect(localStorage.getItem('userId')).toBe('u1');
  expect(localStorage.getItem('username')).toBe('reader');
});

test('returns to the page the visitor was sent away from', async () => {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ token: 't0ken', user: { id: 'u1', username: 'reader' } })
  });

  renderLogin({ pathname: '/login', state: { from: { pathname: '/messages', search: '' } } });
  await fillAndSubmit();

  expect(await screen.findByText('Messages page')).toBeInTheDocument();
});

test('clears a previous error when the next attempt succeeds', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    json: async () => ({ message: 'Invalid credentials' })
  });

  renderLogin();
  await fillAndSubmit();
  expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();

  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ token: 't0ken', user: { id: 'u1', username: 'reader' } })
  });

  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

  await waitFor(() => expect(screen.queryByText('Invalid credentials')).not.toBeInTheDocument());
});

test('offers to resend the confirmation email when the address is not confirmed', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: false,
    status: 403,
    json: async () => ({
      message: 'Please confirm your email address before signing in.',
      code: 'EMAIL_NOT_CONFIRMED'
    })
  });

  renderLogin();
  await fillAndSubmit();

  expect(await screen.findByText('Please confirm your email address before signing in.')).toBeInTheDocument();

  global.fetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ message: 'We have sent it a new link.' })
  });
  await userEvent.click(screen.getByRole('button', { name: 'Resend confirmation email' }));

  expect(await screen.findByText('We have sent it a new link.')).toBeInTheDocument();
  const [url, options] = global.fetch.mock.calls[1];
  expect(url).toMatch(/\/auth\/resend-confirmation$/);
  expect(JSON.parse(options.body)).toEqual({ email: 'reader@example.com' });
});

test('links to the forgot password page', () => {
  renderLogin();

  expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
});

test('tells a suspended reader their account is suspended and keeps them signed out', async () => {
  global.fetch.mockResolvedValue({
    ok: false,
    status: 403,
    json: async () => ({
      message: 'This account has been suspended. If you think this is a mistake, contact BookBroker.',
      code: 'ACCOUNT_SUSPENDED'
    })
  });

  renderLogin();
  await fillAndSubmit();

  expect(await screen.findByRole('alert')).toHaveTextContent('This account has been suspended.');
  expect(localStorage.getItem('token')).toBeNull();
  expect(screen.queryByText('Home page')).not.toBeInTheDocument();
});
