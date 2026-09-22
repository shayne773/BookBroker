import { vi } from 'vitest';
import { authFetch, clearSession, isSessionExpiredError, logout, saveSession, SESSION_EXPIRED_EVENT } from './auth';

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn();
});

afterEach(() => {
  delete global.fetch;
});

test('attaches the bearer token to the request', async () => {
  saveSession({ token: 't0ken', userId: 'u1', username: 'reader' });
  global.fetch.mockResolvedValue({ status: 200, ok: true });

  await authFetch('/messages', { headers: { 'Content-Type': 'application/json' } });

  expect(global.fetch).toHaveBeenCalledWith('/messages', {
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t0ken' }
  });
});

test('a 401 clears the session, announces it, and throws SessionExpiredError', async () => {
  saveSession({ token: 'expired', userId: 'u1', username: 'reader' });
  global.fetch.mockResolvedValue({ status: 401, ok: false });

  const onExpired = vi.fn();
  window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);

  const err = await authFetch('/messages').catch((e) => e);

  expect(isSessionExpiredError(err)).toBe(true);

  expect(onExpired).toHaveBeenCalled();
  expect(localStorage.getItem('token')).toBeNull();
  expect(localStorage.getItem('username')).toBeNull();

  window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
});

test('other failures are left to the caller', async () => {
  saveSession({ token: 't0ken', userId: 'u1', username: 'reader' });
  global.fetch.mockResolvedValue({ status: 500, ok: false });

  const res = await authFetch('/messages');

  expect(res.status).toBe(500);
  expect(localStorage.getItem('token')).toBe('t0ken');
});

test('clearSession removes every stored session value', () => {
  saveSession({ token: 't0ken', userId: 'u1', username: 'reader' });

  clearSession();

  expect(localStorage.getItem('token')).toBeNull();
  expect(localStorage.getItem('userId')).toBeNull();
  expect(localStorage.getItem('username')).toBeNull();
});

test('logout ends the session on the server and clears what is stored', async () => {
  saveSession({ token: 't0ken', userId: 'u1', username: 'reader' });
  global.fetch.mockResolvedValue({ status: 200, ok: true });

  await logout();

  expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/logout$/), {
    method: 'POST',
    headers: { Authorization: 'Bearer t0ken' }
  });
  expect(localStorage.getItem('token')).toBeNull();
  expect(localStorage.getItem('userId')).toBeNull();
});

test('logout clears the stored session even when the server cannot be reached', async () => {
  saveSession({ token: 't0ken', userId: 'u1', username: 'reader' });
  global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
  const onExpired = vi.fn();
  window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  await logout();

  expect(localStorage.getItem('token')).toBeNull();
  expect(onExpired).not.toHaveBeenCalled();

  window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  console.error.mockRestore();
});
