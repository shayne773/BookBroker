// How far away a book is, wherever the app says so. The API sends a distance
// only as whole miles (`distanceMiles`, 0 meaning under a mile), and only to a
// reader who has set a ZIP code; for a book beyond the reader's distance it
// sends only a `distanceLabel` ("More than 25 mi away"). It never sends where
// anyone is.

// The distances a reader can choose to trade within (User.maxDistanceMiles).
export const DISTANCE_CHOICES = [5, 10, 25, 50, 100];
export const DEFAULT_DISTANCE = 25;

// "3 mi away", "less than 1 mi away", the API's `label` when it sent one
// instead, or '' when there is no distance.
export const formatDistance = (miles, label) => {
  if (label) return label;
  if (miles === null || miles === undefined || miles === '') return '';
  const n = Number(miles);
  if (!Number.isFinite(n)) return '';
  return n < 1 ? 'less than 1 mi away' : `${n} mi away`;
};

// The five digits of a US ZIP code ("12345" or ZIP+4), or null.
export const normalizeZip = (value) => {
  const match = /^(\d{5})(?:-\d{4})?$/.exec(String(value ?? '').trim());
  return match ? match[1] : null;
};

export const ZIP_FORMAT_MESSAGE = 'Enter a 5-digit US ZIP code.';
