import { vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import BookPage from './BookPage';
import BookList from './Browse/BookList';
import AddBookDialog from './Profile/AddBookDialog';
import { blobUpload, imageCodec } from './photos';

const photos = [
  { _id: 'p1', url: 'https://blob.example/books/b1/1.jpg', width: 1600, height: 1200 },
  { _id: 'p2', url: 'https://blob.example/books/b1/2.jpg', width: 1200, height: 1600 },
];

const bookWith = (fields) => ({
  _id: 'b1',
  title: 'The Hobbit',
  author: 'J. R. R. Tolkien',
  isbn: '9780261103344',
  owner: { id: 'rob', username: 'rob', location: 'Queens, NY' },
  photos: [],
  photoUploads: false,
  ...fields,
});

const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });
const { decode, draw } = imageCodec;
let routes;
let requests;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'token');
  localStorage.setItem('userId', 'me');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  requests = [];
  routes = { 'GET /user/wishlist/9780261103344': respond(200, { exists: false }) };
  global.fetch = vi.fn(async (url, options = {}) => {
    const key = `${options.method || 'GET'} ${String(url).replace(/^[^/]*/, '')}`;
    requests.push({ key, body: options.body && JSON.parse(options.body) });
    return routes[key] ?? respond(404, { message: `no route for ${key}` });
  });
});

afterEach(() => {
  imageCodec.decode = decode;
  imageCodec.draw = draw;
  delete global.fetch;
  vi.restoreAllMocks();
});

const renderPage = async (book) => {
  routes['GET /books/b1'] = respond(200, book);
  render(
    <MemoryRouter initialEntries={['/books/b1']}>
      <Routes>
        <Route path="/books/:id" element={<BookPage />} />
      </Routes>
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'The Hobbit' });
};

describe('the gallery', () => {
  test("shows the owner's photos below the cover, and nothing when there are none", async () => {
    await renderPage(bookWith({ photos }));

    expect(screen.getByRole('heading', { name: 'Photos of this copy' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Enlarge photo/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Add photos/ })).not.toBeInTheDocument();
  });

  test('has no photo section for a book without photos', async () => {
    await renderPage(bookWith({}));
    expect(screen.queryByText(/Photos of this copy/)).not.toBeInTheDocument();
  });

  test('enlarges a photo in place, steps with the arrow keys and closes with Escape', async () => {
    await renderPage(bookWith({ photos }));

    const first = screen.getByRole('button', { name: 'Enlarge photo 1 of 2' });
    fireEvent.click(first);

    // In the page, not a pop-up: no dialog, and the large view has the focus.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const large = screen.getByRole('img', { name: 'Photo 1 of 2 of The Hobbit' });
    expect(large).toHaveAttribute('src', photos[0].url);
    expect(first).toHaveAttribute('aria-pressed', 'true');
    const viewer = large.closest('figure');
    expect(viewer).toHaveFocus();

    fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    expect(screen.getByRole('img', { name: 'Photo 2 of 2 of The Hobbit' })).toHaveAttribute('src', photos[1].url);
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByRole('img', { name: 'Photo 1 of 2 of The Hobbit' })).toBeInTheDocument();

    fireEvent.keyDown(viewer, { key: 'Escape' });
    expect(screen.queryByRole('img', { name: /Photo 1 of 2/ })).not.toBeInTheDocument();
    expect(first).toHaveFocus();
  });

  test("lets a reader report the photos, as a report of their owner naming the book", async () => {
    routes['POST /users/rob/report'] = respond(201, { message: 'Thanks. Your report has been recorded.' });
    await renderPage(bookWith({ photos }));

    fireEvent.click(screen.getByRole('button', { name: 'Report these photos' }));
    const dialog = screen.getByRole('dialog', { name: 'Report rob' });
    expect(within(dialog).getByRole('radio', { name: 'Inappropriate content' })).toBeChecked();
    expect(within(dialog).getByRole('textbox').value).toContain('About the photos of "The Hobbit"');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));

    expect(await screen.findByText('Thanks. Your report has been recorded.')).toBeInTheDocument();
    const report = requests.find((r) => r.key === 'POST /users/rob/report');
    expect(report.body.reason).toBe('INAPPROPRIATE');
    expect(report.body.details).toContain('/books/b1');
  });
});

