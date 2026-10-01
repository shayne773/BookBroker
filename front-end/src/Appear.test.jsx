import { vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Appear from './Appear';
import BookCover from './BookCover';
import Home from './Home';

const List = () => (
  <ul className="book-list">
    <li>Dune</li>
  </ul>
);

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('Appear', () => {
  it('holds the place with its placeholder, then brings the content in as an entry', () => {
    const { rerender, container } = render(
      <Appear ready={false} placeholder={<p>placeholder</p>}><List /></Appear>
    );
    expect(screen.getByText('placeholder')).toBeInTheDocument();
    expect(screen.queryByText('Dune')).not.toBeInTheDocument();

    rerender(<Appear ready placeholder={<p>placeholder</p>}><List /></Appear>);
    expect(screen.queryByText('placeholder')).not.toBeInTheDocument();
    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('appear', 'appear--enter');
  });

  it('only fades content that was on hand from the start', () => {
    const { container } = render(<Appear ready><List /></Appear>);
    expect(container.firstChild).toHaveClass('appear');
    expect(container.firstChild).not.toHaveClass('appear--enter');
  });

  it('settles after the entry, so what is added later does not replay it', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<Appear ready={false}><List /></Appear>);
    rerender(<Appear ready><List /></Appear>);
    expect(container.firstChild).toHaveClass('appear--enter');

    act(() => vi.advanceTimersByTime(1000));
    expect(container.firstChild).toHaveClass('appear');
    expect(container.firstChild).not.toHaveClass('appear--enter');
  });

  it('enters again once it has been waited for again', () => {
    vi.useFakeTimers();
    const { rerender, container } = render(<Appear ready={false}><List /></Appear>);
    rerender(<Appear ready><List /></Appear>);
    act(() => vi.advanceTimersByTime(1000));

    rerender(<Appear ready={false}><List /></Appear>);
    rerender(<Appear ready><List /></Appear>);
    expect(container.firstChild).toHaveClass('appear--enter');
  });
});

describe('a cover', () => {
  it('stays clear until its image has loaded, then fades in', () => {
    const { container } = render(<BookCover src="https://covers.test/dune.jpg" />);
    const img = container.querySelector('img');
    expect(img).toHaveClass('fade-img');
    expect(img).not.toHaveClass('is-loaded');

    fireEvent.load(img);
    expect(img).toHaveClass('is-loaded');
  });

  it('waits again when it is given another image', () => {
    const { container, rerender } = render(<BookCover src="https://covers.test/dune.jpg" />);
    fireEvent.load(container.querySelector('img'));

    rerender(<BookCover src="https://covers.test/emma.jpg" />);
    expect(container.querySelector('img')).not.toHaveClass('is-loaded');
  });

  it('falls back to the empty frame when its image fails', () => {
    const { container } = render(<BookCover src="https://covers.test/gone.jpg" />);
    fireEvent.error(container.querySelector('img'));
    expect(screen.getByText('No cover')).toBeInTheDocument();
  });
});

describe('a page that loads books', () => {
  const books = [
    { _id: 'a', title: 'Dune' },
    { _id: 'b', title: 'Emma' },
  ];
  let answer;

  beforeEach(() => {
    global.fetch = vi.fn(
      () => new Promise((resolve) => {
        answer = () => resolve({ ok: true, status: 200, json: async () => books });
      })
    );
  });

  afterEach(() => {
    delete global.fetch;
  });

  const renderHome = () => render(<MemoryRouter><Home /></MemoryRouter>);

  it('shows its heading and a placeholder at once, then the books', async () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Loading…');
    expect(screen.queryByText('No books found in this genre.')).not.toBeInTheDocument();

    await act(async () => answer());
    expect(await screen.findByText('Dune')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(document.querySelector('.appear')).toHaveClass('appear--enter');
  });

  it('loads afresh on coming back, behind the placeholder again', async () => {
    const first = renderHome();
    await act(async () => answer());
    await screen.findByText('Dune');
    first.unmount();

    renderHome();
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Loading…');
    expect(screen.queryByText('Dune')).not.toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);

    await act(async () => answer());
    expect(await screen.findByText('Dune')).toBeInTheDocument();
    expect(document.querySelector('.appear')).toHaveClass('appear--enter');
  });
});
