import { expect } from "chai";
import { OfferedBook, WishlistBook } from "../Data.js";
import { BOOK_SEARCH_UNAVAILABLE, BOOK_SEARCH_UNAVAILABLE_MESSAGE } from "../lib/googleBooks.js";
import { api, googleVolume, httpFailure, mockHttp, signUp } from "./helpers.js";

const KEY = "test-google-books-key";

describe("Google Books proxy", () => {
  it("requires sign-in and makes no Google request without it", async () => {
    process.env.GOOGLE_BOOKS_API_KEY = KEY;
    const calls = mockHttp(() => ({ items: [] }));

    const res = await api().get("/google-books/search?q=clean%20code");

    expect(res).to.have.status(401);
    expect(calls).to.have.length(0);
  });

  it("searches Google with the server-side key and returns https covers", async () => {
    process.env.GOOGLE_BOOKS_API_KEY = KEY;
    const calls = mockHttp(() => ({
      items: [googleVolume("vol1", { isbn: "9780132350884", title: "Clean Code" })],
    }));
    const { token } = await signUp();

    const res = await api(token).get("/google-books/search?q=clean%20code");

    expect(res).to.have.status(200);
    expect(calls).to.have.length(1);
    expect(calls[0].url).to.equal("https://www.googleapis.com/books/v1/volumes");
    expect(calls[0].params).to.include({ q: "clean code", key: KEY });
    expect(res.body.books).to.have.length(1);
    expect(res.body.books[0]).to.include({
      title: "Clean Code",
      isbn: "9780132350884",
      cover: "https://books.google.com/books/content?id=vol1&img=1",
    });
  });

  it("answers an identical query from its cache", async () => {
    process.env.GOOGLE_BOOKS_API_KEY = KEY;
    const calls = mockHttp(() => ({ items: [googleVolume("vol1", { isbn: "9780132350884" })] }));
    const { token } = await signUp();

    await api(token).get("/google-books/search?q=dune");
    const again = await api(token).get("/google-books/search?q=dune");

    expect(again).to.have.status(200);
    expect(again.body.books).to.have.length(1);
    expect(calls).to.have.length(1);
  });

  it("reports an exhausted Google quota as book search being unavailable", async () => {
    process.env.GOOGLE_BOOKS_API_KEY = KEY;
    mockHttp(() => {
      throw httpFailure(429, "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'");
    });
    const { token } = await signUp();

    const res = await api(token).get("/google-books/search?q=dune");

    expect(res).to.have.status(503);
    expect(res.body).to.deep.equal({
      message: BOOK_SEARCH_UNAVAILABLE_MESSAGE,
      code: BOOK_SEARCH_UNAVAILABLE,
    });
    expect(res.text).to.not.include(KEY);
  });

  it("reports a missing key as book search being unavailable, without calling Google", async () => {
    const calls = mockHttp(() => ({ items: [] }));
    const { token } = await signUp();

    const res = await api(token).get("/google-books/search?q=dune");

    expect(res).to.have.status(503);
    expect(res.body.code).to.equal(BOOK_SEARCH_UNAVAILABLE);
    expect(calls).to.have.length(0);
  });

  it("rejects a query that is too short", async () => {
    process.env.GOOGLE_BOOKS_API_KEY = KEY;
    const calls = mockHttp(() => ({ items: [] }));
    const { token } = await signUp();

    const res = await api(token).get("/google-books/search?q=a");

    expect(res).to.have.status(400);
    expect(calls).to.have.length(0);
  });

  it("limits how many lookups one reader can make", async function () {
    this.timeout(30000);
    process.env.GOOGLE_BOOKS_API_KEY = KEY;
    mockHttp(() => ({ items: [] }));
    const { token } = await signUp();

    let res;
    for (let i = 0; i < 61; i++) {
      res = await api(token).get(`/google-books/search?q=query${i}`);
      if (res.status === 429) break;
    }

    expect(res).to.have.status(429);
    expect(res).to.have.header("retry-after");
    // Another reader keeps their own budget.
    const other = await signUp();
    expect(await api(other.token).get("/google-books/search?q=dune")).to.have.status(200);
  });
});

describe("cover capture when a book is added", () => {
  const book = {
    title: "The Hobbit",
    author: "J. R. R. Tolkien",
    isbn: "9780261102217",
    cover: "",
  };

  it("falls back to Open Library's cover id URL when Google has no image", async () => {
    const calls = mockHttp((url, params) => {
      expect(url).to.equal("https://openlibrary.org/search.json");
      expect(params.isbn).to.equal("9780261102217");
      return { docs: [{ cover_i: 12345 }] };
    });
    const { token } = await signUp();

    const res = await api(token).post("/user/add-offered-book").send(book);

    expect(res).to.have.status(201);
    expect(calls).to.have.length(1);
    const stored = await OfferedBook.findOne({ isbn: book.isbn }).lean();
    expect(stored.cover).to.equal("https://covers.openlibrary.org/b/id/12345-M.jpg");
  });

  it("stores no cover when Open Library has none or cannot be reached", async () => {
    mockHttp(() => ({ docs: [{}] }));
    const { token } = await signUp();
    expect(await api(token).post("/user/add-wishlist-book").send(book)).to.have.status(201);

    mockHttp(() => {
      throw httpFailure(500);
    });
    expect(await api(token).post("/user/add-offered-book").send(book)).to.have.status(201);

    expect((await WishlistBook.findOne({ isbn: book.isbn }).lean()).cover).to.equal("");
    expect((await OfferedBook.findOne({ isbn: book.isbn }).lean()).cover).to.equal("");
  });

  it("stores Google's cover as https without another lookup", async () => {
    const calls = mockHttp(() => ({ docs: [] }));
    const { token } = await signUp();
    const cover = "http://books.google.com/books/content?id=abc&img=1";

    expect(await api(token).post("/user/add-wishlist-book").send({ ...book, cover })).to.have.status(201);
    expect(await api(token).post("/user/add-offered-book").send({ ...book, cover })).to.have.status(201);

    const https = "https://books.google.com/books/content?id=abc&img=1";
    expect((await WishlistBook.findOne({ isbn: book.isbn }).lean()).cover).to.equal(https);
    expect((await OfferedBook.findOne({ isbn: book.isbn }).lean()).cover).to.equal(https);
    expect(calls).to.have.length(0);
  });
});
