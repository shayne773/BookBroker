import { fireEvent, render, screen } from '@testing-library/react';
import BookCover from './BookCover';

test('a book without a cover renders a hidden frame, not its title', () => {
  const { container } = render(<BookCover />);

  const fallback = container.querySelector('.cover__fallback');
  expect(fallback).toHaveAttribute('aria-hidden', 'true');
  expect(fallback).toHaveTextContent(/^No cover$/);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

test('a cover that fails to load falls back to the same frame', () => {
  const { container } = render(<BookCover src="/missing.jpg" />);

  fireEvent.error(container.querySelector('img'));

  expect(container.querySelector('img')).not.toBeInTheDocument();
  expect(container.querySelector('.cover__fallback')).toHaveAttribute('aria-hidden', 'true');
});
