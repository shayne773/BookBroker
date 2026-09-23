// Mocha root hooks (loaded through .mocharc.json): every test file runs against an
// in-process MongoDB, so the suite needs no external database or credentials.
// It is started as a single-node replica set because the exchange accept and
// complete routes use multi-document transactions, which a standalone mongod rejects.
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { mail } from "../lib/mail.js";
import { http } from "../lib/http.js";
import { clearGoogleBooksCache } from "../lib/googleBooks.js";
import { notificationsSettled } from "../lib/notifications.js";

// The CORS allowlist is read when app.js is imported, which happens after this file.
process.env.CORS_ALLOWED_ORIGINS =
  process.env.CORS_ALLOWED_ORIGINS || "http://localhost:3000,https://app.example.test";

// No test may reach Resend: the key is dropped and delivery is replaced by an
// outbox that tests read the emailed links from.
delete process.env.RESEND_API_KEY;
export const outbox = [];
export const unmockedDeliver = mail.deliver;
mail.deliver = async (message) => {
  outbox.push(message);
};

// No test may reach Google Books or Open Library either: every external GET
// fails unless a test installs its own `http.get` (see mockHttp in helpers.js).
// The key is cleared before each test because app.js loads back-end/.env, which
// may hold a real one; a test that needs a key sets a fake one.
const refuseNetwork = async (url) => {
  throw new Error(`test tried to reach ${url}`);
};
http.get = refuseNetwork;

let replSet;

export const mochaHooks = {
  async beforeAll() {
    // The first run downloads a mongod binary, which can take a while.
    this.timeout(120000);
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri(), { dbName: "bookbroker-test" });
  },

  beforeEach() {
    delete process.env.GOOGLE_BOOKS_API_KEY;
  },

  async afterEach() {
    // Notifications are sent in the background; none may outlive its test.
    await notificationsSettled();
    outbox.length = 0;
    http.get = refuseNetwork;
    clearGoogleBooksCache();
    const { collections } = mongoose.connection;
    await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  },

  async afterAll() {
    await mongoose.disconnect();
    await replSet?.stop();
  },
};
