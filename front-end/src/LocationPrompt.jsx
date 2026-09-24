import { Link } from 'react-router-dom';

// Where the lists on a page are drawn from. `area` is the reader's own
// `{ place, miles }`, null when they have not set a ZIP code (they then see
// every book, with no distances), or undefined while it loads.
const LocationPrompt = ({ area }) => {
  if (area === undefined) return null;

  if (!area) {
    return (
      <p className="notice mt-4" role="status">
        <span>
          Add your ZIP code to see the books near you, with how far away each one is.
          Until then you are seeing every book.
        </span>
        <Link to="/profile#location" className="textlink">Add ZIP code</Link>
      </p>
    );
  }

  return (
    <p className="hint mt-2">
      Books within {area.miles} mi of {area.place}.{' '}
      <Link to="/profile#location" className="textlink-quiet">Change</Link>
    </p>
  );
};

export default LocationPrompt;
