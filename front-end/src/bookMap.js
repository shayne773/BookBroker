import Supercluster from 'supercluster';

// The map page's geometry, kept apart from the page so it can be tested
// without a map. Points are [longitude, latitude], as the API sends them.

// OpenFreeMap's light grey basemap: free, no key or account, attribution
// required (the style's sources carry it, and the map shows it). See README.
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

// The contiguous United States, where the map opens for a reader without a ZIP.
export const US_BOUNDS = [
  [-125, 24.5],
  [-66.9, 49.5],
];

// How far past each edge of the view the map asks for places, as a share of
// the view, so a short pan finds its markers already there.
const VIEW_MARGIN = 0.5;

const MILES_PER_DEGREE_LATITUDE = 69.055;
const EARTH_RADIUS_MILES = 3958.8;

const round = (degrees) => Math.round(degrees * 1000) / 1000;

/**
 * The part of the map to ask the API about for a view with `bounds` (a
 * MapLibre LngLatBounds): the view widened on every side, as [west, south,
 * east, north]. `bbox.join(',')` is the API's `bbox`.
 */
export const paddedBox = (bounds) => {
  const west = bounds.getWest();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const north = bounds.getNorth();
  const dx = (east - west) * VIEW_MARGIN;
  const dy = (north - south) * VIEW_MARGIN;
  return [west - dx, Math.max(south - dy, -90), east + dx, Math.min(north + dy, 90)].map(round);
};

/** Whether box `outer` covers box `inner`, both [west, south, east, north]. */
export const covers = (outer, inner) =>
  Boolean(outer) &&
  outer[0] <= inner[0] &&
  outer[1] <= inner[1] &&
  outer[2] >= inner[2] &&
  outer[3] >= inner[3];

/**
 * `box` as Supercluster reads one: longitudes within ±180, west past east when
 * it crosses the antimeridian.
 */
export const clusterBox = ([west, south, east, north]) => {
  if (east - west >= 360) return [-180, south, 180, north];
  const shift = Math.floor((west + 180) / 360) * 360;
  const from = west - shift;
  const to = east - shift;
  return [from, south, to > 180 ? to - 360 : to, north];
};

/** The box, [[west, south], [east, north]], around a circle of `miles` at `point`. */
export const boundsAround = ([longitude, latitude], miles) => {
  const dLat = miles / MILES_PER_DEGREE_LATITUDE;
  const dLng = dLat / Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
  return [
    [longitude - dLng, latitude - dLat],
    [longitude + dLng, latitude + dLat],
  ];
};

/** A GeoJSON polygon approximating the circle of `miles` around `point`. */
export const distanceCircle = ([longitude, latitude], miles, steps = 96) => {
  const lat1 = (latitude * Math.PI) / 180;
  const lng1 = (longitude * Math.PI) / 180;
  const angular = miles / EARTH_RADIUS_MILES;
  const ring = [];
  for (let i = 0; i <= steps; i += 1) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
    );
    const lng2 =
      lng1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
      );
    ring.push([(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
};

/**
 * The areas (`{ place, point, count }`) grouped for display: at a given zoom,
 * places closer than a marker's width merge into one cluster whose count is
 * the sum of theirs. `getClusters(bbox, zoom)` returns GeoJSON points; a
 * cluster's properties carry `cluster_id` and `count`, a place's `place`,
 * `point` (exactly as the API sent it) and `count`.
 */
export const clusterAreas = (areas) => {
  const index = new Supercluster({
    radius: 64,
    maxZoom: 16,
    map: ({ count }) => ({ count }),
    reduce: (total, { count }) => {
      total.count += count;
    },
  });
  index.load(
    areas.map(({ place, point, count }) => ({
      type: 'Feature',
      properties: { place, point, count },
      geometry: { type: 'Point', coordinates: point },
    }))
  );
  return index;
};

// "1 book", "12 books".
export const booksCount = (n) => `${n} ${n === 1 ? 'book' : 'books'}`;
