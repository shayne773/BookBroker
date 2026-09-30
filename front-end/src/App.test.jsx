import { fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { saveSession } from './auth';

// Home reveals its sections on scroll; jsdom has no IntersectionObserver.
beforeAll(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, '', '/');
  // Pages load their data on mount; an empty list keeps each one on its empty state.
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
});

afterEach(() => {
  delete global.fetch;
});

test.each(['/profile', '/profile/my-books', '/messages', '/messages/user-2', '/exchanges', '/feed'])(
  'an unauthenticated visit to the account-only page %s lands on the sign in page',
  async (path) => {
    window.history.pushState({}, '', path);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  }
);

test.each([
  ['/', 'Home'],
  ['/home', 'Home'],
  ['/browse', 'Browse'],
])('a visitor without an account can browse %s', async (path, title) => {
  window.history.pushState({}, '', path);

  render(<App />);

  expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual([
    'Home',
    'Browse',
    'Map',
    'Exchanges',
    'Messages',
    'Profile',
    'Sign in',
  ]);
});

test('a visitor following an account-only link is asked to sign up, and can dismiss it', async () => {
  window.history.pushState({}, '', '/browse');
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Browse' });

  fireEvent.click(screen.getByRole('link', { name: 'Messages' }));

  const dialog = screen.getByRole('dialog', { name: 'Sign up to message readers' });
  expect(within(dialog).getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
  expect(within(dialog).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  expect(window.location.pathname).toBe('/browse');

  fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(window.location.pathname).toBe('/browse');
});

test('signing up from the prompt, then signing in, returns the reader to the page they were on', async () => {
  global.fetch = vi.fn(async (url) => {
    if (String(url).endsWith('/auth/login')) {
      return { ok: true, status: 200, json: async () => ({ token: 't', user: { id: 'user-1', username: 'ada' } }) };
    }
    return { ok: true, status: 200, json: async () => [] };
  });
  window.history.pushState({}, '', '/browse');
  render(<App />);
  await screen.findByRole('heading', { level: 1, name: 'Browse' });

  fireEvent.click(screen.getByRole('link', { name: 'Profile' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Sign up' }));

  expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  // An existing reader switches to sign in from the sign-up page.
  fireEvent.click(screen.getByRole('link', { name: 'Log in' }));
  await screen.findByRole('heading', { name: 'Sign in' });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

  expect(await screen.findByRole('heading', { level: 1, name: 'Browse' })).toBeInTheDocument();
  expect(window.location.pathname).toBe('/browse');
  expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
});

test('the sign in page carries no site navigation', async () => {
  window.history.pushState({}, '', '/login');

  render(<App />);

  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
});

test('a signed-in visit renders the shell: primary navigation around the page', async () => {
  saveSession({ token: 'token', userId: 'user-1', username: 'ada' });
  window.history.pushState({}, '', '/home');

  render(<App />);

  expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  const links = within(nav).getAllByRole('link');
  expect(links.map((link) => link.textContent)).toEqual([
    'Home',
    'Browse',
    'Map',
    'Exchanges',
    'Messages',
    'Profile',
  ]);
  expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
});
