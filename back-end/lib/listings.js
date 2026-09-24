// The book lists a reader browses: each is the books matching a market filter
// (lib/blocks.js) within the reader's area (lib/nearby.js), nearest first
// unless the list has an order of its own, every book labelled with its
// distance. Without an area they cover the whole market, newest first.
import { OfferedBook, WishlistBook } from "../Data.js";
import { geoNearStage, presentStages } from "./nearby.js";

export const NEWEST_FIRST = { createdAt: -1, _id: -1 };
const NEAREST_FIRST = { distance: 1, ...NEWEST_FIRST };

/**
 * Books matching `match` within `area` (null for the whole market): run
 * through `stages`, ordered by `sort` (default nearest first, or newest first
 * without an area), at most `limit` of them.
 */
export function listBooks({ area, match, stages = [], sort, limit }) {
  const pipeline = [
    area ? geoNearStage(area, match) : { $match: match },
    ...stages,
    { $sort: sort ?? (area ? NEAREST_FIRST : NEWEST_FIRST) },
    ...(limit ? [{ $limit: limit }] : []),
    ...presentStages(area),
  ];
  return OfferedBook.aggregate(pipeline);
}

// Normalised (trimmed, lower-cased) value of a book field, "" when missing.
const normalised = (field) => ({ $toLower: { $trim: { input: { $ifNull: [field, ""] } } } });

// Adds `wantedBy`: how many readers have the same book on their wishlist. Two
// books are the same when both carry an ISBN and it agrees; otherwise title
// and author agree, ignoring case.
const WANTED_BY_STAGES = [
  {
    $lookup: {
      from: WishlistBook.collection.name,
      let: {
        bookIsbn: normalised("$isbn"),
        bookTitle: normalised("$title"),
        bookAuthor: normalised("$author"),
      },
      pipeline: [
        {
          $match: {
            $expr: {
              $let: {
                vars: {
                  isbn: normalised("$isbn"),
                  title: normalised("$title"),
                  author: normalised("$author"),
                },
                in: {
                  $cond: [
                    { $and: [{ $ne: ["$$bookIsbn", ""] }, { $ne: ["$$isbn", ""] }] },
                    { $eq: ["$$bookIsbn", "$$isbn"] },
                    {
                      $and: [
                        { $ne: ["$$bookTitle", ""] },
                        { $eq: ["$$bookTitle", "$$title"] },
                        { $eq: ["$$bookAuthor", "$$author"] },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        { $group: { _id: "$userId" } },
      ],
      as: "wantedBy",
    },
  },
  { $set: { wantedBy: { $size: "$wantedBy" } } },
];

/**
 * Books matching `match` within `area`, most wanted first; ties, including
 * the case where nothing is wishlisted yet, go nearest first, then newest.
 */
export function mostWanted(area, match, limit) {
  return listBooks({
    area,
    match,
    stages: WANTED_BY_STAGES,
    sort: { wantedBy: -1, ...(area ? NEAREST_FIRST : NEWEST_FIRST) },
    limit,
  });
}

// Taste values that say nothing about a reader: Google Books fills a missing
// author or category with "Unknown" (lib/googleBooks.js).
const UNINFORMATIVE = new Set(["", "unknown"]);

// A book's authors, lower-cased: Google Books joins several with ", ".
const authorsOf = (author) =>
  String(author ?? "")
    .toLowerCase()
    .split(",")
    .map((a) => a.trim())
    .filter((a) => !UNINFORMATIVE.has(a));

/**
 * The authors and genres on the reader's wishlist and shelf, lower-cased:
 * `{ authors, genres }`.
 */
export async function readerTaste(userId) {
  const [wishlist, shelf] = await Promise.all([
    WishlistBook.find({ userId }).select("author genre").lean(),
    OfferedBook.find({ owner: userId }).select("author genre").lean(),
  ]);
  const authors = new Set();
  const genres = new Set();
  for (const book of [...wishlist, ...shelf]) {
    for (const author of authorsOf(book.author)) authors.add(author);
    const genre = String(book.genre ?? "").trim().toLowerCase();
    if (!UNINFORMATIVE.has(genre)) genres.add(genre);
  }
  return { authors: [...authors], genres: [...genres] };
}

/**
 * Books for the reader: those matching `match` within `area`, ranked by how
 * much they share with `taste` (an author in common counts twice a genre in
 * common, a genre being the broader signal), then by how many readers want
 * them, then nearest (or newest) first.
 */
export function recommendations({ area, match, taste, limit }) {
  const bookAuthors = {
    $map: {
      input: { $split: [normalised("$author"), ","] },
      in: { $trim: { input: "$$this" } },
    },
  };
  const sharesAuthor = {
    $anyElementTrue: [{ $map: { input: bookAuthors, in: { $in: ["$$this", taste.authors] } } }],
  };
  const sharesGenre = { $in: [normalised("$genre"), taste.genres] };

  return listBooks({
    area,
    match,
    stages: [
      {
        $set: {
          tasteScore: {
            $add: [{ $cond: [sharesAuthor, 2, 0] }, { $cond: [sharesGenre, 1, 0] }],
          },
        },
      },
      ...WANTED_BY_STAGES,
    ],
    sort: { tasteScore: -1, wantedBy: -1, ...(area ? NEAREST_FIRST : NEWEST_FIRST) },
    limit,
  }).then((books) => books.map(({ tasteScore, ...book }) => book));
}
