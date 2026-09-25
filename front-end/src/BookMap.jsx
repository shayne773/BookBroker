import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { authFetch, isSessionExpiredError } from './auth';
import LocationPrompt from './LocationPrompt';
import AreaPanel from './BookMap/AreaPanel';
import MapMarker from './BookMap/MapMarker';
import ResultsPanel from './BookMap/ResultsPanel';
import SearchBar from './BookMap/SearchBar';
import {
  booksCount,
  boundsAround,
  clusterAreas,
  covers,
  distanceCircle,
  MAP_STYLE_URL,
  paddedBox,
  searchBounds,
  US_BOUNDS,
} from './bookMap';
import { readSearch, searchParams, searchQuery } from './mapSearch';

const API = import.meta.env.VITE_SERVER_ADDRESS;

// The deepest the map zooms to. A cluster still merged there is split by
// choosing one of its places from a list instead.
const MAX_ZOOM = 16;

// A search's view is fitted around the reader and the nearest matches no
// closer than this, so a single match nearby still shows its surroundings.
const SEARCH_MAX_ZOOM = 12;
// How close choosing a place in the results brings the map, at least.
const PLACE_ZOOM = 10;

// Where the map opens, and where clearing a search takes it back to.
const homeBounds = (home) => (home ? boundsAround(home.point, home.miles) : US_BOUNDS);
const MAP_PADDING = 48;

