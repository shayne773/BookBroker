import { expect } from "chai";
import { OfferedBook, User } from "../Data.js";
import { seed } from "../seed.js";
import { createOfferedBook, createUser, googleVolume, httpFailure, mockHttp } from "./helpers.js";

const quiet = { pauseMs: 0, log: () => {} };

// The previous seed: one seeded user with one book.
async function previousSeed() {
  const user = await createUser({ email: "seed_user_1@example.com", username: "seed_user_1" });
  await createOfferedBook(user, { title: "Old seeded book" });
  return user;
}

// A Google that answers each search with 40 fresh volumes; every tenth has no
// image, and Open Library has a cover for those.
function fakeSources({ onGoogle = async () => {} } = {}) {
  let n = 0;
  return mockHttp(async (url, params) => {
    if (url === "https://openlibrary.org/search.json") return { docs: [{ cover_i: 900 }] };

    await onGoogle();
    const items = Array.from({ length: 40 }, () => {
      n += 1;
      const isbn = `978${String(n).padStart(10, "0")}`;
      return googleVolume(`v${n}`, { isbn, thumbnail: n % 10 === 0 ? null : undefined });
    });
    expect(params.key).to.equal("seed-test-key");
    return { items };
  });
}

describe("seed.js", () => {
  it("refuses to start without GOOGLE_BOOKS_API_KEY, and deletes nothing", async () => {
    await previousSeed();
    const calls = fakeSources();

    let error;
    try {
      await seed(quiet);
    } catch (err) {
      error = err;
    }

    expect(error?.message).to.match(/GOOGLE_BOOKS_API_KEY/);
    expect(calls).to.have.length(0);
    expect(await OfferedBook.countDocuments({ title: "Old seeded book" })).to.equal(1);
  });

  it("keeps the previous seed when Google refuses", async () => {
    process.env.GOOGLE_BOOKS_API_KEY = "seed-test-key";
    await previousSeed();
    mockHttp(() => {
      throw httpFailure(429, "Quota exceeded");
    });

    let error;
    try {
      await seed(quiet);
    } catch (err) {
      error = err;
    }

    expect(error?.name).to.equal("GoogleBooksUnavailableError");
    expect(await User.countDocuments({ email: "seed_user_1@example.com" })).to.equal(1);
    expect(await OfferedBook.countDocuments({ title: "Old seeded book" })).to.equal(1);
  });

  it("fetches every book before deleting the previous seed, then replaces it", async () => {
    process.env.GOOGLE_BOOKS_API_KEY = "seed-test-key";
    await previousSeed();
    const oldBookSeenAtEachFetch = [];
    fakeSources({
      onGoogle: async () => {
        oldBookSeenAtEachFetch.push(await OfferedBook.countDocuments({ title: "Old seeded book" }));
      },
    });

    await seed(quiet);

    expect(oldBookSeenAtEachFetch).to.not.be.empty;
    expect(oldBookSeenAtEachFetch.every((n) => n === 1)).to.equal(true);
    expect(await OfferedBook.countDocuments({ title: "Old seeded book" })).to.equal(0);
    expect(await User.countDocuments({ email: /^seed_user_/ })).to.equal(10);

    const books = await OfferedBook.find().lean();
    expect(books).to.have.length(100);
    expect(books.every((b) => b.cover.startsWith("https://"))).to.equal(true);
    expect(books.filter((b) => b.cover === "https://covers.openlibrary.org/b/id/900-M.jpg")).to.have.length(10);
  });
});
