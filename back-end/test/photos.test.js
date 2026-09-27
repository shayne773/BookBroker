import { expect } from "chai";
import { api, mockBlobStore, offerBook, photo, signUp } from "./helpers.js";
import { OfferedBook, PhotoCleanup } from "../Data.js";
import Exchange from "../Exchange.js";
import { BlobStoreNotFoundError } from "@vercel/blob";
import { blobStore, MAX_PHOTO_BYTES, photoCleanupSettled } from "../lib/photos.js";
import { resolveTradeDeadlines } from "../lib/tradeDeadlines.js";

const MB = 1024 * 1024;

describe("book photos", () => {
  let owner;
  let other;
  let book;
  let store;

  beforeEach(async () => {
    owner = await signUp();
    other = await signUp();
    book = await offerBook(owner);
    store = mockBlobStore();
  });

  const photosPath = (id = book.id) => `/user/offered/${id}/photos`;
  const tokenFor = (reader, body = { contentType: "image/jpeg", size: 300_000 }, id) =>
    api(reader.token).post(`${photosPath(id)}/upload-token`).send(body);
  const addPhoto = (reader, url, id, size = { width: 1200, height: 1600 }) =>
    api(reader.token).post(photosPath(id)).send({ url, ...size });
  const storedPhotos = async (id = book.id) => (await OfferedBook.findById(id).lean()).photos;
  const withPhotos = async (count, target = book) => {
    const urls = Array.from({ length: count }, () => store.upload(target.id));
    await OfferedBook.updateOne({ _id: target.id }, { $set: { photos: urls.map((url) => photo(url)) } });
    return urls;
  };

  describe("POST /user/offered/:id/photos/upload-token", () => {
    it("gives the owner a token for one blob under the book, of that type and at most 2 MB", async () => {
      const res = await tokenFor(owner, { contentType: "image/webp", size: 500_000 });

      expect(res).to.have.status(200);
      expect(res.body.token).to.be.a("string");
      expect(res.body.pathname).to.match(new RegExp(`^books/${book.id}/[0-9a-f]{32}\\.webp$`));
      const [options] = store.tokens;
      expect(options).to.include({
        pathname: res.body.pathname,
        maximumSizeInBytes: MAX_PHOTO_BYTES,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      expect(options.allowedContentTypes).to.deep.equal(["image/webp"]);
      expect(options.validUntil).to.be.above(Date.now());
    });

    it("answers not found for another reader's book, a missing book or a malformed id", async () => {
      expect(await tokenFor(other)).to.have.status(404);
      expect(await tokenFor(owner, undefined, "0123456789abcdef01234567")).to.have.status(404);
      expect(await tokenFor(owner, undefined, "nope")).to.have.status(404);
      expect(store.tokens).to.be.empty;
    });

    it("refuses a type other than JPEG, PNG or WebP", async () => {
      for (const contentType of ["image/gif", "image/svg+xml", "text/html", undefined]) {
        const res = await tokenFor(owner, { contentType, size: 1000 });
        expect(res, String(contentType)).to.have.status(400);
      }
      expect(store.tokens).to.be.empty;
    });

    it("refuses a photo over 2 MB or without a size", async () => {
      expect(await tokenFor(owner, { contentType: "image/jpeg", size: 2 * MB + 1 })).to.have.status(413);
      expect(await tokenFor(owner, { contentType: "image/jpeg" })).to.have.status(400);
      expect(await tokenFor(owner, { contentType: "image/jpeg", size: 2 * MB })).to.have.status(200);
    });

    it("refuses a fifth photo", async () => {
      await withPhotos(4);
      const res = await tokenFor(owner);
      expect(res).to.have.status(409);
      expect(res.body.message).to.match(/up to 4 photos/);
    });

    it("answers 503 when no Blob store is configured", async () => {
      delete process.env.BLOB_READ_WRITE_TOKEN;
      const res = await tokenFor(owner);
      expect(res).to.have.status(503);
      expect(res.body.code).to.equal("PHOTOS_UNAVAILABLE");
    });

    it("needs a signed-in reader", async () => {
      expect(await api().post(`${photosPath()}/upload-token`).send({})).to.have.status(401);
    });
  });

  describe("POST /user/offered/:id/photos", () => {
    it("keeps an uploaded photo's URL and size, and the book page shows it", async () => {
      const url = store.upload(book.id);

      const res = await addPhoto(owner, url);

      expect(res).to.have.status(201);
      expect(res.body.photos).to.have.length(1);
      expect(res.body.photos[0]).to.include({ url, width: 1200, height: 1600 });
      expect((await storedPhotos())[0]).to.include({ url });

      const page = await api(other.token).get(`/books/${book.id}`);
      expect(page.body.photos.map((p) => p.url)).to.deep.equal([url]);
    });

    it("adds each new photo last and stops at four", async () => {
      const urls = await withPhotos(3);
      const fourth = store.upload(book.id);
      expect(await addPhoto(owner, fourth)).to.have.status(201);
      expect((await storedPhotos()).map((p) => p.url)).to.deep.equal([...urls, fourth]);

      const fifth = store.upload(book.id);
      expect(await addPhoto(owner, fifth)).to.have.status(409);
      await photoCleanupSettled();
      expect(store.deleted).to.deep.equal([fifth]);
      expect(await storedPhotos()).to.have.length(4);
    });

    it("takes the same upload once", async () => {
      const url = store.upload(book.id);
      expect(await addPhoto(owner, url)).to.have.status(201);
      const again = await addPhoto(owner, url);
      expect(again).to.have.status(200);
      expect(again.body.photos).to.have.length(1);
    });

    it("refuses a URL the store does not have", async () => {
      const res = await addPhoto(owner, `https://teststore.public.blob.vercel-storage.com/books/${book.id}/x.jpg`);
      expect(res).to.have.status(400);
      expect(await addPhoto(owner, "http://example.com/a.jpg")).to.have.status(400);
      expect(await addPhoto(owner, "not a url")).to.have.status(400);
      expect(await storedPhotos()).to.be.empty;
    });

    it("refuses another book's upload and leaves it alone", async () => {
      const otherBook = await offerBook(other);
      const url = store.upload(otherBook.id);

      expect(await addPhoto(owner, url)).to.have.status(400);
      await photoCleanupSettled();
      expect(store.deleted).to.be.empty;
    });

    it("refuses, and deletes, an upload of the wrong type or size", async () => {
      const gif = store.upload(book.id, { contentType: "image/gif" });
      const huge = store.upload(book.id, { size: MAX_PHOTO_BYTES + 1 });

      expect(await addPhoto(owner, gif)).to.have.status(400);
      expect(await addPhoto(owner, huge)).to.have.status(400);
      await photoCleanupSettled();
      expect(store.deleted).to.have.members([gif, huge]);
      expect(await storedPhotos()).to.be.empty;
    });

    it("refuses a photo without a proper width and height", async () => {
      const url = store.upload(book.id);
      expect(await addPhoto(owner, url, book.id, { width: 0, height: 100 })).to.have.status(400);
      expect(await addPhoto(owner, url, book.id, { width: "800", height: 600 })).to.have.status(400);
      expect(await addPhoto(owner, url, book.id, {})).to.have.status(400);
    });

    it("answers 503 when the store fails", async () => {
      const url = store.upload(book.id);
      blobStore.head = async () => {
        throw new BlobStoreNotFoundError();
      };
      const res = await addPhoto(owner, url);
      expect(res).to.have.status(503);
      expect(res.body.code).to.equal("PHOTOS_UNAVAILABLE");
    });

    it("lets nobody but the owner add a photo", async () => {
      const url = store.upload(book.id);
      expect(await addPhoto(other, url)).to.have.status(404);
      expect(await storedPhotos()).to.be.empty;
    });
  });

  describe("DELETE /user/offered/:id/photos/:photoId", () => {
    it("removes the photo and deletes its blob", async () => {
      const [first, second] = await withPhotos(2);
      const [firstPhoto] = await storedPhotos();

      const res = await api(owner.token).delete(`${photosPath()}/${firstPhoto._id}`);

      expect(res).to.have.status(200);
      expect(res.body.photos.map((p) => p.url)).to.deep.equal([second]);
      await photoCleanupSettled();
      expect(store.deleted).to.deep.equal([first]);
      expect(await PhotoCleanup.countDocuments()).to.equal(0);
    });

    it("lets nobody but the owner remove a photo", async () => {
      await withPhotos(1);
      const [stored] = await storedPhotos();

      expect(await api(other.token).delete(`${photosPath()}/${stored._id}`)).to.have.status(404);
      expect(await api(owner.token).delete(`${photosPath()}/0123456789abcdef01234567`)).to.have.status(404);
      expect(await storedPhotos()).to.have.length(1);
      await photoCleanupSettled();
      expect(store.deleted).to.be.empty;
    });

    it("still removes the photo when its blob cannot be deleted, and the cron retries it", async () => {
      const [url] = await withPhotos(1);
      const [stored] = await storedPhotos();
      store.failDeletes = true;

      expect(await api(owner.token).delete(`${photosPath()}/${stored._id}`)).to.have.status(200);
      await photoCleanupSettled();
      expect(await storedPhotos()).to.be.empty;
      const [pending] = await PhotoCleanup.find().lean();
      expect(pending).to.include({ attempts: 1 });
      expect(pending.urls).to.deep.equal([url]);

      store.failDeletes = false;
      process.env.CRON_SECRET = "test-cron-secret-0123456789";
      try {
        const cron = await api()
          .get("/cron/photo-cleanup")
          .set("Authorization", "Bearer test-cron-secret-0123456789");
        expect(cron).to.have.status(200);
        expect(cron.body).to.deep.equal({ cleared: 1 });
      } finally {
        delete process.env.CRON_SECRET;
      }
      expect(store.deleted).to.deep.equal([url]);
      expect(await PhotoCleanup.countDocuments()).to.equal(0);
    });
  });

  describe("PUT /user/offered/:id/photos/order", () => {
    it("puts the photos in the given order, the first becoming the main one", async () => {
      const urls = await withPhotos(3);
      const ids = (await storedPhotos()).map((p) => String(p._id));

      const res = await api(owner.token).put(`${photosPath()}/order`).send({ order: [ids[2], ids[0], ids[1]] });

      expect(res).to.have.status(200);
      expect(res.body.photos.map((p) => p.url)).to.deep.equal([urls[2], urls[0], urls[1]]);
      expect((await storedPhotos()).map((p) => p.url)).to.deep.equal([urls[2], urls[0], urls[1]]);
    });

    it("refuses an order that is not every photo exactly once", async () => {
      await withPhotos(3);
      const ids = (await storedPhotos()).map((p) => String(p._id));

      for (const order of [ids.slice(0, 2), [ids[0], ids[0], ids[1]], [...ids, ids[0]], "x", undefined]) {
        const res = await api(owner.token).put(`${photosPath()}/order`).send({ order });
        expect(res, JSON.stringify(order)).to.have.status(409);
      }
    });

    it("lets nobody but the owner reorder", async () => {
      await withPhotos(2);
      const ids = (await storedPhotos()).map((p) => String(p._id));
      const res = await api(other.token).put(`${photosPath()}/order`).send({ order: ids.reverse() });
      expect(res).to.have.status(404);
    });
  });

  describe("what the other routes send", () => {
    it("tells the owner, and only the owner, that they can add photos", async () => {
      expect((await api(owner.token).get(`/books/${book.id}`)).body.photoUploads).to.equal(true);
      expect((await api(other.token).get(`/books/${book.id}`)).body.photoUploads).to.equal(false);
      expect((await api().get(`/books/${book.id}`)).body.photoUploads).to.equal(false);
      expect((await api(owner.token).get("/user")).body.photoUploads).to.equal(true);
    });

    it("offers no photos without a Blob store, while the rest works and stored photos still show", async () => {
      const [url] = await withPhotos(1);
      delete process.env.BLOB_READ_WRITE_TOKEN;

      const page = await api(owner.token).get(`/books/${book.id}`);
      expect(page).to.have.status(200);
      expect(page.body.photoUploads).to.equal(false);
      expect(page.body.photos.map((p) => p.url)).to.deep.equal([url]);
      expect((await api(owner.token).get("/user")).body.photoUploads).to.equal(false);

      const added = await api(owner.token)
        .post("/user/add-offered-book")
        .send({ title: "Dune", author: "Frank Herbert", isbn: "9780441013593", cover: "https://example.com/c.jpg" });
      expect(added).to.have.status(201);
      expect(added.body.id).to.be.a("string");
    });

    it("lists only how many photos a book has", async () => {
      const [url] = await withPhotos(2);

      const lists = [
        (await api(other.token).get("/new")).body,
        (await api(other.token).get(`/users/${owner.id}/offered`)).body,
      ];
      for (const list of lists) {
        const listed = list.find((b) => b._id === book.id);
        expect(listed.photoCount).to.equal(2);
        expect(listed).not.to.have.property("photos");
        expect(JSON.stringify(list)).not.to.include(url);
      }
    });
  });

  describe("deleting a book's blobs with the book", () => {
    it("when its owner takes it off their shelf", async () => {
      const urls = await withPhotos(2);

      expect(await api(owner.token).delete(`/user/offered/${book.id}`)).to.have.status(200);

      await photoCleanupSettled();
      expect(store.deleted).to.have.members(urls);
      expect(await PhotoCleanup.countDocuments()).to.equal(0);
    });

    it("not when someone else tries to", async () => {
      await withPhotos(1);
      expect(await api(other.token).delete(`/user/offered/${book.id}`)).to.have.status(404);
      await photoCleanupSettled();
      expect(store.deleted).to.be.empty;
    });

    // A trade between owner's `book` and a book of `other`, accepted and
    // confirmed by the owner; returns its id and the photos of both books.
    async function confirmedTrade() {
      const theirs = await offerBook(other);
      const urls = [...(await withPhotos(1)), ...(await withPhotos(2, theirs))];
      const proposed = await api(owner.token)
        .post("/exchanges")
        .send({ responderId: other.id, requesterBooks: [book.id], responderBooks: [theirs.id] });
      expect(proposed).to.have.status(201);
      const id = proposed.body._id;
      expect(await api(other.token).post(`/exchanges/${id}/accept`)).to.have.status(200);
      expect(await api(owner.token).post(`/exchanges/${id}/confirm-complete`)).to.have.status(200);
      return { id, urls };
    }

    it("when both sides confirm a trade", async () => {
      const { id, urls } = await confirmedTrade();
      await photoCleanupSettled();
      expect(store.deleted).to.be.empty;

      expect(await api(other.token).post(`/exchanges/${id}/confirm-complete`)).to.have.status(200);

      await photoCleanupSettled();
      expect(store.deleted).to.have.members(urls);
      expect(await OfferedBook.countDocuments()).to.equal(0);
    });

    it("when a trade completes on its own", async () => {
      const { id, urls } = await confirmedTrade();
      await Exchange.updateOne({ _id: id }, { $set: { autoCompletesAt: new Date(Date.now() - 1000) } });

      expect((await resolveTradeDeadlines()).completed).to.equal(1);

      await photoCleanupSettled();
      expect(store.deleted).to.have.members(urls);
    });
  });
});
