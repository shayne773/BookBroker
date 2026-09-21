import { use } from "chai";
import { default as chaiHttp, request } from "chai-http";
import app from "../app.js";
import { OfferedBook } from "../Data.js";

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

let userCount = 0;

// Registers and signs in a user through the real auth routes.
// Returns { id, username, email, token }.
export async function signUp(overrides = {}) {
  userCount += 1;
  const credentials = {
    username: `reader${userCount}`,
    email: `reader${userCount}@example.com`,
    password: "correct horse battery staple",
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
