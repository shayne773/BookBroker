import { clusterAreas, covers, fitPlaces, paddedBox, searchBounds } from './bookMap';

const bounds = ([west, south, east, north]) => ({
  getWest: () => west,
  getSouth: () => south,
  getEast: () => east,
  getNorth: () => north,
});

test('asks for the view widened by half on every side', () => {
  expect(paddedBox(bounds([-74, 40, -73, 41]))).toEqual([-74.5, 39.5, -72.5, 41.5]);
  expect(paddedBox(bounds([-180, -80, 180, 80]))).toEqual([-360, -90, 360, 90]);
});

test('knows when a view is already covered', () => {
  expect(covers([-75, 39, -72, 42], [-74, 40, -73, 41])).toBe(true);
  expect(covers([-75, 39, -72, 42], [-76, 40, -73, 41])).toBe(false);
  expect(covers(null, [-74, 40, -73, 41])).toBe(false);
});

test('clusters sum their places’ books', () => {
  const index = clusterAreas([
    { place: 'Brooklyn, NY', point: [-73.955, 40.652], count: 3 },
    { place: 'New York, NY', point: [-73.982, 40.759], count: 1 },
    { place: 'Chicago, IL', point: [-87.68, 41.84], count: 5 },
  ]);

  const wide = index.getClusters([-180, -85, 180, 85], 3);
  expect(wide.map((f) => f.properties.count).sort()).toEqual([4, 5]);

  const close = index.getClusters([-180, -85, 180, 85], 12);
  expect(close.map((f) => f.properties.place).sort()).toEqual(['Brooklyn, NY', 'Chicago, IL', 'New York, NY']);
});

const near = (place, point, distanceMiles) => ({ place, point, count: 1, distanceMiles });
const far = (place, point) => ({ place, point, count: 1, distanceLabel: 'More than 25 mi away' });

test('fits a search to the reader and the nearest five places, however far', () => {
  const places = [
    near('A', [-73.9, 40.7], 0),
    near('B', [-74, 40.8], 3),
    far('C', [-87.6, 41.9]),
    far('D', [-71, 42.4]),
    far('E', [-77, 38.9]),
    far('F', [-118.2, 34]),
  ];
  expect(fitPlaces(places).map((p) => p.place)).toEqual(['A', 'B', 'C', 'D', 'E']);
  // The reader's own point is inside the view, even when no place is near it.
  expect(searchBounds([-73.99, 40.69], places)).toEqual([
    [-87.6, 38.9],
    [-71, 42.4],
  ]);
  expect(searchBounds([-100, 45], [far('C', [-87.6, 41.9])])).toEqual([
    [-100, 41.9],
    [-87.6, 45],
  ]);
});

test('fits a search to every place within the reader’s distance when there are more than five', () => {
  const within = Array.from({ length: 7 }, (_, i) => near(`N${i}`, [-74 + i * 0.01, 40.7], i));
  const places = [...within, far('Chicago', [-87.6, 41.9])];
  expect(fitPlaces(places)).toEqual(within);
  expect(searchBounds([-73.99, 40.69], places)).toEqual([
    [-74, 40.69],
    [-73.94, 40.7],
  ]);
});

test('keeps the view when nothing matches', () => {
  expect(searchBounds([-73.99, 40.69], [])).toBe(null);
});
