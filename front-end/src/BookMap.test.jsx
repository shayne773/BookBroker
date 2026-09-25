import { useEffect } from 'react';
import { vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import BookMap from './BookMap';
import Navbar from './Navbar';
import { boundsAround, searchBounds, US_BOUNDS } from './bookMap';

// A stand-in for MapLibre: no canvas or tiles, just the calls the page makes.
// A test moves the view by setting `view` and firing 'moveend'; markers are
// appended to the map's container, as MapLibre does.
const { maps } = vi.hoisted(() => ({ maps: [] }));

vi.mock('maplibre-gl', () => {
  class FakeMap {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.sources = {};
      this.view = { bounds: [-74.3, 40.5, -73.7, 40.95], zoom: 10 };
      this.easeTo = vi.fn();
      this.fitBounds = vi.fn();
      this.touchZoomRotate = { disableRotation: vi.fn() };
      this.keyboard = { disableRotation: vi.fn() };
      maps.push(this);
    }
    on(event, handler) {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }
    fire(event) {
      for (const handler of this.handlers[event] ?? []) handler();
    }
    addControl() {}
    addSource(id, source) {
      this.sources[id] = source;
    }
    addLayer() {}
    getBounds() {
      const [west, south, east, north] = this.view.bounds;
      return { getWest: () => west, getSouth: () => south, getEast: () => east, getNorth: () => north };
    }
    getZoom() {
      return this.view.zoom;
    }
    getCenter() {
      const [west, south, east, north] = this.view.bounds;
      return { lng: (west + east) / 2, lat: (south + north) / 2 };
    }
    remove() {}
  }

  class Marker {
    constructor({ element }) {
      this.element = element;
    }
    setLngLat(lngLat) {
      this.element.dataset.lngLat = lngLat.join(',');
      return this;
    }
    addTo(map) {
      map.options.container.appendChild(this.element);
      return this;
    }
    remove() {
      this.element.remove();
    }
  }

  return { default: { Map: FakeMap, Marker, NavigationControl: class {} } };
});

const BROOKLYN = { place: 'Brooklyn, NY', point: [-73.955, 40.652], count: 3 };
const NEW_YORK = { place: 'New York, NY', point: [-73.982, 40.759], count: 1 };
// The reader's own ZIP point, not Brooklyn's place point.
const HOME = { place: 'Brooklyn, NY', point: [-73.99, 40.694], miles: 25 };

const book = (id, title, distance) => ({ _id: id, title, author: 'An Author', cover: '', ...distance });

let routes;
let requests;

beforeEach(() => {
  maps.length = 0;
  localStorage.clear();
  localStorage.setItem('token', 'token');
  requests = [];
  routes = {
    '/map': () => ({ body: { home: HOME } }),
    '/map/areas': () => ({ body: { areas: [BROOKLYN, NEW_YORK] } }),
    '/map/genres': () => ({ body: { genres: ['Mystery', 'Poetry'] } }),
    '/map/nearest': () => ({ body: { places: [], placeCount: 0, bookCount: 0 } }),
    '/map/area': (params) => ({
      body:
        params.get('offset') === '20'
          ? { place: 'Brooklyn, NY', books: [book('b3', 'Earthsea', { distanceMiles: 1 })], nextOffset: null }
          : {
              place: 'Brooklyn, NY',
              books: [
                book('b1', 'Dune', { distanceMiles: 2 }),
                book('b2', 'Emma', { distanceLabel: 'More than 25 mi away' }),
              ],
              nextOffset: 20,
            },
    }),
  };
  global.fetch = vi.fn(async (url) => {
    // The API base is unset under test, so the URL is "undefined/<path>".
    const { pathname, searchParams } = new URL(String(url).replace(/^[^/]*/, ''), 'http://api.test');
    requests.push({ path: pathname, params: searchParams });
    const { status = 200, body } = routes[pathname](searchParams);
    return { ok: status < 400, status, json: async () => body };
  });
});

afterEach(() => {
  delete global.fetch;
});

// The page's own address, as the router has it.
const location = {};
const LocationProbe = () => {
  const current = useLocation();
  useEffect(() => {
    location.search = current.search;
  });
  return null;
};

// Renders the page at `path` and lets the map finish loading.
const openMap = async (path = '/map') => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <BookMap />
      <LocationProbe />
    </MemoryRouter>
  );
  await waitFor(() => expect(maps).toHaveLength(1));
  const map = maps[0];
  await act(async () => map.fire('load'));
  return map;
};

