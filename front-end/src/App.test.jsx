import { render, screen, within } from '@testing-library/react';
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

test.each(['/home', '/profile', '/messages', '/exchanges', '/browse'])(
  'an unauthenticated visit to %s lands on the sign in page',
  async (path) => {
    window.history.pushState({}, '', path);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  }
);

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
