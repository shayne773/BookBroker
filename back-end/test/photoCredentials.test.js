// How the photo store's two forms of credentials reach Vercel Blob: the real
// SDK (`vercelBlob`), pointed at a local stand-in for the Blob API, so what is
// checked is what the SDK sends for each.
import http from "node:http";
import { expect } from "chai";
import { uploadPresigned } from "@vercel/blob/client";
import app from "../app.js";
import { api, offerBook, signUp } from "./helpers.js";
import {
  blobStore,
  deleteUnattachedBlobs,
  discardBookBlobs,
  MAX_PHOTO_BYTES,
  photoCleanupSettled,
  photoPrefix,
  photosEnabled,
  vercelBlob,
} from "../lib/photos.js";

const DAY = 24 * 60 * 60 * 1000;
const STORE = "teststore";
const READ_WRITE_TOKEN = `vercel_blob_rw_${STORE}_secret`;

const blobAt = (pathname, uploadedAt = new Date()) => ({
  url: `https://${STORE}.public.blob.vercel-storage.com/${pathname}`,
  pathname,
  contentType: "image/jpeg",
  size: 250_000,
  uploadedAt: uploadedAt.toISOString(),
});

const base64url = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

// An unsigned JWT that expires in an hour, as VERCEL_OIDC_TOKEN holds on a deployment.
const oidcToken = () =>
  `${base64url({ alg: "none" })}.${base64url({ sub: "test", exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`;

// A stand-in for the Blob API: records each request and answers from `blobs`.
async function startBlobApi() {
  const fake = { requests: [], blobs: [] };
  const answers = {
    "POST /signed-token": (body) => ({
      delegationToken: `${base64url({ ...body, storeId: STORE })}.signature`,
      clientSigningToken: "signing-secret",
      validUntil: body.validUntil,
    }),
    "POST /delete": () => ({}),
    "PUT /": (body, query) => blobAt(query.get("pathname")),
    "GET /": (body, query) =>
      query.has("url") ? fake.blobs.find((blob) => blob.url === query.get("url")) : { blobs: fake.blobs, hasMore: false },
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const url = new URL(req.url, "http://blob.test");
      const body = raw && req.method === "POST" ? JSON.parse(raw) : undefined;
      fake.requests.push({
        call: `${req.method} ${url.pathname}`,
        query: Object.fromEntries(url.searchParams),
        authorization: req.headers.authorization,
        storeId: req.headers["x-vercel-blob-store-id"],
        body,
      });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(answers[`${req.method} ${url.pathname}`](body, url.searchParams) ?? {}));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  fake.close = () => new Promise((resolve) => server.close(resolve));
  return fake;
}

const ENV = ["VERCEL_BLOB_API_URL", "VERCEL_OIDC_TOKEN", "BLOB_STORE_ID", "BLOB_READ_WRITE_TOKEN", "BLOB_WEBHOOK_PUBLIC_KEY"];

