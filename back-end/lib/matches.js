// Wishlist matching: a wishlisted book matches an offered one when both carry
// the same ISBN. It runs both ways: a reader's matches are the offers of their
// wishlisted books (GET /user/wishlist/matches), and a newly offered book is
// matched to the readers who wishlisted it (the wishlist notification).
// Either way the offer must be on the market for that reader: not their own,
// not locked into an accepted trade, not from a reader blocked either way, and
// within their distance when they have set a ZIP code (lib/nearby.js).
import { DEFAULT_DISTANCE_MILES, OfferedBook, User, WishlistBook } from "../Data.js";
import { blockedUserIds, marketFilter } from "./blocks.js";
import { listBooks } from "./listings.js";
import { metersBetween, readerArea, withinReach } from "./nearby.js";

const MATCHES_MAX_OFFERS = 200;

// The ISBN a book is matched on, "" when it has none.
export const matchIsbn = (book) => (book?.isbn || "").trim();

// The caller's wishlisted books that other readers are offering right now: one
// entry per wishlist book with at least one offer, in wishlist order, each
// offer carrying its owner with `ownerFields` and, when the caller has an area,
// its `distanceMiles`, nearest first. Indexed reads: the wishlist by userId,
// then the offers by position and ISBN.
export async function wishlistMatches(userId, ownerFields) {
  const wishlist = await WishlistBook.find({ userId }).select("title author cover isbn").lean();
  const isbns = [...new Set(wishlist.map(matchIsbn).filter(Boolean))];
  if (!isbns.length) return [];

  const offers = await OfferedBook.populate(
    await listBooks({
      area: await readerArea(userId),
      match: { ...(await marketFilter(userId)), isbn: { $in: isbns } },
      stages: [{ $project: { title: 1, author: 1, cover: 1, isbn: 1, owner: 1, createdAt: 1, distance: 1 } }],
      limit: MATCHES_MAX_OFFERS,
    }),
    { path: "owner", select: ownerFields, options: { lean: true } }
  );

  const offersByIsbn = new Map();
  for (const offer of offers) {
    if (!offer.owner) continue; // an owner deleted since the book was listed
    const list = offersByIsbn.get(offer.isbn) ?? [];
    list.push(offer);
    offersByIsbn.set(offer.isbn, list);
  }

  return wishlist
    .map((wishlistBook) => ({
      wishlistBook,
      offers: offersByIsbn.get(matchIsbn(wishlistBook)) ?? [],
    }))
    .filter((match) => match.offers.length);
}

// The ids of the readers whose matches include `offer`, each once, nearest
// first: those within reach of it (all of them, when they have no ZIP), in the
// same terms as wishlistMatches. `offer.ownerGeo` is its position, if any.
export async function readersMatching(offer) {
  const isbn = matchIsbn(offer);
  // Offers are looked up by their stored ISBN, so one stored with surrounding
  // space never appears among anyone's matches.
  if (!isbn || isbn !== offer.isbn || offer.locked) return [];

  const excluded = [...(await blockedUserIds(offer.owner)), offer.owner];
  const wishlisted = await WishlistBook.find({ isbn, userId: { $nin: excluded } })
    .select("userId")
    .lean();
  const readers = await User.find({ _id: { $in: wishlisted.map((b) => b.userId) } })
    .select("geo maxDistanceMiles")
    .lean();

  const at = offer.ownerGeo;
  const distance = (reader) => (reader.geo && at ? metersBetween(reader.geo, at) : Infinity);
  return readers
    .filter((reader) =>
      withinReach(
        reader.geo && { point: reader.geo, miles: reader.maxDistanceMiles ?? DEFAULT_DISTANCE_MILES },
        at
      )
    )
    .sort((a, b) => distance(a) - distance(b))
    .map((reader) => String(reader._id));
}
