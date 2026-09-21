// Mocha root hooks (loaded through .mocharc.json): every test file runs against an
// in-process MongoDB, so the suite needs no external database or credentials.
// It is started as a single-node replica set because the exchange accept and
// complete routes use multi-document transactions, which a standalone mongod rejects.
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

// app.js reads the secret at request time; set it before any token is signed.
process.env.JWT_SECRET = "bookbroker-test-secret";

let replSet;

export const mochaHooks = {
  async beforeAll() {
    // The first run downloads a mongod binary, which can take a while.
    this.timeout(120000);
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri(), { dbName: "bookbroker-test" });
  },

  async afterEach() {
    const { collections } = mongoose.connection;
    await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  },

  async afterAll() {
    await mongoose.disconnect();
    await replSet?.stop();
  },
};
