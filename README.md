# BookBroker

BookBroker is a book-trading app: people list the books they own and the books they
want, find each other, and arrange a swap. The aim is to foster community and
encourage reading in an affordable, sustainable way.

The app is two independent services that share nothing but an HTTP contract:

- `front-end/` — a React single-page app built with [Vite](https://vite.dev/).
- `back-end/` — an Express API on MongoDB (Mongoose).

What it does today: sign up with email confirmation, sign in and password reset,
browse and search books (via a server-side Google Books proxy), keep a shelf of
offered books and a wishlist, see which wishlist books other readers are offering,
propose and accept trades, message other users, rate a trading partner and see each
reader's average rating, and block or report another reader.

[Contributing Guidelines](./CONTRIBUTING.md) · [Agent and architecture notes](./AGENTS.md)

## Team Members

BookBroker began as a final project for an Agile Software Development course at NYU,
built by:

- [Isaac](https://github.com/isaac1000000)
- [Sewon](https://github.com/SewonKim0)
- [Rainn](https://github.com/Rainn-J)
- [Shayne](https://github.com/shayne773)
- [Stephen](https://github.com/StephenS2021)

## Prerequisites

- Node.js 20 or newer, and npm.
- A MongoDB database (Atlas or local) for running the API.
- Optional but recommended: a Google Books API key, for book search and the seed.

Neither package commits a lockfile, so installs are `npm install`.

## Configuration

Both services are configured through environment files, and neither file is
committed.

**Back end.** Copy the example and fill it in:

```
cp back-end/.env.example back-end/.env
```

`back-end/.env.example` is the authoritative list; it documents every variable,
its default and when it is required. The variables it reads, by name:

| Variable | Notes |
| --- | --- |
| `MONGODB_URI` | Required. |
| `PORT` | Optional; the API's listening port. |
| `CORS_ALLOWED_ORIGINS` | Browser origins allowed to call the API; required in production. |
| `GOOGLE_BOOKS_API_KEY` | Server-side key for the book-search proxy and the seed. |
| `RESEND_API_KEY` | Unset means no mail is sent. |
| `EMAIL_FROM` | Sender address for outgoing mail. |
| `FRONTEND_BASE_URL` | Base URL emailed links point at; required in production. |
| `TRUST_PROXY` | Number of proxies in front of the API. |

There is no login-signing secret: a sign-in token is an opaque server-side session,
not a JWT.

Without `RESEND_API_KEY` the API sends no email — sign-up confirmation, password
reset and email-change links are logged to the back-end console instead, so you can
follow them locally. Without `GOOGLE_BOOKS_API_KEY`, book search reports that it is
temporarily unavailable.

**Front end.** Copy `front-end/.env.example` to `front-end/.env.local` and set
`VITE_SERVER_ADDRESS` to the API's base URL (`http://localhost:5000` locally). Vite
compiles it into the bundle at build time, so every environment needs its own build
with its own value, and only `VITE_`-prefixed variables reach client code — never
put a secret behind that prefix. See [`front-end/README.md`](./front-end/README.md).

## Running it

Back end:

```
cd back-end
npm install
npm start        # or: npm run dev, with nodemon
```

Front end, in a second terminal:

```
cd front-end
npm install
npm run dev      # npm run build / npm run preview for the production bundle
```

## Demo data

The seed needs `MONGODB_URI` and `GOOGLE_BOOKS_API_KEY` in `back-end/.env`.

```
cd back-end
npm run seed     # replaces the seed_user_* demo users and their 100 books
```

It fetches every book, cover included, before deleting the previous seed, so a
Google failure leaves the existing data in place. Covers are stored as https; a book
Google has no image for falls back to Open Library's cover where one exists.

## Tests

The checks every pull request must pass are pinned in `.no-mistakes.yaml` and run by
the `CI` workflow. From the repository root:

```
npm --prefix front-end install && npm --prefix back-end install
npm --prefix front-end run lint     # ESLint
npm --prefix front-end run build    # Vite production build
npm --prefix front-end test         # Vitest
npm --prefix back-end test          # Mocha, against an in-process MongoDB
```

The back-end tests need no database of their own, and no test reaches the network.

## Deployment

The front end deploys to Vercel and the back end to AWS. Each is deployed
separately, with its own environment variables.