describe("photo store credentials", () => {
  let fake;
  let owner;
  let book;
  let before;

  beforeEach(async () => {
    before = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
    for (const name of ENV) delete process.env[name];
    fake = await startBlobApi();
    process.env.VERCEL_BLOB_API_URL = fake.url;
    Object.assign(blobStore, vercelBlob);
    owner = await signUp();
    book = await offerBook(owner);
  });

  afterEach(async () => {
    await photoCleanupSettled();
    await fake.close();
    for (const name of ENV) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  });

  const uploadToken = () =>
    api(owner.token).post(`/user/offered/${book.id}/photos/upload-token`).send({ contentType: "image/jpeg", size: 300_000 });

  it("turns photos on for a connected store or a read-write token, and off without either", async () => {
    expect(photosEnabled()).to.equal(false);
    expect((await api(owner.token).get("/user")).body.photoUploads).to.equal(false);

    process.env.BLOB_STORE_ID = `store_${STORE}`;
    expect(photosEnabled()).to.equal(true);
    expect((await api(owner.token).get("/user")).body.photoUploads).to.equal(true);

    delete process.env.BLOB_STORE_ID;
    process.env.BLOB_READ_WRITE_TOKEN = READ_WRITE_TOKEN;
    expect(photosEnabled()).to.equal(true);
  });

  describe("a store connected to the Vercel project (OIDC)", () => {
    let token;

    beforeEach(() => {
      token = oidcToken();
      process.env.VERCEL_OIDC_TOKEN = token;
      process.env.BLOB_STORE_ID = `store_${STORE}`;
    });

    const expectOidc = (request) => {
      expect(request.authorization).to.equal(`Bearer ${token}`);
      expect(request.storeId).to.equal(STORE);
    };

    it("issues a presigned upload for one blob, without the read-write token or the webhook key", async () => {
      const res = await uploadToken();

      expect(res).to.have.status(200);
      expect(res.body).to.not.have.property("token");
      expect(res.body.pathname).to.match(new RegExp(`^${photoPrefix(book.id)}[0-9a-f]{32}\\.jpg$`));
      expect(res.body.presigned.delegationToken).to.be.a("string");
      expect(res.body.presigned.signature).to.be.a("string");
      // The upload is refused if it overwrites or lands at another pathname.
      expect(res.body.presigned.params).to.include({
        "vercel-blob-add-random-suffix": "false",
        "vercel-blob-allow-overwrite": "false",
      });
      // The key that signs upload URLs stays on the server.
      expect(JSON.stringify(res.body)).to.not.include("signing-secret");

      const [request] = fake.requests;
      expect(request.call).to.equal("POST /signed-token");
      expectOidc(request);
      expect(request.body).to.deep.include({
        pathname: res.body.pathname,
        operations: ["put"],
        allowedContentTypes: ["image/jpeg"],
        maximumSizeInBytes: MAX_PHOTO_BYTES,
      });
      expect(request.body.validUntil).to.be.above(Date.now());
    });

    it("issues a presigned upload the SDK's uploadPresigned uploads with, as the browser does", async () => {
      const { presigned, pathname } = (await uploadToken()).body;
      const server = app.listen(0, "127.0.0.1");
      await new Promise((resolve) => server.once("listening", resolve));
      // The browser has neither of the server's credentials.
      delete process.env.VERCEL_OIDC_TOKEN;
      delete process.env.BLOB_STORE_ID;

      let uploaded;
      try {
        uploaded = await uploadPresigned(pathname, Buffer.from("photo"), {
          access: "public",
          contentType: "image/jpeg",
          handleUploadUrl: `http://127.0.0.1:${server.address().port}/user/offered/${book.id}/photos/presigned-upload`,
          clientPayload: JSON.stringify(presigned),
          headers: { Authorization: `Bearer ${owner.token}` },
        });
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }

      expect(uploaded.url).to.equal(blobAt(pathname).url);
      const request = fake.requests.at(-1);
      expect(request.call).to.equal("PUT /");
      expect(request.authorization).to.equal(undefined);
      expect(request.storeId).to.equal(STORE);
      expect(request.query).to.include({
        pathname,
        "vercel-blob-delegation": presigned.delegationToken,
        "vercel-blob-signature": presigned.signature,
      });
    });

    it("checks an upload against the store and keeps it", async () => {
      const blob = blobAt(`${photoPrefix(book.id)}a.jpg`);
      fake.blobs.push(blob);

      const res = await api(owner.token)
        .post(`/user/offered/${book.id}/photos`)
        .send({ url: blob.url, width: 1200, height: 1600 });

      expect(res).to.have.status(201);
      expect(res.body.photos.map((p) => p.url)).to.deep.equal([blob.url]);
      const [request] = fake.requests;
      expect(request.call).to.equal("GET /");
      expectOidc(request);
    });

    it("deletes a book's blobs", async () => {
      const blob = blobAt(`${photoPrefix(book.id)}a.jpg`);
      fake.blobs.push(blob);

      discardBookBlobs([book.id]);
      await photoCleanupSettled();

      expect(fake.requests.map((r) => r.call)).to.deep.equal(["GET /", "POST /delete"]);
      fake.requests.forEach(expectOidc);
      expect(fake.requests[1].body).to.deep.equal({ urls: [blob.url] });
    });

    it("deletes unattached blobs for the daily cron", async () => {
      const blob = blobAt(`${photoPrefix(book.id)}a.jpg`, new Date(Date.now() - 2 * DAY));
      fake.blobs.push(blob);

      expect(await deleteUnattachedBlobs()).to.equal(1);

      expect(fake.requests.map((r) => r.call)).to.deep.equal(["GET /", "POST /delete"]);
      fake.requests.forEach(expectOidc);
      expect(fake.requests[1].body).to.deep.equal({ urls: [blob.url] });
    });

    it("answers 503 when the deployment has no OIDC token", async () => {
      delete process.env.VERCEL_OIDC_TOKEN;

      const res = await uploadToken();

      expect(res).to.have.status(503);
      expect(res.body.code).to.equal("PHOTOS_UNAVAILABLE");
      expect(fake.requests).to.be.empty;
    });
  });

  describe("a read-write token alone", () => {
    beforeEach(() => {
      process.env.BLOB_READ_WRITE_TOKEN = READ_WRITE_TOKEN;
    });

    it("issues a client token signed with it, asking the store nothing", async () => {
      const res = await uploadToken();

      expect(res).to.have.status(200);
      expect(res.body).to.not.have.property("presigned");
      expect(res.body.token).to.match(new RegExp(`^vercel_blob_client_${STORE}_`));
      expect(fake.requests).to.be.empty;
    });

    it("deletes a book's blobs with it", async () => {
      const blob = blobAt(`${photoPrefix(book.id)}a.jpg`);
      fake.blobs.push(blob);

      discardBookBlobs([book.id]);
      await photoCleanupSettled();

      expect(fake.requests.map((r) => r.call)).to.deep.equal(["GET /", "POST /delete"]);
      for (const request of fake.requests) expect(request.authorization).to.equal(`Bearer ${READ_WRITE_TOKEN}`);
    });
  });
});
