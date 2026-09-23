import { formatRating, readerMeta } from './rating';

test('a rated reader shows their average to one place, with the count', () => {
  expect(formatRating({ ratingsAvg: 4.5, ratingsCount: 2 })).toBe('4.5 of 5 · 2 ratings');
  expect(formatRating({ ratingsAvg: 1, ratingsCount: 1 })).toBe('1.0 of 5 · 1 rating');
  expect(formatRating({ ratingsAvg: 2.3333333, ratingsCount: 3 })).toBe('2.3 of 5 · 3 ratings');
});

test('a reader nobody has rated shows "No ratings yet", never a number', () => {
  expect(formatRating({ ratingsAvg: 0, ratingsCount: 0 })).toBe('No ratings yet');
  expect(formatRating({})).toBe('No ratings yet');
  expect(formatRating(undefined)).toBe('No ratings yet');
  // The retired field is ignored even when an old account still carries it.
  expect(formatRating({ ratings: 5 })).toBe('No ratings yet');
});

test('the meta line joins location and rating, leaving out a missing location', () => {
  expect(readerMeta({ location: 'Queens', ratingsAvg: 4.5, ratingsCount: 2 })).toBe(
    'Queens · 4.5 of 5 · 2 ratings'
  );
  expect(readerMeta({ ratingsCount: 0 })).toBe('No ratings yet');
  expect(readerMeta({ ratingsCount: 0 }, { noLocation: '—' })).toBe('— · No ratings yet');
});
