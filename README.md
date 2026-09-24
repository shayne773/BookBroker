# BookBroker

BookBroker is a book-trading app: people list the books they own and the books they
want, find each other, and arrange a swap. The aim is to foster community and
encourage reading in an affordable, sustainable way.

The app is two independent services that share nothing but an HTTP contract:

- `front-end/` — a React single-page app built with [Vite](https://vite.dev/).
- `back-end/` — an Express API on MongoDB (Mongoose).

Both deploy to one [Vercel](https://vercel.com/) project at one address: the site
as static files and the API as a Vercel Function under `/api` (see
[Deployment](#deployment)).

What it does today: sign up with email confirmation, sign in and password reset,
browse and search books (via a server-side Google Books proxy), keep a shelf of
offered books and a wishlist, see which wishlist books other readers are offering,
propose and accept trades, message other users, rate a trading partner and see each
reader's average rating, and block or report another reader. Admins read the reports
on a private page and can suspend a reader's account.

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
| `CORS_ALLOWED_ORIGINS` | Other browser origins allowed to call the API; not needed when the site and API share an origin, as on Vercel. |
| `GOOGLE_BOOKS_API_KEY` | Server-side key for the book-search proxy and the seed. |
| `RESEND_API_KEY` | Unset means no mail is sent. |
| `EMAIL_FROM` | Sender address for outgoing mail. |
| `FRONTEND_BASE_URL` | Base URL emailed links point at; required in production. |
| `TRUST_PROXY` | Number of proxies in front of the API; optional on Vercel, where it defaults to `1`. |
| `ADMIN_EMAILS` | Comma-separated emails of the admin accounts; unset means no admins. |

There is no login-signing secret: a sign-in token is an opaque server-side session,
not a JWT.

Without `RESEND_API_KEY` the API sends no email — sign-up confirmation, password
reset and email-change links are logged to the back-end console instead, so you can
follow them locally. Without `GOOGLE_BOOKS_API_KEY`, book search reports that it is
temporarily unavailable.

**Admins.** There is no admin sign-up and no role editing. An account is an admin
when its confirmed email is listed in `ADMIN_EMAILS` (compared case-insensitively);
change the list and restart the API (on Vercel, redeploy) to add or remove one. An admin reaches the reports
page from a link on their own profile (it is at `/admin/reports` and is not in the
navigation). There they can list reports, open or reviewed, mark one reviewed, and
suspend or unsuspend the reported reader with an optional note. A suspended reader
cannot sign in and is signed out everywhere at once; their offers leave browse, search,
matches and the most-wanted list, and nobody can message them or propose a trade to
them. Trades already under way are left as they are.

**Front end.** Copy `front-end/.env.example` to `front-end/.env.local` and set
`VITE_SERVER_ADDRESS` to the API's base URL (`http://localhost:5000` locally). Vite
compiles it into the bundle at build time; production builds default to `/api` on
the site's own origin (`front-end/.env.production`), which is where Vercel serves
the API. Only `VITE_`-prefixed variables reach client code — never put a secret
behind that prefix. See [`front-end/README.md`](./front-end/README.md).

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

The front end and the API deploy together to one Vercel project, so the site and
the API share one address. `vercel.json` at the repository root describes the whole
build:

- It installs both packages and builds `front-end/` with Vite into `front-end/dist`,
  which Vercel serves as static files.
- `api/index.js` is the one Vercel Function. It re-exports `back-end/vercel.js`,
  which runs the unchanged Express app from `back-end/app.js` and reuses one
  MongoDB connection across the requests a warm instance serves.
- Every `/api/*` request goes to that function (`/api/auth/login` reaches the app's
  `/auth/login`); every other path that is not a built file falls back to
  `index.html`, so client-side routes such as `/books/:id` load on refresh.

`back-end/server.js` is still the entry for running the API locally.

### One-time setup

1. In the Vercel dashboard choose **Add New… → Project** and import this GitHub
   repository (grant the Vercel GitHub app access to it if asked).
2. Configure the project:

   | Setting | Value |
   | --- | --- |
   | Framework Preset | Other |
   | Root Directory | Leave empty: the repository root, not `front-end/`. |
   | Build Command | Leave the default; `vercel.json` sets `npm --prefix front-end run build`. |
   | Output Directory | Leave the default; `vercel.json` sets `front-end/dist`. |
   | Install Command | Leave the default; `vercel.json` installs `front-end/` and `back-end/`. |
   | Node.js Version | 22.x or newer. |

3. Under **Environment Variables**, add these for Production (and Preview, if you
   use preview deployments, which then share the same database). Mark the keys as
   sensitive. `back-end/.env.example` documents each one in full.

   | Variable | What it is for |
   | --- | --- |
   | `MONGODB_URI` | Connection string of the MongoDB Atlas cluster (`mongodb+srv://…`). The API always uses the `bookbroker` database on it. Atlas network access must allow connections from anywhere, since Vercel functions have no fixed address. |
   | `GOOGLE_BOOKS_API_KEY` | Server-side Google Books key. Without it, book search reports that it is unavailable. |
   | `RESEND_API_KEY` | Resend API key. Without it no email is sent: the links appear in the function logs instead. |
   | `EMAIL_FROM` | Sender address, e.g. `BookBroker <hello@your-domain.example>`. See the email note below. |
   | `FRONTEND_BASE_URL` | The site's Vercel address, e.g. `https://your-project.vercel.app`, with no trailing slash. Emailed links point here. |
   | `ADMIN_EMAILS` | Comma-separated confirmed emails of the admin accounts; unset means no admins. A change takes effect on the next deployment (redeploy), not a restart. |
   | `NODE_ENV` | `production`. The API then refuses to start without `FRONTEND_BASE_URL` rather than emailing links to `localhost`. |

   Do not set `VITE_SERVER_ADDRESS` or `CORS_ALLOWED_ORIGINS` on Vercel: the site
   calls `/api` on its own origin, which needs neither.
   `TRUST_PROXY` is optional too: on Vercel it defaults to `1`, since Vercel's edge
   sets `X-Forwarded-For` to the caller's address, so the per-client limits on
   password reset and resending confirmation count each visitor separately.

4. Deploy. If you do not know the production address until the first deployment
   finishes, set `FRONTEND_BASE_URL` then and redeploy: a change to environment
   variables applies only to deployments made after it.

After that, every push to `master` deploys to production, and every other branch
gets a preview deployment.

To load or refresh the demo data in the cluster, run the seed from your machine
with `MONGODB_URI` pointing at it (see [Demo data](#demo-data)).

### Things to know

- **Email.** Resend's default sender, `onboarding@resend.dev`, delivers only to the
  Resend account owner's own address. Mail to real users needs a domain verified in
  Resend and an `EMAIL_FROM` on that domain.
- **Plan.** Vercel's free Hobby plan is for personal, non-commercial use only; a
  commercial deployment needs a paid plan. The function's `maxDuration` in
  `vercel.json` (30 seconds) is within the Hobby limit.
- **Serverless.** An instance may be frozen or discarded between any two requests,
  so the API keeps nothing it needs in memory: sessions and rate limits live in
  MongoDB, the Google Books cache is only a saving, and work that finishes after the
  response (sending mail) goes through `runInBackground` in `back-end/lib/background.js`,
  which keeps the invocation alive until it settles.
