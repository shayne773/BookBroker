import { vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Appear from './Appear';
import BookCover from './BookCover';
import Home from './Home';
import useRemembered, { forgetAll } from './remember';
import { saveSession } from './auth';

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

describe('useRemembered', () => {
  const Shelf = ({ id }) => {
    const [books, setBooks] = useRemembered(`/shelf/${id}`);
    return (
      <>
        <p>{books === null ? 'not loaded' : books.join(', ')}</p>
        <button type="button" onClick={() => setBooks(['Dune'])}>load</button>
        <button type="button" onClick={() => setBooks((shown) => [...shown, 'Emma'])}>add</button>
      </>
    );
  };

  it('starts a remounted page from what it loaded last time', () => {
    const first = render(<Shelf id="a" />);
    expect(screen.getByText('not loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByText('load'));
    fireEvent.click(screen.getByText('add'));
    first.unmount();

    render(<Shelf id="a" />);
    expect(screen.getByText('Dune, Emma')).toBeInTheDocument();
  });

  it('keeps each key apart when the key changes under a mounted page', () => {
    const { rerender } = render(<Shelf id="a" />);
    fireEvent.click(screen.getByText('load'));

    rerender(<Shelf id="b" />);
    expect(screen.getByText('not loaded')).toBeInTheDocument();

    rerender(<Shelf id="a" />);
    expect(screen.getByText('Dune')).toBeInTheDocument();
  });

  it('forgets everything when the session changes', () => {
    const first = render(<Shelf id="a" />);
    fireEvent.click(screen.getByText('load'));
    first.unmount();

    saveSession({ token: 't', userId: 'u', username: 'ann' });
    render(<Shelf id="a" />);
    expect(screen.getByText('not loaded')).toBeInTheDocument();
  });
});

describe('a page that loads books', () => {
  const books = [
    { _id: 'a', title: 'Dune' },
    { _id: 'b', title: 'Emma' },
  ];
  let answer;

  beforeEach(() => {
    forgetAll();
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

  it('shows the books at once, with no placeholder or entry, on coming back', async () => {
    const first = renderHome();
    await act(async () => answer());
    await screen.findByText('Dune');
    first.unmount();

    renderHome();
    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(document.querySelector('.appear')).not.toHaveClass('appear--enter');
  });
});