const getJson = async (url, options) => {
  const res = await authFetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// A token's value, for the map's own drawing (the distance circle), which is
// painted on the canvas rather than styled by CSS.
const token = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// The reader's distance, drawn faintly around their own point, from which the
// distances beside their books are measured.
const drawDistance = (map, home) => {
  const ink = token('--color-ink');
  map.addSource('home-distance', { type: 'geojson', data: distanceCircle(home.point, home.miles) });
  map.addLayer({
    id: 'home-distance-fill',
    type: 'fill',
    source: 'home-distance',
    paint: { 'fill-color': ink, 'fill-opacity': 0.04 },
  });
  map.addLayer({
    id: 'home-distance-line',
    type: 'line',
    source: 'home-distance',
    paint: { 'line-color': ink, 'line-opacity': 0.45, 'line-width': 1.5, 'line-dasharray': [3, 2] },
  });
};

const NO_AREAS = [];

// The size step of a cluster marker, by how many books it holds.
const clusterSize = (count) => (count >= 100 ? 'large' : count >= 10 ? 'medium' : 'small');

// The map itself: the basemap, the reader's distance, and a marker for every
// place with books (only those matching the search, `searchKey`, when one is
// on), merged into clusters where they would crowd each other. Places are
// fetched for the view (widened) as it moves, and only when the view leaves
// the part already fetched or the search changes. `onReady` is given the map
// once it has loaded, for the page to move it.
const BooksMap = ({ home, searchKey, selectedPlace, onSelect, onError, onReady }) => {
  const container = useRef(null);
  const [map, setMap] = useState(null);
  const [view, setView] = useState(null);
  const [fetched, setFetched] = useState({ box: null, key: '', areas: [] });
  const [picking, setPicking] = useState(null);

  useEffect(() => {
    const instance = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE_URL,
      bounds: homeBounds(home),
      fitBoundsOptions: { padding: MAP_PADDING },
      maxZoom: MAX_ZOOM,
      // A flat map: no rotation or tilt to get lost in.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    instance.touchZoomRotate.disableRotation();
    instance.keyboard.disableRotation();
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    const track = () => {
      const bounds = instance.getBounds();
      setView({
        visible: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
        padded: paddedBox(bounds),
        zoom: instance.getZoom(),
      });
    };
    instance.on('load', () => {
      if (home) drawDistance(instance, home);
      track();
      setMap(instance);
      onReady(instance);
    });
    instance.on('moveend', track);

    return () => {
      onReady(null);
      instance.remove();
    };
  }, [home, onReady]);

  const visible = view?.visible;
  const padded = view?.padded;
  const current = fetched.key === searchKey;
  const needsAreas = visible && !(current && covers(fetched.box, visible));

  useEffect(() => {
    if (!needsAreas) return undefined;
    const controller = new AbortController();
    const search = searchKey ? `&${searchKey}` : '';
    getJson(`${API}/map/areas?bbox=${padded.join(',')}${search}`, { signal: controller.signal })
      .then(({ areas }) => {
        onError(false);
        setFetched({ box: padded, key: searchKey, areas });
      })
      .catch((err) => {
        if (controller.signal.aborted || isSessionExpiredError(err)) return;
        console.error('Failed to fetch the places on the map:', err);
        onError(true);
      });
    return () => controller.abort();
  }, [needsAreas, padded, searchKey, onError]);

  // Markers for another search are not shown while this one's are fetched.
  const areas = current ? fetched.areas : NO_AREAS;
  const index = useMemo(() => clusterAreas(areas), [areas]);
  const markers = view ? index.getClusters(view.padded, Math.floor(view.zoom)) : [];

  const splitZoom = (clusterId) => {
    const zoom = index.getClusterExpansionZoom(clusterId);
    return view.zoom < MAX_ZOOM && zoom <= MAX_ZOOM ? zoom : null;
  };

  return (
    <div ref={container} className="map-page__canvas">
      {map &&
        markers.map(({ geometry, properties }) => {
          const [lng, lat] = geometry.coordinates;

          if (properties.cluster) {
            const { cluster_id: id, count, point_count: places } = properties;
            const zoom = splitZoom(id);
            const open = zoom === null && picking?.index === index && picking.id === id;
            return (
              <MapMarker key={`cluster-${id}`} map={map} lng={lng} lat={lat}>
                <button
                  type="button"
                  className={`map-cluster map-cluster--${clusterSize(count)}`}
                  onClick={() =>
                    zoom === null
                      ? setPicking(open ? null : { index, id })
                      : map.easeTo({ center: [lng, lat], zoom })
                  }
                  aria-label={`${booksCount(count)} in ${places} places. ${zoom === null ? 'Choose a place' : 'Zoom in'}`}
                  aria-expanded={zoom === null ? open : undefined}
                >
                  {count}
                </button>
                {open && (
                  <ul className="map-cluster__places">
                    {index.getLeaves(id, Infinity).map(({ properties: leaf }) => (
                      <li key={leaf.place}>
                        <button
                          type="button"
                          className={`map-place${leaf.place === selectedPlace ? ' is-selected' : ''}`}
                          aria-pressed={leaf.place === selectedPlace}
                          aria-label={`${leaf.place}: ${booksCount(leaf.count)}`}
                          onClick={() => onSelect({ place: leaf.place, count: leaf.count })}
                        >
                          <span className="map-place__count" aria-hidden="true">{leaf.count}</span>
                          <span className="map-place__name" aria-hidden="true">{leaf.place}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </MapMarker>
            );
          }

          const { place, point, count } = properties;
          const selected = place === selectedPlace;
          return (
            <MapMarker key={`place-${place}`} map={map} lng={point[0]} lat={point[1]}>
              <button
                type="button"
                className={`map-place${selected ? ' is-selected' : ''}`}
                aria-pressed={selected}
                aria-label={`${place}: ${booksCount(count)}`}
                onClick={() => onSelect({ place, count })}
              >
                <span className="map-place__count" aria-hidden="true">{count}</span>
                <span className="map-place__name" aria-hidden="true">{place}</span>
              </button>
            </MapMarker>
          );
        })}
    </div>
  );
};

// The map page: books by place, anywhere, under the top bar and the search,
// with a panel on the right for the chosen place's books or, while a search is
// on, its results. It opens on the reader's own point, with their distance
// around it, or on the whole country for a reader without a ZIP. The search
// lives in the page's query string; each new one moves the map to the reader
// and the nearest matching places.
const BookMap = () => {
  // undefined while loading; null for a reader without a ZIP.
  const [home, setHome] = useState(undefined);
  const [homeFailed, setHomeFailed] = useState(false);
  const [areasFailed, setAreasFailed] = useState(false);
  // The place chosen under the search `key`.
  const [selection, setSelection] = useState(null);
  const [map, setMap] = useState(null);
  const [genres, setGenres] = useState([]);
  // The nearest matches for the search `key`: { key, places, placeCount,
  // bookCount }, or { key, failed: true }.
  const [results, setResults] = useState(null);

  const [params, setParams] = useSearchParams();
  const search = useMemo(() => readSearch(params), [params]);
  const searchKey = searchQuery(search);
  const selected = selection?.key === searchKey ? selection : null;
  const select = (choice) => setSelection({ ...choice, key: searchKey });

  useEffect(() => {
    let live = true;
    getJson(`${API}/map`)
      .then((data) => live && setHome(data.home ?? null))
      .catch((err) => {
        if (!live || isSessionExpiredError(err)) return;
        console.error('Failed to fetch your area:', err);
        setHomeFailed(true);
        setHome(null);
      });
    getJson(`${API}/map/genres`)
      .then((data) => live && setGenres(data.genres))
      .catch((err) => {
        // The search still works without the list, by any genre.
        if (live && !isSessionExpiredError(err)) console.error('Failed to fetch the genres:', err);
      });
    return () => {
      live = false;
    };
  }, []);

  // A new search finds the nearest matching places, from the reader's own
  // point (the API knows it) or, without a ZIP, from where the map is looking,
  // and fits the map around them. With no match anywhere, the view stays.
  useEffect(() => {
    if (!searchKey || !map) return undefined;
    const controller = new AbortController();
    const centre = map.getCenter();
    const origin = home ? home.point : [centre.lng, centre.lat];
    const near = home ? '' : `&near=${origin.join(',')}`;
    getJson(`${API}/map/nearest?${searchKey}${near}`, { signal: controller.signal })
      .then((found) => {
        setResults({ key: searchKey, ...found });
        const bounds = searchBounds(origin, found.places);
        if (bounds) map.fitBounds(bounds, { padding: MAP_PADDING, maxZoom: SEARCH_MAX_ZOOM });
      })
      .catch((err) => {
        if (controller.signal.aborted || isSessionExpiredError(err)) return;
        console.error('Failed to search the map:', err);
        setResults({ key: searchKey, failed: true });
      });
    return () => controller.abort();
  }, [searchKey, map, home]);

  const onAreasError = useCallback((failed) => setAreasFailed(failed), []);

  const applySearch = (next) => {
    setSelection(null);
    setParams(searchParams(next));
  };

  const clearSearch = () => {
    applySearch({});
    map?.fitBounds(homeBounds(home), { padding: MAP_PADDING });
  };

  // A place chosen from the results is brought into view and its matching
  // books listed.
  const chooseResult = ({ place, point, count }) => {
    select({ place, count });
    map?.easeTo({ center: point, zoom: Math.max(map.getZoom(), PLACE_ZOOM) });
  };

  return (
    <main className="map-page">
      <h1 className="visually-hidden">Map</h1>

      <div className="map-page__map">
        <SearchBar
          key={searchKey}
          search={search}
          active={Boolean(searchKey)}
          genres={genres}
          onSearch={applySearch}
          onClear={clearSearch}
        />

        <div className="map-page__view">
          {home !== undefined && (
            <BooksMap
              home={home}
              searchKey={searchKey}
              selectedPlace={selected?.place}
              onSelect={select}
              onError={onAreasError}
              onReady={setMap}
            />
          )}

          <div className="map-page__notes">
            {home && (
              <p className="map-page__note">
                The circle is your {home.miles} mi from your ZIP code in {home.place}. Choose a place to see its books.
              </p>
            )}
            {home === null && !homeFailed && <LocationPrompt area={null} />}
            {(homeFailed || areasFailed) && (
              <p className="notice notice--error" role="alert">
                We couldn&rsquo;t load the books on the map. Try again in a moment.
              </p>
            )}
          </div>
        </div>
      </div>

      {selected ? (
        <AreaPanel
          key={`${selected.place}?${searchKey}`}
          place={selected.place}
          count={selected.count}
          searchKey={searchKey}
          onClose={() => setSelection(null)}
        />
      ) : (
        searchKey && (
          <ResultsPanel
            results={results?.key === searchKey ? results : null}
            onChoose={chooseResult}
            onClear={clearSearch}
          />
        )
      )}
    </main>
  );
};

export default BookMap;
