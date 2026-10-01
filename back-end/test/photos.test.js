import { expect } from "chai";
import { api, mockBlobStore, offerBook, photo, signUp, TEST_PASSWORD } from "./helpers.js";
import { OfferedBook } from "../Data.js";
import Exchange from "../Exchange.js";
import { BlobStoreNotFoundError } from "@vercel/blob";
import { blobStore, MAX_PHOTO_BYTES, photoCleanupSettled, photoNamespace, photoPrefix } from "../lib/photos.js";
import { resolveTradeDeadlines } from "../lib/tradeDeadlines.js";

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

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
  const runCleanupCron = async () => {
    process.env.CRON_SECRET = "test-cron-secret-0123456789";
    try {
      const cron = await api().get("/cron/photo-cleanup").set("Authorization", "Bearer test-cron-secret-0123456789");
      expect(cron).to.have.status(200);
      return cron.body;
    } finally {
      delete process.env.CRON_SECRET;
    }
  };
  // A connection to the same database name on another cluster, and where its blobs of `id` live.
  const otherCluster = {
    name: "bookbroker-test",
    getClient: () => ({ options: { srvHost: "cluster1.other.mongodb.net", hosts: [] } }),
  };
  const otherClusterPrefix = (id) => `${photoNamespace(otherCluster)}/books/${id}/`;
  // Locks `book` as an accepted trade does.
  const lock = () => OfferedBook.updateOne({ _id: book.id }, { $set: { locked: true } });
  const withPhotos = async (count, target = book) => {
    const urls = Array.from({ length: count }, () => store.upload(target.id));
    await OfferedBook.updateOne({ _id: target.id }, { $set: { photos: urls.map((url) => photo(url)) } });
    return urls;
  };

  describe("POST /user/offered/:id/photos/upload-token", () => {
    it("rations tokens to a dozen an hour per reader", async () => {
      for (let i = 0; i < 12; i += 1) expect(await tokenFor(owner)).to.have.status(200);
      const res = await tokenFor(owner);
      expect(res).to.have.status(429);
      expect(res).to.have.header("retry-after");
    });

    it("gives the owner a token for one blob under the book, of that type and at most 2 MB", async () => {
      const res = await tokenFor(owner, { contentType: "image/webp", size: 500_000 });

      expect(res).to.have.status(200);
      expect(res.body.token).to.be.a("string");
      expect(res.body.pathname).to.match(new RegExp(`^${photoPrefix(book.id)}[0-9a-f]{32}\\.webp$`));
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

    it("gives the owner a presigned upload under the same limits when the store is connected through OIDC", async () => {
      delete process.env.BLOB_READ_WRITE_TOKEN;
      store = mockBlobStore({ connected: true });

      const res = await tokenFor(owner, { contentType: "image/webp", size: 500_000 });

      expect(res).to.have.status(200);
      expect(res.body).to.not.have.property("token");
      expect(res.body.presigned).to.deep.equal({ delegationToken: "delegation-1", signature: "signature", params: {} });
      expect(res.body.pathname).to.match(new RegExp(`^${photoPrefix(book.id)}[0-9a-f]{32}\\.webp$`));
      expect(store.tokens).to.be.empty;
      const [options] = store.presigned;
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

  describe("POST /user/offered/:id/photos/presigned-upload", () => {
    const presigned = { delegationToken: "delegation", signature: "signature", params: { "vercel-blob-allow-overwrite": "false" } };
    const ask = (reader, clientPayload) =>
      api(reader?.token)
        .post(`${photosPath()}/presigned-upload`)
        .send({ type: "blob.generate-presigned-url", payload: { pathname: "a.jpg", clientPayload, multipart: false } });

    it("hands the Blob SDK back the presigned upload it was sent", async () => {
      const res = await ask(owner, JSON.stringify(presigned));
      expect(res).to.have.status(200);
      expect(res.body).to.deep.equal({ presignedUrlPayload: presigned });
    });

    it("refuses anything that is not a presigned upload", async () => {
      for (const clientPayload of [undefined, null, "nope", "{}", JSON.stringify({ ...presigned, params: { a: 1 } })]) {
        expect(await ask(owner, clientPayload), String(clientPayload)).to.have.status(400);
      }
      expect(await api(owner.token).post(`${photosPath()}/presigned-upload`).send()).to.have.status(400);
    });

    it("needs a signed-in reader", async () => {
      expect(await ask(null, JSON.stringify(presigned))).to.have.status(401);
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
      const res = await addPhoto(owner, `https://teststore.public.blob.vercel-storage.com/${photoPrefix(book.id)}x.jpg`);
      expect(res).to.have.status(400);
      expect(await addPhoto(owner, "http://example.com/a.jpg")).to.have.status(400);
      expect(await addPhoto(owner, "not a url")).to.have.status(400);
      expect(await storedPhotos()).to.be.empty;
    });

    it("refuses an upload for the same book id from another cluster and leaves it alone", async () => {
      const url = store.upload(book.id, { prefix: otherClusterPrefix(book.id) });

      expect(await addPhoto(owner, url)).to.have.status(400);
      await photoCleanupSettled();
      expect(store.deleted).to.be.empty;
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

    it("still removes the photo when its blob cannot be deleted, and the cron deletes it later", async () => {
      const [url] = await withPhotos(1);
      const [stored] = await storedPhotos();
      store.blobs.get(url).uploadedAt = new Date(Date.now() - 7 * DAY);
      store.failDeletes = true;

      expect(await api(owner.token).delete(`${photosPath()}/${stored._id}`)).to.have.status(200);
      await photoCleanupSettled();
      expect(await storedPhotos()).to.be.empty;
      expect(store.blobs.has(url)).to.equal(true);

      store.failDeletes = false;
      expect(await runCleanupCron()).to.deep.equal({ unattached: 1 });
      expect(store.deleted).to.deep.equal([url]);
    });

    it("answers that the book is locked when a trade locks it during the removal", async () => {
      await withPhotos(1);
      const [stored] = await storedPhotos();
      const findOneAndUpdate = OfferedBook.findOneAndUpdate;
      OfferedBook.findOneAndUpdate = function (...args) {
        OfferedBook.findOneAndUpdate = findOneAndUpdate;
        return { lean: async () => (await lock(), findOneAndUpdate.apply(this, args).lean()) };
      };

      try {
        const res = await api(owner.token).delete(`${photosPath()}/${stored._id}`);
        expect(res).to.have.status(409);
        expect(res.body.message).to.match(/accepted trade/);
      } finally {
        OfferedBook.findOneAndUpdate = findOneAndUpdate;
      }
      expect(await storedPhotos()).to.have.length(1);
    });
  });

  describe("a book an accepted trade holds", () => {
    it("keeps its photos: no new upload, addition, removal or reordering", async () => {
      await withPhotos(2);
      const ids = (await storedPhotos()).map((p) => String(p._id));
      const url = store.upload(book.id);
      await lock();

      const refusals = [
        await tokenFor(owner),
        await addPhoto(owner, url),
        await api(owner.token).delete(`${photosPath()}/${ids[0]}`),
        await api(owner.token).put(`${photosPath()}/order`).send({ order: [ids[1], ids[0]] }),
      ];
      for (const res of refusals) {
        expect(res).to.have.status(409);
        expect(res.body.message).to.match(/accepted trade/);
      }
      expect(store.tokens).to.be.empty;
      expect((await storedPhotos()).map((p) => String(p._id))).to.deep.equal(ids);
      await photoCleanupSettled();
      expect(store.deleted).to.deep.equal([url]);
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
    it("tells the owner, and only the owner, that the book is theirs and they can add photos", async () => {
      const mine = (await api(owner.token).get(`/books/${book.id}`)).body;
      expect(mine).to.include({ isOwner: true, photoUploads: true });
      expect((await api(other.token).get(`/books/${book.id}`)).body).to.include({ isOwner: false, photoUploads: false });
      expect((await api().get(`/books/${book.id}`)).body).to.include({ isOwner: false, photoUploads: false });
      expect((await api(owner.token).get("/user")).body.photoUploads).to.equal(true);
    });

    it("offers no photos without a Blob store, while the rest works and stored photos still show", async () => {
      const [url] = await withPhotos(1);
      delete process.env.BLOB_READ_WRITE_TOKEN;

      const page = await api(owner.token).get(`/books/${book.id}`);
      expect(page).to.have.status(200);
      expect(page.body).to.include({ isOwner: true, photoUploads: false });
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
    it("when its owner takes it off their shelf, uploads never attached included", async () => {
      const urls = await withPhotos(2);
      const unattached = store.upload(book.id);
      const otherBooks = store.upload((await offerBook(owner)).id);

      expect(await api(owner.token).delete(`/user/offered/${book.id}`)).to.have.status(200);

      await photoCleanupSettled();
      expect(store.deleted).to.have.members([...urls, unattached]);
      expect(store.blobs.has(otherBooks)).to.equal(true);
    });

    it("only this cluster's, leaving the same book id's blobs from another cluster in the store", async () => {
      const urls = await withPhotos(1);
      const elsewhere = store.upload(book.id, { prefix: otherClusterPrefix(book.id) });

      expect(await api(owner.token).delete(`/user/offered/${book.id}`)).to.have.status(200);

      await photoCleanupSettled();
      expect(store.deleted).to.deep.equal(urls);
      expect(store.blobs.has(elsewhere)).to.equal(true);
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

    it("when a trade completes on its own, and only that trade's", async () => {
      const [untraded] = await withPhotos(1, await offerBook(owner));
      const { id, urls } = await confirmedTrade();
      await Exchange.updateOne({ _id: id }, { $set: { autoCompletesAt: new Date(Date.now() - 1000) } });

      expect((await resolveTradeDeadlines()).completed).to.equal(1);

      await photoCleanupSettled();
      expect(store.deleted).to.have.members(urls);
      expect(store.blobs.has(untraded)).to.equal(true);
    });

    it("when its owner deletes their account, with a trade the other side had confirmed", async () => {
      const shelved = await offerBook(owner);
      const theirs = await offerBook(other);
      const urls = [...(await withPhotos(1)), ...(await withPhotos(1, shelved)), ...(await withPhotos(2, theirs))];
      const proposed = await api(owner.token)
        .post("/exchanges")
        .send({ responderId: other.id, requesterBooks: [book.id], responderBooks: [theirs.id] });
      const id = proposed.body._id;
      expect(await api(other.token).post(`/exchanges/${id}/accept`)).to.have.status(200);
      expect(await api(other.token).post(`/exchanges/${id}/confirm-complete`)).to.have.status(200);
      const [elsewhere] = await withPhotos(1, await offerBook(other));

      expect(await api(owner.token).post("/user/delete").send({ password: TEST_PASSWORD })).to.have.status(200);

      await photoCleanupSettled();
      expect(store.deleted).to.have.members(urls);
      expect(store.blobs.has(elsewhere)).to.equal(true);
    });
  });

  describe("photoNamespace", () => {
    const connection = (srvHost, name = "bookbroker") => ({
      name,
      getClient: () => ({ options: { srvHost, hosts: [] } }),
    });

    it("is stable for one cluster and database, and differs for another cluster or database", () => {
      const namespace = photoNamespace(connection("cluster0.abc.mongodb.net"));
      expect(namespace).to.match(/^[0-9a-f]{16}$/);
      expect(photoNamespace(connection("Cluster0.ABC.mongodb.net"))).to.equal(namespace);
      expect(photoNamespace(connection("cluster1.abc.mongodb.net"))).not.to.equal(namespace);
      expect(photoNamespace(connection("cluster0.abc.mongodb.net", "other"))).not.to.equal(namespace);
    });

    it("names the cluster by its members, whatever their order, when there is no SRV host", () => {
      const members = (...hosts) => ({ name: "bookbroker", getClient: () => ({ options: { hosts } }) });
      expect(photoNamespace(members("a.example:27017", "b.example:27017"))).to.equal(
        photoNamespace(members("b.example:27017", "a.example:27017"))
      );
      expect(photoNamespace(members("a.example:27017"))).not.to.equal(photoNamespace(members("c.example:27017")));
    });
  });

  describe("the daily cron", () => {
    it("deletes uploads over a day old that no book shows, and nothing else", async () => {
      const lastWeek = new Date(Date.now() - 7 * DAY);
      const [attached] = await withPhotos(1);
      store.blobs.get(attached).uploadedAt = lastWeek;
      const stale = store.upload(book.id, { uploadedAt: lastWeek });
      const ofRemovedBook = store.upload("0123456789abcdef01234567", { uploadedAt: lastWeek });
      const recent = store.upload(book.id, { uploadedAt: new Date(Date.now() - DAY / 2) });

      expect(await runCleanupCron()).to.deep.equal({ unattached: 2 });

      expect(store.deleted).to.have.members([stale, ofRemovedBook]);
      expect(store.blobs.has(attached)).to.equal(true);
      expect(store.blobs.has(recent)).to.equal(true);
    });

    it("never touches another cluster's blobs, even for a book id this database has", async () => {
      const lastWeek = new Date(Date.now() - 7 * DAY);
      const elsewhere = [
        store.upload(book.id, { prefix: otherClusterPrefix(book.id), uploadedAt: lastWeek }),
        store.upload(book.id, { prefix: `books/${book.id}/`, uploadedAt: lastWeek }),
        store.upload("0123456789abcdef01234567", {
          prefix: otherClusterPrefix("0123456789abcdef01234567"),
          uploadedAt: lastWeek,
        }),
      ];
      const stale = store.upload(book.id, { uploadedAt: lastWeek });

      expect(await runCleanupCron()).to.deep.equal({ unattached: 1 });

      expect(store.deleted).to.deep.equal([stale]);
      for (const url of elsewhere) expect(store.blobs.has(url), url).to.equal(true);
    });

    it("cleans up after every environment on this database, Preview included", async () => {
      const lastWeek = new Date(Date.now() - 7 * DAY);
      let fromPreview;
      process.env.VERCEL_ENV = "preview";
      try {
        fromPreview = store.upload(book.id, { uploadedAt: lastWeek });
      } finally {
        process.env.VERCEL_ENV = "production";
      }
      try {
        expect(await runCleanupCron()).to.deep.equal({ unattached: 1 });
      } finally {
        delete process.env.VERCEL_ENV;
      }
      expect(store.deleted).to.deep.equal([fromPreview]);
    });

    it("goes through the store a page at a time", async () => {
      const lastWeek = new Date(Date.now() - 7 * DAY);
      const stale = Array.from({ length: 1001 }, () => store.upload(book.id, { uploadedAt: lastWeek }));
      const deletions = [];
      const del = blobStore.del;
      blobStore.del = async (urls) => {
        deletions.push(urls.length);
        return del(urls);
      };

      expect(await runCleanupCron()).to.deep.equal({ unattached: stale.length });
      expect(deletions).to.deep.equal([1000, 1]);
      expect(store.blobs.size).to.equal(0);
    });
  });
});
