// Taking offered books off the market for good.
import { OfferedBook } from "../Data.js";
import { discardBookBlobs } from "./photos.js";

/**
 * Deletes the offered books matching `filter`, inside `session` if given, and
 * every blob under them with them (lib/photos.js). Every path that deletes an
 * offered book goes through here, so no photo outlives its book. Returns
 * `{ removed, cleanup }`: how many books were deleted and, inside a
 * transaction, the id to pass to cleanUpPhotosInBackground once it has committed.
 */
export async function removeOfferedBooks(filter, { session } = {}) {
  const books = await OfferedBook.find(filter)
    .select("_id")
    .session(session ?? null)
    .lean();
  if (!books.length) return { removed: 0, cleanup: null };

  const { deletedCount } = await OfferedBook.deleteMany(
    { _id: { $in: books.map((book) => book._id) } },
    { session }
  );
  const cleanup = await discardBookBlobs(
    books.map((book) => book._id),
    { session }
  );
  return { removed: deletedCount, cleanup };
}
