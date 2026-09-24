// Wishlist matching: a wishlisted book matches an offered one when both carry
// the same ISBN. It runs both ways: a reader's matches are the offers of their
// wishlisted books (GET /user/wishlist/matches), and a newly offered book is
// matched to the readers who wishlisted it (the wishlist notification).
// Either way the offer must be on the market for that reader: not their own,
// not locked into an accepted trade, not from a reader blocked either way.
import { OfferedBook, WishlistBook } from "../Data.js";
import { blockedUserIds, marketFilter } from "./blocks.js";

const MATCHES_MAX_OFFERS = 200;

// The ISBN a book is matched on, "" when it has none.
export const matchIsbn = (book) => (book?.isbn || "").trim();

// The caller's wishlisted books that other readers are offering right now: one
// entry per wishlist book with at least one offer, in wishlist order, each
// offer carrying its owner with `ownerFields`. Two indexed reads: the wishlist
// by userId, then the offers by ISBN.
export async function wishlistMatches(userId, ownerFields) {
  const wishlist = await WishlistBook.find({ userId }).select("title author cover isbn").lean();
  const isbns = [...new Set(wishlist.map(matchIsbn).filter(Boolean))];
  if (!isbns.length) return [];

  const offers = await OfferedBook.find({ ...(await marketFilter(userId)), isbn: { $in: isbns } })
    .select("title author cover isbn owner createdAt")
    .sort({ createdAt: -1, _id: -1 })
    .limit(MATCHES_MAX_OFFERS)
    .populate("owner", ownerFields)
    .lean();

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

// The ids of the readers whose matches include `offer`, each once.
export async function readersMatching(offer) {
  const isbn = matchIsbn(offer);
  // Offers are looked up by their stored ISBN, so one stored with surrounding
  // space never appears among anyone's matches.
  if (!isbn || isbn !== offer.isbn || offer.locked) return [];

  const excluded = [...(await blockedUserIds(offer.owner)), offer.owner];
  const wishlisted = await WishlistBook.find({ isbn, userId: { $nin: excluded } })
    .select("userId")
    .lean();
  return [...new Set(wishlisted.map((b) => String(b.userId)))];
}
