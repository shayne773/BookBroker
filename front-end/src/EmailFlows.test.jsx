import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ConfirmEmail from './ConfirmEmail';
import ConfirmEmailChange from './ConfirmEmailChange';
import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';
import Signup from './Signup';

const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });

const renderAt = (path) =>
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/signup" element={<Signup />} />
          <Route path="/confirm-email" element={<ConfirmEmail />} />
          <Route path="/confirm-email-change" element={<ConfirmEmailChange />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>
  );

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  delete global.fetch;
});

test('sign-up ends on a check-your-email state', async () => {
  global.fetch.mockResolvedValue(respond(201, { message: 'Account created.' }));
  renderAt('/signup');

  await userEvent.type(screen.getByLabelText('Email'), 'reader@example.com');
  await userEvent.type(screen.getByLabelText('Username'), 'reader');
  await userEvent.type(screen.getByLabelText('Password'), 'Str0ngPassw0rd');
  await userEvent.type(screen.getByLabelText('Confirm'), 'Str0ngPassw0rd');
  await userEvent.selectOptions(screen.getByLabelText('City'), 'Chicago');
  await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));

  expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
  expect(screen.getByText('reader@example.com')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resend confirmation email' })).toBeInTheDocument();
});

test('confirm-email spends the token once and reports success', async () => {
  global.fetch.mockResolvedValue(respond(200, { message: 'Email confirmed. You can sign in now.' }));
  renderAt('/confirm-email?token=abc');

  expect(await screen.findByRole('heading', { name: 'Email confirmed' })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ token: 'abc' });
  expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
});

test('confirm-email offers a new link when the token is spent', async () => {
  global.fetch.mockResolvedValue(respond(400, {
    message: 'This confirmation link has expired or has already been used.',
    code: 'TOKEN_INVALID'
  }));
  renderAt('/confirm-email?token=used');

  expect(await screen.findByText('This confirmation link has expired or has already been used.')).toBeInTheDocument();
  expect(screen.getByLabelText('Email')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resend confirmation email' })).toBeInTheDocument();
});

test('forgot password shows the server answer after sending', async () => {
  global.fetch.mockResolvedValue(respond(200, { message: 'If an account uses that address, we have sent it a link.' }));
  renderAt('/forgot-password');

  await userEvent.type(screen.getByLabelText('Email'), 'reader@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

  expect(await screen.findByText('If an account uses that address, we have sent it a link.')).toBeInTheDocument();
});

test('reset password refuses mismatched passwords without calling the API', async () => {
  renderAt('/reset-password?token=abc');

  await userEvent.type(screen.getByLabelText('New password'), 'N3wPassw0rd');
  await userEvent.type(screen.getByLabelText('Confirm'), 'Different1');
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));

  expect(screen.getByText('Passwords do not match!')).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('reset password sends the token and new password', async () => {
  global.fetch.mockResolvedValue(respond(200, { message: 'Password updated. You can sign in with it now.' }));
  renderAt('/reset-password?token=abc');

  await userEvent.type(screen.getByLabelText('New password'), 'N3wPassw0rd');
  await userEvent.type(screen.getByLabelText('Confirm'), 'N3wPassw0rd');
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));

  expect(await screen.findByRole('heading', { name: 'Password updated' })).toBeInTheDocument();
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ token: 'abc', password: 'N3wPassw0rd' });
});

test('reset password offers a new link when the token is spent', async () => {
  global.fetch.mockResolvedValue(respond(400, {
    message: 'This reset link has expired or has already been used.',
    code: 'TOKEN_INVALID'
  }));
  renderAt('/reset-password?token=used');

  await userEvent.type(screen.getByLabelText('New password'), 'N3wPassw0rd');
  await userEvent.type(screen.getByLabelText('Confirm'), 'N3wPassw0rd');
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));

  expect(await screen.findByText('This reset link has expired or has already been used.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute('href', '/forgot-password');
});

test('confirm-email-change spends the token once and reports the new address in effect', async () => {
  global.fetch.mockResolvedValue(respond(200, { message: 'Email changed. Use your new address to sign in.' }));
  renderAt('/confirm-email-change?token=xyz');

  expect(await screen.findByRole('heading', { name: 'Email changed' })).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toMatch(/\/auth\/confirm-email-change$/);
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ token: 'xyz' });
});

test('confirm-email-change shows why a refused link did not work', async () => {
  global.fetch.mockResolvedValue(respond(409, { message: 'Email already in use' }));
  renderAt('/confirm-email-change?token=xyz');

  expect(await screen.findByRole('alert')).toHaveTextContent('Email already in use');
  expect(screen.getByText(/Your email has not changed/)).toBeInTheDocument();
});
