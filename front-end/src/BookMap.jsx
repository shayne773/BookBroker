import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { authFetch, isSessionExpiredError } from './auth';
import LocationPrompt from './LocationPrompt';
import AreaPanel from './BookMap/AreaPanel';
import MapMarker from './BookMap/MapMarker';
import {
  booksCount,
  boundsAround,
  clusterAreas,
  covers,
  distanceCircle,
  MAP_STYLE_URL,
  paddedBox,
  US_BOUNDS,
} from './bookMap';

const API = import.meta.env.VITE_SERVER_ADDRESS;

// The deepest the map zooms to. A cluster still merged there is split by
// choosing one of its places from a list instead.
const MAX_ZOOM = 16;

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

// The size step of a cluster marker, by how many books it holds.
const clusterSize = (count) => (count >= 100 ? 'large' : count >= 10 ? 'medium' : 'small');

// The map itself: the basemap, the reader's distance, and a marker for every
// place with books, merged into clusters where they would crowd each other.
// Places are fetched for the view (widened) as it moves, and only when the
// view leaves the part already fetched.
const BooksMap = ({ home, selectedPlace, onSelect, onError }) => {
  const container = useRef(null);
  const [map, setMap] = useState(null);
  const [view, setView] = useState(null);
  const [fetched, setFetched] = useState({ box: null, areas: [] });
  const [picking, setPicking] = useState(null);

  useEffect(() => {
    const instance = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE_URL,
      bounds: home ? boundsAround(home.point, home.miles) : US_BOUNDS,
      fitBoundsOptions: { padding: 48 },
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
    });
    instance.on('moveend', track);

    return () => instance.remove();
  }, [home]);

  const visible = view?.visible;
  const padded = view?.padded;
  const needsAreas = visible && !covers(fetched.box, visible);

  useEffect(() => {
    if (!needsAreas) return undefined;
    const controller = new AbortController();
    authFetch(`${API}/map/areas?bbox=${padded.join(',')}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(({ areas }) => {
        onError(false);
        setFetched({ box: padded, areas });
      })
      .catch((err) => {
        if (controller.signal.aborted || isSessionExpiredError(err)) return;
        console.error('Failed to fetch the places on the map:', err);
        onError(true);
      });
    return () => controller.abort();
  }, [needsAreas, padded, onError]);

  const index = useMemo(() => clusterAreas(fetched.areas), [fetched.areas]);
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

// The map page: books by place, anywhere, under the top bar, with the chosen
// place's books in a panel on the right. It opens on the reader's own point,
// with their distance around it, or on the whole country for a reader without a ZIP.
const BookMap = () => {
  // undefined while loading; null for a reader without a ZIP.
  const [home, setHome] = useState(undefined);
  const [homeFailed, setHomeFailed] = useState(false);
  const [areasFailed, setAreasFailed] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let live = true;
    authFetch(`${API}/map`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => live && setHome(data.home ?? null))
      .catch((err) => {
        if (!live || isSessionExpiredError(err)) return;
        console.error('Failed to fetch your area:', err);
        setHomeFailed(true);
        setHome(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const onAreasError = useCallback((failed) => setAreasFailed(failed), []);

  return (
    <main className="map-page">
      <h1 className="visually-hidden">Map</h1>

      <div className="map-page__map">
        {home !== undefined && (
          <BooksMap
            home={home}
            selectedPlace={selected?.place}
            onSelect={setSelected}
            onError={onAreasError}
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

      {selected && (
        <AreaPanel
          key={selected.place}
          place={selected.place}
          count={selected.count}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
};

export default BookMap;
