// Taking offered books off the market for good.
import { OfferedBook } from "../Data.js";
import { discardPhotos } from "./photos.js";

/**
 * Deletes the offered books matching `filter`, inside `session` if given, and
 * their photos' blobs with them (lib/photos.js). Every path that deletes an
 * offered book goes through here, so no photo outlives its book. Inside a
 * transaction, call cleanUpPhotosInBackground once it has committed. Returns
 * how many books were deleted.
 */
export async function removeOfferedBooks(filter, { session } = {}) {
  const books = await OfferedBook.find(filter)
    .select("photos")
    .session(session ?? null)
    .lean();
  if (!books.length) return 0;

  const { deletedCount } = await OfferedBook.deleteMany(
    { _id: { $in: books.map((book) => book._id) } },
    { session }
  );
  await discardPhotos(
    books.flatMap((book) => (book.photos ?? []).map((photo) => photo.url)),
    { session }
  );
  return deletedCount;
}
