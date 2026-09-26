import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import UserLink from './UserLink';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('userId', 'me');
});

const renderLink = (props) =>
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<p>Said by <UserLink {...props} /></p>} />
        <Route path="/users/:id" element={<h1>Their profile</h1>} />
        <Route path="/profile" element={<h1>Your profile</h1>} />
      </Routes>
    </MemoryRouter>
  );

test("links another reader's name to their profile, whichever id field the API sent", () => {
  const { unmount } = renderLink({ user: { _id: 'rob', username: 'rob' } });
  expect(screen.getByRole('link', { name: 'rob' })).toHaveAttribute('href', '/users/rob');
  expect(screen.getByRole('link', { name: 'rob' })).toHaveClass('user-link');
  unmount();

  renderLink({ user: { id: 'bea', username: 'bea' } });
  expect(screen.getByRole('link', { name: 'bea' })).toHaveAttribute('href', '/users/bea');
});

test('opens the profile when clicked', () => {
  renderLink({ user: { _id: 'rob', username: 'rob' } });

  fireEvent.click(screen.getByRole('link', { name: 'rob' }));

  expect(screen.getByRole('heading', { name: 'Their profile' })).toBeInTheDocument();
});

test('your own name opens your own profile', () => {
  renderLink({ user: { _id: 'me', username: 'ada' } });

  fireEvent.click(screen.getByRole('link', { name: 'ada' }));

  expect(screen.getByRole('heading', { name: 'Your profile' })).toBeInTheDocument();
});

test('a reader who cannot be shown reads as plain text', () => {
  const { unmount } = renderLink({ user: { username: 'rob' } });
  expect(screen.getByText('Said by rob')).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  unmount();

  renderLink({ user: null, fallback: 'a deleted reader' });
  expect(screen.getByText('Said by a deleted reader')).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('takes a class for running text in place of its own', () => {
  renderLink({ user: { _id: 'rob', username: 'rob' }, className: 'textlink' });

  expect(screen.getByRole('link', { name: 'rob' })).toHaveClass('textlink');
  expect(screen.getByRole('link', { name: 'rob' })).not.toHaveClass('user-link');
});
