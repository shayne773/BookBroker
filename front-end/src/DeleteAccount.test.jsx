import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Profile from './Profile';
import Login from './Login';
import UserPage from './UserPage';
import { saveSession } from './auth';

const me = {
  _id: 'me',
  username: 'ada',
  email: 'ada@example.com',
  location: 'Brooklyn, NY',
  zip: '11201',
  maxDistanceMiles: 25,
  ratingsAvg: 0,
  ratingsCount: 0,
  notifications: { messages: true, trades: true, wishlist: true },
};

let routes;
let calls;

beforeEach(() => {
  localStorage.clear();
  saveSession({ token: 'token', userId: 'me', username: 'ada' });
  calls = [];
  routes = { 'GET /user': () => ({ body: me }) };
  global.fetch = vi.fn(async (url, options = {}) => {
    // The API base is unset under test, so the URL is "undefined/<path>".
    const path = String(url).replace(/^[^/]*/, '').split('?')[0];
    const key = `${options.method || 'GET'} ${path}`;
    const body = options.body && JSON.parse(options.body);
    calls.push({ key, body });
    const { status = 200, body: reply = [] } = routes[key]?.(body) ?? {};
    return { ok: status < 400, status, json: async () => reply };
  });
});

afterEach(() => {
  delete global.fetch;
});

const renderProfile = () =>
  render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<Profile />} />
        <Route path="/login" element={<Login />} />
      </Routes>
    </MemoryRouter>
  );

const deleteSection = async () =>
  (await screen.findByRole('heading', { name: 'Delete account' })).closest('section');

test('the profile shows the email, and editing the profile cannot change it', async () => {
  renderProfile();

  expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Edit profile' }));

  const dialog = await screen.findByRole('heading', { name: 'Edit profile' });
  const form = dialog.closest('.dialog-content') ?? document.body;
  expect(within(form).getByLabelText('Username')).toBeInTheDocument();
  expect(within(form).queryByLabelText('Email')).not.toBeInTheDocument();

  await userEvent.type(within(form).getByLabelText('Username'), 'ada2');
  await userEvent.click(within(form).getByRole('button', { name: 'Save' }));

  const edit = calls.find((c) => c.key === 'POST /user/edit');
  expect(edit.body).toEqual({ user: { username: 'ada2' } });
});

test('deleting the account says what goes, and needs the password and the typed confirmation', async () => {
  renderProfile();
  const section = await deleteSection();

  expect(section).toHaveTextContent(/permanent and can.t be undone/);
  expect(section).toHaveTextContent(/offerings, wishlist, blocks and settings are removed/);
  expect(section).toHaveTextContent(/Deleted reader/);
  expect(within(section).queryByLabelText('Your password')).not.toBeInTheDocument();

  await userEvent.click(within(section).getByRole('button', { name: 'Delete my account…' }));
  const submit = within(section).getByRole('button', { name: 'Delete account permanently' });
  expect(submit).toBeDisabled();

  await userEvent.type(within(section).getByLabelText('Your password'), 'hunter2');
  expect(submit).toBeDisabled();
  await userEvent.type(within(section).getByLabelText('Type DELETE to confirm'), 'delete');
  expect(submit).toBeDisabled();
  await userEvent.clear(within(section).getByLabelText('Type DELETE to confirm'));
  await userEvent.type(within(section).getByLabelText('Type DELETE to confirm'), 'DELETE');
  expect(submit).toBeEnabled();
});

test('a wrong password says so beside the form and keeps the reader signed in', async () => {
  routes['POST /user/delete'] = () => ({ status: 400, body: { message: "That password isn't right." } });
  renderProfile();
  const section = await deleteSection();

  await userEvent.click(within(section).getByRole('button', { name: 'Delete my account…' }));
  await userEvent.type(within(section).getByLabelText('Your password'), 'wrong');
  await userEvent.type(within(section).getByLabelText('Type DELETE to confirm'), 'DELETE');
  await userEvent.click(within(section).getByRole('button', { name: 'Delete account permanently' }));

  expect(await within(section).findByText("That password isn't right.")).toBeInTheDocument();
  expect(localStorage.getItem('token')).toBe('token');
  expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
});

test('a deleted account signs this browser out and lands on sign-in with a confirmation', async () => {
  routes['POST /user/delete'] = () => ({ body: { message: 'Your account has been deleted.' } });
  renderProfile();
  const section = await deleteSection();

  await userEvent.click(within(section).getByRole('button', { name: 'Delete my account…' }));
  await userEvent.type(within(section).getByLabelText('Your password'), 'hunter2');
  await userEvent.type(within(section).getByLabelText('Type DELETE to confirm'), 'DELETE');
  await userEvent.click(within(section).getByRole('button', { name: 'Delete account permanently' }));

  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Your account has been deleted.');
  expect(calls.find((c) => c.key === 'POST /user/delete').body).toEqual({ password: 'hunter2' });
  expect(localStorage.getItem('token')).toBe(null);
  expect(localStorage.getItem('userId')).toBe(null);
});

test("a deleted reader's profile says they are gone, with nothing to act on", async () => {
  routes['GET /users/gone'] = () => ({ status: 404, body: { message: 'User not found' } });
  render(
    <MemoryRouter initialEntries={['/users/gone']}>
      <Routes>
        <Route path="/users/:id" element={<UserPage />} />
      </Routes>
    </MemoryRouter>
  );

  expect(await screen.findByRole('heading', { name: 'Deleted reader' })).toBeInTheDocument();
  expect(screen.getByText('This reader has deleted their account.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Block' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Report' })).not.toBeInTheDocument();
});
