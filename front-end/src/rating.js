// How a reader's rating reads wherever the app names them. The rating is the
// running average of the stars their completed trades earned (ratingsAvg), over
// ratingsCount ratings; the API sends both wherever it sends a reader.

// What a reader nobody has rated yet shows instead of an average.
// TODO(never-rated-display): pending a product decision - "0", blank, or "No rating yet".
export const NEVER_RATED = '';

export const isRated = (user) => Number(user?.ratingsCount) > 0;

// "4.5 of 5 · 2 ratings", or NEVER_RATED.
export const formatRating = (user) => {
  if (!isRated(user)) return NEVER_RATED;

  const count = Number(user.ratingsCount);
  const average = Number(user.ratingsAvg).toFixed(1);
  return `${average} of 5 · ${count} ${count === 1 ? 'rating' : 'ratings'}`;
};

// A reader's meta line: their location and rating, leaving out whichever is empty.
export const readerMeta = (user, { noLocation = '' } = {}) =>
  [user?.location || noLocation, formatRating(user)].filter(Boolean).join(' · ');
