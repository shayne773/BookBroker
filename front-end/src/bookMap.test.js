import { clusterAreas, clusterBox, covers, paddedBox } from './bookMap';

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

test('brings a view back within ±180 for clustering, across the antimeridian too', () => {
  expect(clusterBox([-74, 40, -73, 41])).toEqual([-74, 40, -73, 41]);
  expect(clusterBox([-434, 40, -433, 41])).toEqual([-74, 40, -73, 41]);
  expect(clusterBox([170, 50, 190, 55])).toEqual([170, 50, -170, 55]);
  expect(clusterBox([-400, -90, 400, 90])).toEqual([-180, -90, 180, 90]);
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
