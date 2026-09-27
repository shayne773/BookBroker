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

What it does today: sign up with a US ZIP code and email confirmation, sign in and
password reset, browse and search the books within your chosen distance, nearest
first, with recommendations drawn from your wishlist and shelf (see
[Location](#location)), explore the books on a map of the country by place (see
[Map](#map)), find books to add via a server-side Google Books proxy, keep
a shelf of offered books and a wishlist, see which wishlist books other readers
nearby are offering,
propose and accept trades, message other users, rate a trading partner and see each
reader's average rating, block or report another reader, and get email about new
messages, trades and newly offered wishlist books (each category can be turned off),
and delete your account (see [Your account](#your-account)).
Admins read the reports on a private page and can suspend a reader's account.

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
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store for book photos; unset means no photos. See [Book photos](#book-photos). |

There is no login-signing secret: a sign-in token is an opaque server-side session,
not a JWT.

Without `RESEND_API_KEY` the API sends no email — sign-up confirmation and password
reset links, and notification emails, are logged to the back-end
console instead, so you can follow them locally. Without `GOOGLE_BOOKS_API_KEY`,
book search reports that it is temporarily unavailable.

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

## Your account

An account keeps the email it signed up with; it cannot be changed. To use another
address, create a new account with it.

A reader can delete their account from the bottom of their profile, with their
password and a typed confirmation. It is permanent, with no undo or grace period. It
removes the account, its offered books (from browse, search, the map and everyone's
matches), wishlist, the blocks it placed, its sessions and settings. An accepted trade
the other reader has already confirmed completes, as it would at its deadline; its
other open offers and accepted trades are cancelled, freeing the other side's books.
Either way the other reader gets an email about the trade. Completed trades, ratings
(so nobody's average moves), conversations and reports stay for the other readers and admins,
who see the reader as "Deleted reader". The address can then sign up again as a new
account.

## Location

Trades happen in person, so where a reader is decides what they see. Each reader
sets a US ZIP code (at sign-up, or later on their profile) and a distance: 5, 10,
25 (the default), 50 or 100 miles. Browse, search, genres, most wanted, the feed,
recommendations and wishlist matches then show only the books within that distance,
nearest first unless a list has its own order, each labelled with how far away it
is; a book beyond it is hidden, though a direct link to it still opens. Wishlist
emails go only to readers whose distance reaches the offer. Recommendations rank the
nearby books by the authors and genres on the reader's wishlist and shelf, then by
how many readers want them, then by distance.

Other readers see a reader's town ("Brooklyn, NY") and, for a book within their own
distance, a rounded distance to it (beyond it, only "More than 25 mi away"), never
their ZIP code or coordinates. A reader can change their ZIP code 3 times a day. An
account from before ZIP codes is asked to add one, and until then sees every book,
without distances; its own books are hidden from readers who have set a ZIP.

ZIP codes are resolved offline from `back-end/data/us-zip-codes.tsv.gz`, with no
geocoding service at runtime. It is built from the
[GeoNames](https://www.geonames.org/) postal code dump for the United States,
licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
and used here with credit to GeoNames. To regenerate it from the current dump:

```
cd back-end
npm run build:zip-codes
```

## Map

The Map page (`/map`) shows the books on the market by place, anywhere in the
country: it pans and zooms like any web map, nearby places merge into one marker
with their combined count when zoomed out, and choosing a place lists its books
with the same distance labels as everywhere else ("More than 25 mi away" beyond
the reader's distance). It opens on the reader's own ZIP point with their distance
drawn around it (the point their distances are measured from, sent only to them),
or on the whole country for a reader without a ZIP code. Places so close that they
stay merged at the deepest zoom are listed under their marker to choose from.

A book is counted under its owner's town ("Brooklyn, NY"), which every book page
already shows, and drawn at that town's point: the average of the town's ZIP code
points in the table above, never the owner's own ZIP or position. The map's API
(`back-end/routes/map.js`) returns only place names, those points, book counts and
the genres on the market, plus the caller's own point; a search's nearest places
carry only the distance labels their books already have.

A search bar over the map finds books by keyword (title, author, publisher or
ISBN) and filters: genre (from the genres on the market), author, publication
years, how recently a book was listed, and only the reader's wishlist matches.
The terms combine, and the search is kept in the page's address, so it survives a
reload and can be shared. While a search is on, the markers count only the
matching books, the side panel lists the matching places nearest the reader first
(with the same distance labels), and each new search moves the map to fit the
reader's point and the nearest matches, zooming out as far as it takes (for a
reader without a ZIP code, "nearest" is measured from the middle of their view).
Every map endpoint narrows the market with the one filter in
`back-end/lib/mapSearch.js`, so the counts, the panel and the nearest places
always agree.

The map is drawn with [MapLibre GL JS](https://maplibre.org/) (BSD-3-Clause) on
[OpenFreeMap](https://openfreemap.org/)'s "positron" style, a free public tile
service that needs no account or API key and sets no limit on map views. Its
[terms](https://openfreemap.org/tos/) require attribution, which the map shows in
its corner: OpenFreeMap, © OpenMapTiles, data from © OpenStreetMap contributors.
The service comes with no warranty and may change; the style URL is
`MAP_STYLE_URL` in `front-end/src/bookMap.js`.

Books offered before the map existed have no place yet. After deploying it, place
them once, with `MONGODB_URI` pointing at the database (it is safe to rerun, and is
needed again only if the ZIP code table is rebuilt):

```
cd back-end
npm run place-books
```

## Book photos

An owner can add up to four photos of their copy of an offered book, when they offer
it or later from the book's page, where they can also remove them and put them in
order (the first is the main one). The book's page shows them in a gallery below
the catalogue cover, which stays the book's image everywhere; lists and the map
only say how many photos a book has. Anyone who objects to a book's photos reports
its owner through the usual report, which names the book.

The photos live in a [Vercel Blob](https://vercel.com/docs/vercel-blob) store, and
their bytes never pass through the API. The browser shrinks each photo to at most
1600 px on its long edge and re-encodes it as a JPEG well under 2 MB, which also
drops its EXIF metadata (such as where it was taken); it then asks the API for a
client token that allows exactly one upload, of that type and size, to a path under
that book, and sends the photo straight to Blob. The API checks the upload against
the store before it keeps its URL. The store holds only JPEG, PNG and WebP images
of at most 2 MB, and only the book's owner can add or remove its photos.

A book's photos are deleted from the store with the book, however it leaves (its
owner removes it, or a trade completes), and a photo with its removal, after the
response so it never holds up what the reader was doing. A daily cron job
(`/api/cron/photo-cleanup`) deletes every blob more than a day old that no book
shows, which covers a deletion that failed and uploads never added to their book.
Blobs live under a namespace named after the environment and database
(`production-bookbroker/books/<id>/...`), and deletions and the daily job only
ever touch their own namespace. An owner gets at most 12 upload
tokens an hour, and while an accepted trade holds a book its photos cannot change.

Without `BLOB_READ_WRITE_TOKEN`, nothing offers photos and everything else works as
before. To turn them on:

1. In the Vercel project, open **Storage → Create Database → Blob**, name the store
   and give it **public** access (the photos are shown by their URLs).
2. Connect it to the project for the environments that should have photos
   (Production, and Preview if you like). Vercel then adds `BLOB_READ_WRITE_TOKEN`
   to those environments itself; redeploy for it to take effect.
3. To have photos locally, create a **separate** Blob store for development and put
   its token in `back-end/.env`. Never copy the production token (nor `vercel env
   pull` it) into a local `.env`: local runs would then write to, and could delete
   from, the production store.

## Demo data

The seed needs `MONGODB_URI` and `GOOGLE_BOOKS_API_KEY` in `back-end/.env`.

```
cd back-end
npm run seed     # replaces the seed_user_* demo users and their 100 books
```

The ten demo readers live at real ZIP codes in four metro areas (New York, Chicago,
Champaign-Urbana and the San Francisco Bay Area), so readers in the same area see
each other's books with distances and readers elsewhere do not.

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
   | `CRON_SECRET` | A random string of at least 16 characters (e.g. `openssl rand -hex 32`). Vercel sends it with the daily cron jobs in `vercel.json`, which expire unanswered trade offers, complete trades one side has confirmed and delete photo blobs no book shows; without it the jobs are refused. |
   | `BLOB_READ_WRITE_TOKEN` | Added by Vercel when a Blob store is connected to the project; see [Book photos](#book-photos). Without it there are no photos. |

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
After the first deployment of the map, run `npm run place-books` the same way (see
[Map](#map)).

### Things to know

- **Email.** Resend's default sender, `onboarding@resend.dev`, delivers only to the
  Resend account owner's own address. Mail to real users needs a domain verified in
  Resend and an `EMAIL_FROM` on that domain.
- **Plan.** Vercel's free Hobby plan is for personal, non-commercial use only; a
  commercial deployment needs a paid plan. The function's `maxDuration` in
  `vercel.json` (30 seconds) and its two daily cron jobs are within the Hobby limits,
  as is a Blob store for photos of this size.
- **Trade deadlines.** An offer nobody answers expires 14 days after the proposal or
  the latest counter, and an accepted trade that one side has confirmed completes by
  itself 7 days after that confirmation. The daily cron job
  (`/api/cron/trade-deadlines`, 04:00 UTC; on Hobby it may run any time in that hour)
  applies both, and the API also applies them to any trade a reader opens or lists,
  so nobody sees a trade past its deadline between runs.
- **Serverless.** An instance may be frozen or discarded between any two requests,
  so the API keeps nothing it needs in memory: sessions and rate limits live in
  MongoDB, the Google Books cache is only a saving, and work that finishes after the
  response (sending mail) goes through `runInBackground` in `back-end/lib/background.js`,
  which keeps the invocation alive until it settles.
