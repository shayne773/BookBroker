import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, '', '/');
});

test.each(['/home', '/profile', '/messages', '/exchanges', '/browse'])(
  'an unauthenticated visit to %s lands on the sign in page',
  async (path) => {
    window.history.pushState({}, '', path);

    render(<App />);

    expect(await screen.findByText('Sign in to continue')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  }
);
