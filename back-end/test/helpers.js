import { use } from "chai";
import { default as chaiHttp, request } from "chai-http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../app.js";
import { OfferedBook, User } from "../Data.js";

use(chaiHttp);

// A fresh request against the app, optionally carrying a bearer token.
export function api(token) {
  const agent = request.execute(app);
  if (!token) return agent;
  const withAuth = (method) => (path) => agent[method](path).set("Authorization", `Bearer ${token}`);
  return {
    get: withAuth("get"),
    post: withAuth("post"),
    delete: withAuth("delete"),
  };
}

// Satisfies the register route's password rules.
export const TEST_PASSWORD = "Str0ngPassw0rd";

let userCount = 0;

// Registers and signs in a user through the real auth routes.
// Returns { id, username, email, token }.
export async function signUp(overrides = {}) {
  userCount += 1;
  const credentials = {
    username: `reader${userCount}`,
    email: `reader${userCount}@example.com`,
    password: TEST_PASSWORD,
    location: "Brooklyn",
    ...overrides,
  };

  const registered = await api().post("/auth/register").send(credentials);
  if (registered.status !== 201) throw new Error(`register failed: ${registered.status}`);

  const login = await api()
    .post("/auth/login")
    .send({ email: credentials.email, password: credentials.password });
  if (login.status !== 200) throw new Error(`login failed: ${login.status}`);

  return {
    id: String(login.body.user.id),
    username: credentials.username,
    email: credentials.email,
    token: login.body.token,
  };
}

// Inserts an offered book owned by `owner` directly, so tests get real document ids.
export async function offerBook(owner, fields = {}) {
  return OfferedBook.create({
    owner: owner.id,
    title: "The Hobbit",
    author: "J. R. R. Tolkien",
    publisher: "Allen & Unwin",
    isbn: "9780261102217",
    genre: "Adventure",
    ...fields,
  });
}

// The fixtures below write straight to the database, for tests that need a
// user or book in a state the public routes would not produce.

export async function clearDatabase() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export async function createUser(overrides = {}) {
  const { password = TEST_PASSWORD, ...rest } = overrides;
  const suffix = new mongoose.Types.ObjectId().toString();

  return User.create({
    username: `user_${suffix.slice(-6)}`,
    email: `user_${suffix}@example.com`,
    password: await bcrypt.hash(password, 10),
    location: "Brooklyn",
    ratings: 5,
    ...rest,
  });
}

export function tokenFor(user) {
  return jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

export function authHeader(user) {
  return { Authorization: `Bearer ${tokenFor(user)}` };
}

export async function createOfferedBook(owner, overrides = {}) {
  return OfferedBook.create({
    owner: owner._id,
    title: "The Hobbit",
    author: "J.R.R. Tolkien",
    publisher: "Allen & Unwin",
    year: "1937",
    isbn: "9780261103344",
    genre: "Adventure",
    desc: "There and back again.",
    ...overrides,
  });
}