const moveTo = async (map, view) => {
  map.view = view;
  await act(async () => map.fire('moveend'));
};

test('opens on the reader’s own point with their distance drawn around it', async () => {
  const map = await openMap();

  expect(map.options.bounds).toEqual(boundsAround(HOME.point, 25));
  const circle = map.sources['home-distance'].data.geometry.coordinates[0];
  const [lng, lat] = circle[0];
  expect(lat).toBeCloseTo(HOME.point[1] + 25 / 69.055, 1);
  expect(lng).toBeCloseTo(HOME.point[0], 5);
  expect(
    screen.getByText('The circle is your 25 mi from your ZIP code in Brooklyn, NY. Choose a place to see its books.')
  ).toBeInTheDocument();
});

test('shows a marker for each place with books, with its count', async () => {
  await openMap();

  const brooklyn = await screen.findByRole('button', { name: 'Brooklyn, NY: 3 books' });
  expect(brooklyn).toHaveTextContent('3Brooklyn, NY');
  expect(brooklyn.parentElement.dataset.lngLat).toBe('-73.955,40.652');
  expect(screen.getByRole('button', { name: 'New York, NY: 1 book' })).toBeInTheDocument();

  const [areas] = requests.filter((r) => r.path === '/map/areas');
  expect(areas.params.get('bbox')).toBe('-74.6,40.275,-73.4,41.175');
});

test('merges nearby places at a wide zoom, and zooms into a cluster when it is chosen', async () => {
  const map = await openMap();
  await moveTo(map, { bounds: [-100, 30, -60, 50], zoom: 4 });

  const cluster = await screen.findByRole('button', { name: '4 books in 2 places. Zoom in' });
  expect(cluster).toHaveTextContent('4');
  expect(screen.queryByRole('button', { name: /Brooklyn, NY:/ })).not.toBeInTheDocument();

  await userEvent.click(cluster);
  expect(map.easeTo).toHaveBeenCalledTimes(1);
  const [{ zoom }] = map.easeTo.mock.calls[0];
  expect(zoom).toBeGreaterThan(4);
});

test('lists the places of a cluster the deepest zoom cannot split, to choose from', async () => {
  const DARTMOUTH = { place: 'Dartmouth, MA', point: [-71.02, 41.61], count: 2 };
  const RAYNHAM = { place: 'Raynham Center, MA', point: [-71.02, 41.61], count: 1 };
  routes['/map/areas'] = () => ({ body: { areas: [BROOKLYN, DARTMOUTH, RAYNHAM] } });
  const map = await openMap();
  await moveTo(map, { bounds: [-71.03, 41.6, -71.01, 41.62], zoom: 16 });

  const cluster = await screen.findByRole('button', { name: '3 books in 2 places. Choose a place' });
  expect(cluster).toHaveAttribute('aria-expanded', 'false');
  await userEvent.click(cluster);
  expect(map.easeTo).not.toHaveBeenCalled();
  expect(cluster).toHaveAttribute('aria-expanded', 'true');

  await userEvent.click(screen.getByRole('button', { name: 'Dartmouth, MA: 2 books' }));
  const panel = screen.getByRole('complementary', { name: 'Dartmouth, MA' });
  expect(await within(panel).findByRole('list', { name: 'Books in Dartmouth, MA' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Dartmouth, MA: 2 books' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Raynham Center, MA: 1 book' })).toHaveAttribute('aria-pressed', 'false');

  await userEvent.click(cluster);
  expect(screen.queryByRole('button', { name: /Raynham Center, MA:/ })).not.toBeInTheDocument();
});

test('asks for places again only when the view leaves the part already fetched', async () => {
  const map = await openMap();
  await screen.findByRole('button', { name: 'Brooklyn, NY: 3 books' });

  await moveTo(map, { bounds: [-74.2, 40.6, -73.8, 40.9], zoom: 11 });
  expect(requests.filter((r) => r.path === '/map/areas')).toHaveLength(1);

  await moveTo(map, { bounds: [-88, 41.6, -87.4, 42.1], zoom: 10 });
  await waitFor(() => expect(requests.filter((r) => r.path === '/map/areas')).toHaveLength(2));
});