describe("the owner's photo controls", () => {
  test('are hidden when the book is not yours', async () => {
    await renderPage(bookWith({ photos }));
    expect(screen.queryByRole('button', { name: /Add photos/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove photo/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Your photos/)).not.toBeInTheDocument();
  });

  test('still remove and reorder, but not add, when photos are off (no Blob store)', async () => {
    await renderPage(bookWith({ photos, isOwner: true, photoUploads: false }));
    expect(screen.getByRole('heading', { name: 'Your photos of this copy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove photo 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move photo 2 earlier' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add (more )?photos/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report these photos' })).not.toBeInTheDocument();
  });

  test('give way to a note while an accepted trade holds the book', async () => {
    await renderPage(bookWith({ photos, isOwner: true, photoUploads: true, locked: true }));
    expect(screen.getByText(/in an accepted trade, so its photos can't change/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Enlarge photo/ })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Remove photo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add (more )?photos/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Report these photos' })).not.toBeInTheDocument();
  });

  test('remove a photo', async () => {
    routes['DELETE /user/offered/b1/photos/p1'] = respond(200, { photos: [photos[1]] });
    await renderPage(bookWith({ photos, isOwner: true, photoUploads: true }));

    expect(screen.getByRole('heading', { name: 'Your photos of this copy' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo 1' }));

    expect(await screen.findAllByRole('button', { name: /Enlarge photo \d of 1/ })).toHaveLength(1);
    expect(screen.getByText('Main photo')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove photo 2' })).not.toBeInTheDocument();
  });

  test('move a photo, making it the main one', async () => {
    routes['PUT /user/offered/b1/photos/order'] = respond(200, { photos: [photos[1], photos[0]] });
    await renderPage(bookWith({ photos, isOwner: true, photoUploads: true }));

    // The first photo cannot move earlier.
    expect(screen.getByRole('button', { name: 'Move photo 1 earlier' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Move photo 2 earlier' }));

    await screen.findByRole('button', { name: 'Move photo 1 later' });
    const order = requests.find((r) => r.key === 'PUT /user/offered/b1/photos/order');
    expect(order.body).toEqual({ order: ['p2', 'p1'] });
    const thumbs = screen.getAllByRole('button', { name: /Enlarge photo/ });
    expect(thumbs[0].querySelector('img')).toHaveAttribute('src', photos[1].url);
  });

  test('add photos, with progress, then say how it went', async () => {
    imageCodec.decode = async () => ({ width: 3200, height: 2400 });
    imageCodec.draw = () => async () => new Blob(['jpeg'], { type: 'image/jpeg' });
    routes['POST /user/offered/b1/photos/upload-token'] = respond(200, { token: 't', pathname: 'books/b1/new.jpg' });
    const added = { _id: 'p3', url: 'https://blob.example/books/b1/new.jpg', width: 1600, height: 1200 };
    routes['POST /user/offered/b1/photos'] = respond(201, { photos: [added] });
    // The last progress report comes on a timer after put() has resolved, as the SDK's throttle sends it.
    vi.spyOn(blobUpload, 'put').mockImplementation(async (pathname, blob, options) => {
      options.onUploadProgress({ loaded: 1, total: 2, percentage: 40 });
      setTimeout(() => options.onUploadProgress({ loaded: 2, total: 2, percentage: 100 }), 0);
      return { url: `https://blob.example/${pathname}` };
    });

    await renderPage(bookWith({ isOwner: true, photoUploads: true }));
    const input = document.querySelector('input[type="file"]');
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    fireEvent.change(input, { target: { files: [new File(['x'], 'copy.jpg', { type: 'image/jpeg' })] } });

    expect(await screen.findByText('Photo added')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enlarge photo 1 of 1' })).toBeInTheDocument();
    // Once the upload is done its progress line goes, and a late report does not bring it back.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.queryByText(/Uploading photo/)).not.toBeInTheDocument();
    expect(requests.find((r) => r.key === 'POST /user/offered/b1/photos').body).toEqual({
      url: 'https://blob.example/books/b1/new.jpg',
      width: 1600,
      height: 1200,
    });
  });

  test('say why a photo could not be added, inline', async () => {
    await renderPage(bookWith({ isOwner: true, photoUploads: true }));
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [new File(['x'], 'scan.gif', { type: 'image/gif' })] } });

    expect(await screen.findByText('Photos must be JPEG, PNG or WebP.')).toBeInTheDocument();
    expect(requests.some((r) => r.key.includes('/photos'))).toBe(false);
  });
});

test('a list keeps the cover as the thumbnail and hints at the photos', () => {
  render(
    <MemoryRouter>
      <BookList books={[{ _id: 'b1', title: 'The Hobbit', cover: 'https://covers.example/1.jpg', photoCount: 3 }]} />
    </MemoryRouter>
  );
  expect(screen.getByText('3 photos')).toBeInTheDocument();
  expect(document.querySelector('.cover img')).toHaveAttribute('src', 'https://covers.example/1.jpg');
});

describe('the offer dialog', () => {
  const search = { text: '', results: [], selected: null, type: () => {}, pick: () => {} };

  test('offers photos when they are on', () => {
    render(<AddBookDialog title="Add a book" search={search} photos={[]} onPhotos={() => {}} onSubmit={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Photos of your copy (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add photos' })).toBeInTheDocument();
  });

  test('has no photos without a Blob store', () => {
    render(<AddBookDialog title="Add a book" search={search} onSubmit={() => {}} onClose={() => {}} />);
    expect(screen.queryByText(/Photos of your copy/)).not.toBeInTheDocument();
  });
});
