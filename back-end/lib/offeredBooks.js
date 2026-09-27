// Taking offered books off the market for good.
import { OfferedBook } from "../Data.js";
import { discardBookBlobs } from "./photos.js";

/**
 * Deletes the offered books matching `filter`, inside `session` if given, and
 * every blob under them with them (lib/photos.js). Every path that deletes an
 * offered book goes through here, so no photo outlives its book. Returns
 * `{ removed, bookIds }`: how many books were deleted and which. Without a
 * session their blobs go right away; inside a transaction, pass `bookIds` to
 * discardBookBlobs once it has committed.
 */
export async function removeOfferedBooks(filter, { session } = {}) {
  const books = await OfferedBook.find(filter)
    .select("_id")
    .session(session ?? null)
    .lean();
  if (!books.length) return { removed: 0, bookIds: [] };

  const { deletedCount } = await OfferedBook.deleteMany(
    { _id: { $in: books.map((book) => book._id) } },
    { session }
  );
  const bookIds = books.map((book) => book._id);
  if (!session) discardBookBlobs(bookIds);
  return { removed: deletedCount, bookIds };
}