test('lists a place’s books in the side panel, with their distances, a page at a time', async () => {
  await openMap();
  await userEvent.click(await screen.findByRole('button', { name: 'Brooklyn, NY: 3 books' }));

  const panel = screen.getByRole('complementary', { name: 'Brooklyn, NY' });
  expect(within(panel).getByText('3 books')).toBeInTheDocument();
  const list = await within(panel).findByRole('list', { name: 'Books in Brooklyn, NY' });
  expect(within(list).getByRole('link', { name: 'Dune' })).toHaveAttribute('href', '/books/b1');
  expect(within(list).getByText('2 mi away')).toHaveClass('distance');
  expect(within(list).getByText('More than 25 mi away')).toHaveClass('distance');
  expect(screen.getByRole('button', { name: 'Brooklyn, NY: 3 books' })).toHaveAttribute('aria-pressed', 'true');

  await userEvent.click(within(panel).getByRole('button', { name: 'Show more' }));
  expect(await within(list).findByRole('link', { name: 'Earthsea' })).toBeInTheDocument();
  expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  expect(within(panel).queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();

  await userEvent.click(within(panel).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
});

test('opens on the whole country, asking for a ZIP, for a reader without one', async () => {
  routes['/map'] = () => ({ body: { home: null } });
  const map = await openMap();

  expect(map.options.bounds).toEqual(US_BOUNDS);
  expect(map.sources).not.toHaveProperty('home-distance');
  expect(screen.getByRole('link', { name: 'Add ZIP code' })).toHaveAttribute('href', '/profile#location');
  expect(await screen.findByRole('button', { name: 'Brooklyn, NY: 3 books' })).toBeInTheDocument();
});

test('says so when the places cannot be loaded', async () => {
  routes['/map/areas'] = () => ({ status: 500, body: {} });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await openMap();

  expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t load the books on the map.');
});

// A search's nearest matching places, as GET /map/nearest lists them.
const NEAREST = {
  places: [
    { place: 'Brooklyn, NY', point: [-73.955, 40.652], count: 2, distanceMiles: 0 },
    { place: 'New York, NY', point: [-73.982, 40.759], count: 1, distanceMiles: 4 },
    { place: 'Chicago, IL', point: [-87.68, 41.84], count: 5, distanceLabel: 'More than 25 mi away' },
  ],
  placeCount: 3,
  bookCount: 8,
};

// Answers the map's endpoints as a server that has only mysteries would: the
// markers and a place's books narrow to the search.
const searchingServer = () => {
  routes['/map/areas'] = (params) => ({
    body: { areas: params.get('genre') === 'Mystery' ? [{ ...BROOKLYN, count: 2 }] : [BROOKLYN, NEW_YORK] },
  });
  routes['/map/nearest'] = () => ({ body: NEAREST });
};

const lastRequest = (path) => requests.filter((r) => r.path === path).at(-1);

test('searches by keyword: the markers, the view and the results all follow the search', async () => {
  searchingServer();
  const map = await openMap();
  await screen.findByRole('button', { name: 'New York, NY: 1 book' });

  const bar = screen.getByRole('search', { name: 'Search the map' });
  await userEvent.type(within(bar).getByRole('searchbox', { name: 'Keyword' }), 'C++ & sons');
  await userEvent.click(within(bar).getByRole('button', { name: 'Search' }));

  // The search is kept in the page's address, as the API reads it.
  expect(location.search).toBe('?q=C%2B%2B+%26+sons');
  await waitFor(() => expect(lastRequest('/map/areas').params.get('q')).toBe('C++ & sons'));
  const nearest = lastRequest('/map/nearest');
  expect(nearest.params.get('q')).toBe('C++ & sons');
  // The API measures from the reader's own point, which it knows.
  expect(nearest.params.has('near')).toBe(false);

  // The map moves to the reader and the nearest matches.
  await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
  const [bounds, options] = map.fitBounds.mock.calls[0];
  expect(bounds).toEqual(searchBounds(HOME.point, NEAREST.places));
  expect(options).toMatchObject({ padding: 48 });

  const panel = screen.getByRole('complementary', { name: '8 books in 3 places' });
  const results = within(panel).getByRole('list', { name: 'Places with matching books, nearest first' });
  const rows = within(results).getAllByRole('button');
  expect(rows.map((row) => row.textContent)).toEqual([
    'Brooklyn, NY2 booksless than 1 mi away',
    'New York, NY1 book4 mi away',
    'Chicago, IL5 booksMore than 25 mi away',
  ]);

  // Choosing a place brings it into view and lists its matching books.
  await userEvent.click(rows[1]);
  expect(map.easeTo).toHaveBeenCalledWith({ center: [-73.982, 40.759], zoom: 10 });
  const placePanel = screen.getByRole('complementary', { name: 'New York, NY' });
  expect(within(placePanel).getByText('Matching books in')).toBeInTheDocument();
  expect(within(placePanel).getByText('1 book')).toBeInTheDocument();
  await within(placePanel).findByRole('list', { name: 'Books in New York, NY' });
  const area = lastRequest('/map/area');
  expect(area.params.get('place')).toBe('New York, NY');
  expect(area.params.get('q')).toBe('C++ & sons');

  // And back to the results.
  await userEvent.click(within(placePanel).getByRole('button', { name: 'All results' }));
  expect(screen.getByRole('complementary', { name: '8 books in 3 places' })).toBeInTheDocument();
});

test('applies a chosen filter at once, showing only the matching places', async () => {
  searchingServer();
  await openMap();
  await screen.findByRole('button', { name: 'New York, NY: 1 book' });

  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Genre' }), 'Mystery');

  expect(location.search).toBe('?genre=Mystery');
  expect(await screen.findByRole('button', { name: 'Brooklyn, NY: 2 books' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /New York, NY:/ })).not.toBeInTheDocument();
});

test('combines the filters in the address', async () => {
  searchingServer();
  await openMap();

  await userEvent.type(screen.getByRole('textbox', { name: 'Author' }), 'Christie');
  await userEvent.type(screen.getByRole('textbox', { name: 'Published from' }), '1990');
  await userEvent.type(screen.getByRole('textbox', { name: 'Published to' }), '1920');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Listed' }), 'Past week');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Only my wishlist matches' }));

  expect(location.search).toBe('?author=Christie&from=1920&to=1990&listed=week&wishlist=1');
  await waitFor(() => expect(lastRequest('/map/nearest').params.toString()).toBe(location.search.slice(1)));
});

