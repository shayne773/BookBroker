import { vi } from 'vitest';
import {
  blobUpload,
  fitWithin,
  imageCodec,
  MAX_EDGE,
  PhotoError,
  photoCountLabel,
  preparePhoto,
  TARGET_BYTES,
  UPLOAD_STALL_MS,
  uploadOutcome,
  uploadPhoto,
} from './photos';

const { decode, draw } = imageCodec;

// A camera JPEG: pixels behind an EXIF block that records where it was taken.
const cameraFile = (type = 'image/jpeg') =>
  new File(['\xff\xd8\xff\xe1Exif\0\0GPSLatitude 40.6943 GPSLongitude -73.9906', 'pixels'], 'IMG_0001.jpg', { type });

// A decoded image of `width` × `height`, and a canvas that encodes it to
// `sizes` bytes at each quality asked, in turn, recording what it was asked.
function fakeCodec({ width = 4032, height = 3024, sizes = [300_000] } = {}) {
  const calls = { drawn: null, qualities: [], closed: false };
  imageCodec.decode = vi.fn(async () => ({ width, height, close: () => (calls.closed = true) }));
  imageCodec.draw = vi.fn((image, w, h) => {
    calls.drawn = { w, h };
    return async (quality) => {
      calls.qualities.push(quality);
      const size = sizes[calls.qualities.length - 1] ?? sizes.at(-1);
      return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
    };
  });
  return calls;
}

// jsdom's Blob has no text(); its FileReader reads one.
const readText = (blob) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });

afterEach(() => {
  imageCodec.decode = decode;
  imageCodec.draw = draw;
  vi.restoreAllMocks();
});

describe('fitWithin', () => {
  test('shrinks the long edge to the limit, keeping the proportions', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(5000, 10)).toEqual({ width: 1600, height: 3 });
  });

  test('never enlarges a small photo', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(MAX_EDGE, MAX_EDGE)).toEqual({ width: 1600, height: 1600 });
  });
});

describe('preparePhoto', () => {
  test('re-encodes the photo as a JPEG at most 1600 px on its long edge', async () => {
    const calls = fakeCodec({ width: 4032, height: 3024 });

    const prepared = await preparePhoto(cameraFile());

    expect(prepared).toMatchObject({ width: 1600, height: 1200 });
    expect(calls.drawn).toEqual({ w: 1600, h: 1200 });
    expect(prepared.blob.type).toBe('image/jpeg');
    expect(calls.closed).toBe(true);
  });

  test('never passes the original file on, so its EXIF metadata (and location) is dropped', async () => {
    fakeCodec({ width: 800, height: 600 });
    const file = cameraFile();

    const { blob } = await preparePhoto(file);

    expect(blob).not.toBe(file);
    const bytes = await readText(blob);
    expect(bytes).not.toContain('Exif');
    expect(bytes).not.toContain('GPS');
  });

  test('decodes the photo upright, applying its EXIF orientation before dropping it', async () => {
    const createImageBitmap = vi.fn(async () => ({ width: 10, height: 10 }));
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    imageCodec.draw = () => async () => new Blob(['x'], { type: 'image/jpeg' });
    const file = cameraFile();

    await preparePhoto(file);

    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    vi.unstubAllGlobals();
  });

  test('lowers the quality until the photo is well under 2 MB', async () => {
    const calls = fakeCodec({ sizes: [TARGET_BYTES + 1, TARGET_BYTES + 1, 900_000] });

    const { blob } = await preparePhoto(cameraFile('image/png'));

    expect(calls.qualities).toEqual([0.85, 0.75, 0.6]);
    expect(blob.size).toBe(900_000);
  });

  test('gives up on a photo that stays too large', async () => {
    fakeCodec({ sizes: [TARGET_BYTES * 2] });
    await expect(preparePhoto(cameraFile())).rejects.toThrow(/too detailed/);
  });

  test('refuses anything but JPEG, PNG or WebP without reading it', async () => {
    fakeCodec();
    for (const type of ['image/gif', 'image/heic', 'application/pdf', '']) {
      await expect(preparePhoto(cameraFile(type))).rejects.toThrow('Photos must be JPEG, PNG or WebP.');
    }
    expect(imageCodec.decode).not.toHaveBeenCalled();
  });

  test('says so when the photo cannot be decoded', async () => {
    imageCodec.decode = async () => {
      throw new Error('bad image');
    };
    await expect(preparePhoto(cameraFile())).rejects.toThrow(new PhotoError('This photo could not be read.'));
  });
});

