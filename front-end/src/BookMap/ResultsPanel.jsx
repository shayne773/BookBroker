import DistanceLabel from '../DistanceLabel';
import { booksCount } from '../bookMap';

// "1 place", "4 places".
const placesCount = (n) => `${n} ${n === 1 ? 'place' : 'places'}`;

// The side panel while a search is on: the places with matching books, nearest
// the reader first (GET /map/nearest), each with its matching count and how far
// it is. Choosing one shows its matching books.
const ResultsPanel = ({ results, onChoose, onClear }) => {
  const { places = [], placeCount = 0, bookCount = 0 } = results ?? {};
  const loading = results === null;

  return (
    <aside className="map-panel" aria-labelledby="map-panel-title">
      <div className="map-panel__head">
        <div>
          <p className="kicker">Search results</p>
          <h2 id="map-panel-title" className="map-panel__title">
            {loading || results.failed
              ? 'Nearest matches'
              : placeCount
                ? `${booksCount(bookCount)} in ${placesCount(placeCount)}`
                : 'No matches'}
          </h2>
          {!loading && placeCount > places.length && (
            <p className="map-panel__count">The nearest {places.length} places</p>
          )}
        </div>
        <button type="button" className="button button--quiet button--small" onClick={onClear}>
          Clear
        </button>
      </div>

      {loading && <p className="hint mt-4" role="status">Finding the nearest matches&hellip;</p>}

      {results?.failed && (
        <p className="notice notice--error mt-4" role="alert">
          We couldn&rsquo;t search the map. Try again in a moment.
        </p>
      )}

      {!loading && !results.failed && places.length === 0 && (
        <p className="empty" role="status">
          No books on the market match this search anywhere. Try fewer filters.
        </p>
      )}

      {places.length > 0 && (
        <ol className="map-results" aria-label="Places with matching books, nearest first">
          {places.map((found) => (
            <li key={found.place}>
              <button type="button" className="map-result" onClick={() => onChoose(found)}>
                <span className="map-result__place">{found.place}</span>
                <span className="map-result__meta">
                  {booksCount(found.count)}
                  <DistanceLabel miles={found.distanceMiles} label={found.distanceLabel} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
};

export default ResultsPanel;