test('opens on a search from its address, which survives a reload', async () => {
  searchingServer();
  const map = await openMap('/map?genre=Mystery&from=1930');

  expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveValue('Mystery');
  expect(screen.getByRole('textbox', { name: 'Published from' })).toHaveValue('1930');
  expect(await screen.findByRole('button', { name: 'Brooklyn, NY: 2 books' })).toBeInTheDocument();
  expect(requests.filter((r) => r.path === '/map/areas').every((r) => r.params.get('genre') === 'Mystery')).toBe(
    true
  );
  await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('complementary', { name: '8 books in 3 places' })).toBeInTheDocument();
});

test('keeps the view and says so plainly when nothing matches anywhere', async () => {
  const map = await openMap('/map?q=zzzz');

  const panel = await screen.findByRole('complementary', { name: 'No matches' });
  expect(within(panel).getByText(/No books on the market match this search anywhere/)).toBeInTheDocument();
  expect(map.fitBounds).not.toHaveBeenCalled();
});

test('clearing the search restores the normal map', async () => {
  searchingServer();
  const map = await openMap('/map?genre=Mystery');
  await screen.findByRole('button', { name: 'Brooklyn, NY: 2 books' });

  await userEvent.click(within(screen.getByRole('search')).getByRole('button', { name: 'Clear' }));

  expect(location.search).toBe('');
  expect(screen.getByRole('combobox', { name: 'Genre' })).toHaveValue('');
  expect(await screen.findByRole('button', { name: 'New York, NY: 1 book' })).toBeInTheDocument();
  expect(lastRequest('/map/areas').params.has('genre')).toBe(false);
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(map.fitBounds).toHaveBeenLastCalledWith(boundsAround(HOME.point, 25), { padding: 48 });
});

test('searches from where the map is looking for a reader without a ZIP', async () => {
  routes['/map'] = () => ({ body: { home: null } });
  searchingServer();
  const map = await openMap('/map?q=dune');

  await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
  const centre = map.getCenter();
  expect(lastRequest('/map/nearest').params.get('near')).toBe(`${centre.lng},${centre.lat}`);
  expect(map.fitBounds.mock.calls[0][0]).toEqual(searchBounds([centre.lng, centre.lat], NEAREST.places));
});

test('offers the genres on the market', async () => {
  await openMap();
  const genre = screen.getByRole('combobox', { name: 'Genre' });
  await waitFor(() =>
    expect(within(genre).getAllByRole('option').map((o) => o.textContent)).toEqual(['Any genre', 'Mystery', 'Poetry'])
  );
});

test('the top bar links to the map', () => {
  render(<Navbar />, { wrapper: MemoryRouter });
  expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/map');
});