describe('uploadPhoto', () => {
  const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });
  let requests;

  beforeEach(() => {
    localStorage.setItem('token', 'token');
    requests = [];
    fakeCodec({ width: 3000, height: 2000, sizes: [400_000] });
  });

  afterEach(() => {
    delete global.fetch;
    localStorage.clear();
  });

  const api = (routes) => {
    global.fetch = vi.fn(async (url, options = {}) => {
      const key = `${options.method || 'GET'} ${String(url).replace(/^[^/]*/, '')}`;
      requests.push({ key, body: options.body && JSON.parse(options.body) });
      return routes[key] ?? respond(404, {});
    });
  };

  test('asks for a token, uploads the prepared photo straight to Blob, then saves its URL and size', async () => {
    const photos = [{ _id: 'p1', url: 'https://blob.example/books/b1/a.jpg', width: 1600, height: 1067 }];
    api({
      'POST /user/offered/b1/photos/upload-token': respond(200, { token: 'client-token', pathname: 'books/b1/a.jpg' }),
      'POST /user/offered/b1/photos': respond(201, { photos }),
    });
    const put = vi.spyOn(blobUpload, 'put').mockImplementation(async (pathname, blob, options) => {
      options.onUploadProgress({ loaded: 1, total: 2, percentage: 50 });
      return { url: `https://blob.example/${pathname}` };
    });
    const progress = [];

    const result = await uploadPhoto('b1', cameraFile(), { onProgress: (p) => progress.push(p) });

    expect(result).toEqual(photos);
    expect(requests[0]).toEqual({
      key: 'POST /user/offered/b1/photos/upload-token',
      body: { contentType: 'image/jpeg', size: 400_000 },
    });
    const [pathname, blob, options] = put.mock.calls[0];
    expect(pathname).toBe('books/b1/a.jpg');
    expect(blob.size).toBe(400_000);
    expect(options).toMatchObject({ access: 'public', token: 'client-token', contentType: 'image/jpeg' });
    expect(progress).toEqual([50]);
    expect(requests[1]).toEqual({
      key: 'POST /user/offered/b1/photos',
      body: { url: 'https://blob.example/books/b1/a.jpg', width: 1600, height: 1067 },
    });
  });

  test('drops a progress report that arrives after the upload has finished', async () => {
    api({
      'POST /user/offered/b1/photos/upload-token': respond(200, { token: 't', pathname: 'books/b1/a.jpg' }),
      'POST /user/offered/b1/photos': respond(201, { photos: [] }),
    });
    // The SDK's throttle reports the last 100% on a trailing timer, after put() resolves.
    let late;
    vi.spyOn(blobUpload, 'put').mockImplementation(async (pathname, blob, options) => {
      options.onUploadProgress({ loaded: 1, total: 2, percentage: 50 });
      late = () => options.onUploadProgress({ loaded: 2, total: 2, percentage: 100 });
      return { url: `https://blob.example/${pathname}` };
    });
    const progress = [];

    await uploadPhoto('b1', cameraFile(), { onProgress: (p) => progress.push(p) });
    late();

    expect(progress).toEqual([50]);
  });

  test("stops with the API's words when it refuses the upload", async () => {
    api({ 'POST /user/offered/b1/photos/upload-token': respond(409, { message: 'A book can have up to 4 photos.' }) });
    const put = vi.spyOn(blobUpload, 'put');

    await expect(uploadPhoto('b1', cameraFile())).rejects.toThrow('A book can have up to 4 photos.');
    expect(put).not.toHaveBeenCalled();
  });

  test('says the upload failed when Blob refuses it, and saves nothing', async () => {
    api({ 'POST /user/offered/b1/photos/upload-token': respond(200, { token: 't', pathname: 'books/b1/a.jpg' }) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(blobUpload, 'put').mockRejectedValue(new Error('network'));

    await expect(uploadPhoto('b1', cameraFile())).rejects.toThrow(/could not be uploaded/);
    expect(requests.map((r) => r.key)).toEqual(['POST /user/offered/b1/photos/upload-token']);
  });

  describe('when the upload stops getting further', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      api({
        'POST /user/offered/b1/photos/upload-token': respond(200, { token: 't', pathname: 'books/b1/a.jpg' }),
        'POST /user/offered/b1/photos': respond(201, { photos: [] }),
      });
    });

    afterEach(() => vi.useRealTimers());

    // The SDK's put() when Blob refuses a photo of `chunks` 64 KB pieces (for
    // one, a public upload to a private store): the refusal has no CORS header,
    // so the browser reports a network error, and the SDK retries ten times
    // with backoff, streaming the pieces again each time. It never reports
    // 100% for an attempt, so a 3-piece photo sat at 66% for about 17 minutes.
    function refusedBehindCors(chunks) {
      const seen = { signal: null, attempts: 0 };
      vi.spyOn(blobUpload, 'put').mockImplementation(async (pathname, blob, options) => {
        seen.signal = options.abortSignal;
        options.onUploadProgress({ loaded: 0, total: chunks, percentage: 0 });
        for (let attempt = 0; attempt <= 10; attempt++) {
          if (seen.signal?.aborted) throw new Error('The request was aborted.');
          seen.attempts++;
          for (let loaded = 1; loaded < chunks; loaded++) {
            options.onUploadProgress({ loaded, total: chunks, percentage: (loaded / chunks) * 100 });
          }
          await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        }
        throw new TypeError('Failed to fetch');
      });
      return seen;
    }

    // `promise`'s outcome so far, without waiting for it.
    const outcomeOf = (promise) => {
      const outcome = { settled: false };
      promise.then(
        (value) => Object.assign(outcome, { settled: true, value }),
        (error) => Object.assign(outcome, { settled: true, error })
      );
      return outcome;
    };

    const UPLOAD_FAILED = new PhotoError('This photo could not be uploaded. Check your connection and try again.');

    test('gives up with an error for the owner as soon as the SDK retries, instead of sitting at 66%', async () => {
      const seen = refusedBehindCors(3);
      const progress = [];

      const upload = outcomeOf(uploadPhoto('b1', cameraFile(), { onProgress: (p) => progress.push(p) }));
      await vi.advanceTimersByTimeAsync(1000);

      expect(upload).toEqual({ settled: true, error: UPLOAD_FAILED });
      expect(seen.attempts).toBe(2);
      expect(progress).toEqual([0, 33, 67]);
      expect(seen.signal.aborted).toBe(true);
      expect(requests.map((r) => r.key)).toEqual(['POST /user/offered/b1/photos/upload-token']);
    });

    test('gives up on a photo too small to report progress once it has gone quiet', async () => {
      const seen = refusedBehindCors(1);

      const upload = outcomeOf(uploadPhoto('b1', cameraFile()));
      await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS - 1);
      expect(upload.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      expect(upload).toEqual({ settled: true, error: UPLOAD_FAILED });
      expect(seen.signal.aborted).toBe(true);
    });

    test('lets a slow upload finish while it keeps getting further', async () => {
      vi.spyOn(blobUpload, 'put').mockImplementation(async (pathname, blob, options) => {
        for (let percentage = 0; percentage < 100; percentage += 10) {
          options.onUploadProgress({ loaded: percentage, total: 100, percentage });
          await new Promise((resolve) => setTimeout(resolve, UPLOAD_STALL_MS - 1));
        }
        return { url: `https://blob.example/${pathname}` };
      });

      const upload = outcomeOf(uploadPhoto('b1', cameraFile()));
      await vi.advanceTimersByTimeAsync(10 * UPLOAD_STALL_MS);

      expect(upload).toEqual({ settled: true, value: [] });
    });
  });
});

test('uploadOutcome sums up several uploads for the feedback line', () => {
  expect(uploadOutcome(1, [], 0)).toEqual({ tone: 'done', message: 'Photo added' });
  expect(uploadOutcome(3, [], 0)).toEqual({ tone: 'done', message: '3 photos added' });
  expect(uploadOutcome(1, [new PhotoError('Photos must be JPEG, PNG or WebP.')], 0)).toEqual({
    tone: 'error',
    message: 'Photos must be JPEG, PNG or WebP.',
  });
  expect(uploadOutcome(2, [], 2).message).toBe('A book can have up to 4 photos, so 2 were left out.');
});

test('photoCountLabel', () => {
  expect(photoCountLabel(0)).toBe('');
  expect(photoCountLabel(undefined)).toBe('');
  expect(photoCountLabel(1)).toBe('1 photo');
  expect(photoCountLabel(4)).toBe('4 photos');
});
