import { use } from "chai";
import { default as chaiHttp, request } from "chai-http";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import app from "../app.js";
import { OfferedBook, User } from "../Data.js";
import { outbox } from "./setup.js";
import { http } from "../lib/http.js";
import { createSession } from "../lib/sessions.js";
import { normalizeEmail } from "../lib/validation.js";

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

export { outbox };

// The token in the most recent link emailed to `email`, optionally only from
// messages whose link goes to `path` (e.g. "/reset-password").
export function emailedToken(email, path = "") {
  const message = outbox.findLast(
    (m) => m.to === email && new URL(m.link).pathname.startsWith(path)
  );
  if (!message) throw new Error(`no email with a ${path || "link"} was sent to ${email}`);
  return new URL(message.link).searchParams.get("token");
}

// Confirms `email` through the real route, with the link it was sent.
export async function confirmEmail(email) {
  const res = await api()
    .post("/auth/confirm-email")
    .send({ token: emailedToken(email, "/confirm-email") });
  if (res.status !== 200) throw new Error(`confirm-email failed: ${res.status}`);
}

// Registers, confirms and signs in a user through the real auth routes.
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
  await confirmEmail(credentials.email);

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

// Stores the email normalized, as every route does.
export async function createUser(overrides = {}) {
  const { password = TEST_PASSWORD, ...rest } = overrides;
  const suffix = new mongoose.Types.ObjectId().toString();

  return User.create({
    username: `user_${suffix.slice(-6)}`,
    password: await bcrypt.hash(password, 10),
    location: "Brooklyn",
    ...rest,
    email: normalizeEmail(rest.email ?? `user_${suffix}@example.com`),
  });
}

// Starts a session for a directly created user, as signing in would.
export async function authHeader(user) {
  return { Authorization: `Bearer ${await createSession(user._id)}` };
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

// Answers every external GET (Google Books, Open Library) with
// `handler(url, params)`, whose return value is the response body; throw
// httpFailure(...) from it for an error response. Returns the list of calls.
// test/setup.js restores the refusing default after each test.
export function mockHttp(handler) {
  const calls = [];
  http.get = async (url, config = {}) => {
    const params = config.params || {};
    calls.push({ url, params });
    return { data: await handler(url, params) };
  };
  return calls;
}

// An error shaped like the HTTP client's for a response with `status`.
export function httpFailure(status, message = `HTTP ${status}`) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data: { error: { code: status, message } } };
  return err;
}

// A Google Books volume with an ISBN-13 and, unless `thumbnail` is null, an
// http:// thumbnail as Google returns them.
export function googleVolume(id, { isbn, title = `Book ${id}`, thumbnail = `http://books.google.com/books/content?id=${id}&img=1` } = {}) {
  return {
    id,
    volumeInfo: {
      title,
      authors: ["An Author"],
      publisher: "A Publisher",
      publishedDate: "2001-02-03",
      industryIdentifiers: isbn ? [{ type: "ISBN_13", identifier: isbn }] : [],
      categories: ["Fiction"],
      description: "A description.",
      ...(thumbnail ? { imageLinks: { thumbnail, smallThumbnail: thumbnail } } : {}),
    },
  };
}
