# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Front-end auth

- Every authenticated request goes through `authFetch` in `front-end/src/auth.js`, which
  attaches the bearer token and turns a 401 into one shared "session expired" policy.
  Do not hand-roll `Authorization` headers or read `localStorage.token` in a page.
- Pages that need a signed-in user live under the `RequireAuth` layout route in
  `front-end/src/AppContent.jsx`; `front-end/src/RequireAuth.jsx` redirects to `/login` and
  passes the intended destination in the navigation state, which `Login.jsx` reads.
- In a `catch`, ignore the error when `isSessionExpiredError(err)` is true: the redirect is
  already in flight, so showing a page-level error would flash.

## Front-end design system

- `front-end/src/styles/` is the single source of truth for the interface:
  `tokens.css` (colour, type, spacing, border, motion custom properties), `base.css`
  (element defaults) and `components.css` (shared classes). Screens compose those
  classes; they do not hardcode colours, sizes or durations. `tailwind.config.js`
  projects the same tokens through `var()`, so a utility and a rule cannot drift.
- `src/index.css` is an ordered manifest, and the order is load-bearing: CSS requires
  imports before other rules, so `base.css` and `components.css` each open with the
  Tailwind directive that belongs in front of them. Putting `@tailwind` back in
  `index.css` between imports silently drops those files from the bundle.
- Every screen is on the system; there are no per-page stylesheets. Do not add one: a
  need the system does not meet is a new class in `components.css`, so every screen
  gains it. For one-off spacing, use a Tailwind utility (`mt-4`), which reads the tokens.
- `.cover` is a CSS size container, which is how the missing-cover label decides from the
  frame's own width whether it fits. A size container takes no width from its content, so
  every `.cover` needs one from its layout (grid track, stretched flex item or width), or
  it collapses to nothing.
- Dialogs use `.dialog-overlay` / `.dialog-content`, the names reactjs-popup generates
  from `<Popup className="dialog">`, so hand-built modals and Popup share one style.
- `.page` runs its entry animation with fill-mode `backwards`, not `both`: a transform
  left in effect makes the page the containing block for its `position: fixed` children
  (dialog overlays).
- No pop-ups: no `alert()`/`confirm()` (`src/setupTests.js` makes them throw in every test) and no toasts.
  An action's outcome is a `<Feedback>` line (`src/Feedback.jsx`, state from
  `useFeedback`) beside the control, or a `DoneButton` that turns into its checked state
  ("On your wishlist"). Dialogs stay only for collecting input.
- Another reader's name is always `UserLink` (`src/UserLink.jsx`), which links to their
  profile (yours to `/profile`) and falls back to plain text. Inside a row that is itself a
  link, use `.has-stretch` / `.stretch-link` (`components.css`) so the links don't nest.
- Motion is tokenised (`--duration-fast|base|slow`, `--ease-out|standard`) and
  `tokens.css` collapses those durations under `prefers-reduced-motion: reduce`, so a
  component honours the preference by using the tokens rather than by opting in.

## Back end

- Two independent services, `front-end/` (React, Vite) and `back-end/` (Express + Mongoose),
  sharing nothing but the HTTP contract. Both deploy to one Vercel project on one origin; the
  README's "Deployment" section owns the setup facts.
- Configuration is environment-driven. `back-end/.env.example` is the authoritative
  list of variables and their defaults; `back-end/.env` is gitignored.
- Security helpers used by `app.js` live in `back-end/lib/`: the CORS allowlist,
  the MongoDB-backed throttle (`loginThrottle.js`; a `scope` gives an endpoint its own
  counters, as the resend-confirmation and forgot-password limits do), and the input
  validation / regex-escaping helpers. Any user input that reaches a Mongo `$regex` must go through
  `safeRegex` from `lib/validation.js`.
- Client responses never carry `err.message` or a stack trace for an unexpected failure.
  Route handlers log in full with `console.error` and hand unexpected failures to the
  generic error handler at the bottom of `app.js` via `next(err)`. Express 4 does not
  forward rejections automatically, so every `await` in a handler needs a `try`/`catch`.

## Google Books and covers

- The browser never calls Google Books. The API proxies it (`/google-books/*` in `app.js`:
  signed-in only, per-user `LoginThrottle`) through `back-end/lib/googleBooks.js`, the one
  client, which sends the server-side `GOOGLE_BOOKS_API_KEY` and caches responses briefly.
  Keyless calls share Google's global quota (often zero), so a missing key or any Google
  refusal raises `GoogleBooksUnavailableError`, answered 503 `BOOK_SEARCH_UNAVAILABLE`.
- Stored covers go through `back-end/lib/covers.js`: always https; when Google has no image,
  Open Library's stable `/b/id/<cover_id>-M.jpg` (never `/b/isbn/`, which is rate limited).
- `seed.js` (`npm run seed`, see the README) fetches everything before it deletes and
  refuses to start without the key; `seed()` is exported so tests run it in-process.
- Tests never reach the network: `test/setup.js` makes `http.get` (`lib/http.js`) throw,
  and `mockHttp` in `test/helpers.js` answers it for one test.

## Account emails

- Every stored or queried address goes through `normalizeEmail` (`back-end/lib/validation.js`)
  and is looked up exactly, on the plain `email_1` index. `email_case_insensitive` (strength-2
  collation, `Data.js`) makes Mongo reject case variants; queries never use it. A duplicate
  surfaces as error 11000, which the routes answer as "User already exists" / "Email already in use".

## Sign-in sessions

- A sign-in token is opaque, not a JWT: `back-end/lib/sessions.js` stores its SHA-256 hash as a
  `Session` with a 30-day sliding expiry (touched at most hourly) and a TTL index. `authMiddleware`
  in `app.js` looks the session up on every request, so deleting it ends the sign-in: `/logout`
  ends one, a password reset ends all of the account's. There is no `JWT_SECRET`.

## Vercel deployment

- Root `vercel.json` builds `front-end/` into `front-end/dist` and rewrites `/api/*` to the one
  function, `api/index.js`, which re-exports `back-end/vercel.js`: the unchanged `app.js`
  mounted under `/api`. `server.js` is the local entry; both connect through `connectDatabase`
  in `back-end/lib/db.js` (one cached connection promise).
- An instance can be frozen between any two requests: keep nothing needed in memory, and send
  any work that outlives the response (mail, notifications) through `runInBackground` in
  `back-end/lib/background.js`, which hands it to Vercel's `waitUntil`.

## Email, confirmation and password reset

- All mail goes through `mail` in `back-end/lib/mail.js` (Resend SDK). Without
  `RESEND_API_KEY` nothing is sent and the recipient, subject and link are logged instead.
  `EMAIL_FROM` defaults to Resend's test sender `onboarding@resend.dev`, which only
  delivers to the Resend account owner: mail to real users needs a domain verified in
  Resend and an `EMAIL_FROM` on it. Links are built from `FRONTEND_BASE_URL` (required in
  production), never the request's Host. See `back-end/.env.example`.
- Emailed-link tokens live in `back-end/lib/authTokens.js`: stored as a SHA-256 hash,
  single-use, expiring (confirm 24 h, reset 1 h, email change 24 h).
- A profile email change is held in `User.pendingEmail`; `email` stays in effect for sign-in
  and reset until `/auth/confirm-email-change` switches it and revokes reset links.
- `User.emailVerified` defaults to `true` so accounts from before confirmation count as
  confirmed with no backfill; sign-up stores `false` and login refuses only an explicit
  `false`. Keep both halves if you touch it.
- Tests never reach Resend: `back-end/test/setup.js` replaces `mail.deliver` with an
  `outbox`; `emailedToken` / `confirmEmail` in `test/helpers.js` read links from it, and
  `signUp` confirms through the real route.

## Notification emails

- `back-end/lib/notifications.js` owns them: `notifyNewMessage`, `notifyTrade` and
  `notifyWishlistMatch` are called from the route that causes the event, after its write (after
  commit in a transaction), and never awaited: `notifyInBackground` hands each event's sends to
  `runInBackground` (Vercel's `waitUntil`), which logs a failure; a new offer's wishlist emails
  go one at a time, paced and capped by `wishlistPacing` to fit Resend's rate limit. Its
  `recipientFor` is the one eligibility check (not self, confirmed address, not suspended,
  category on in `User.notifications`, no block).
- `notificationsSettled()` resolves when every started send is done. `test/setup.js` awaits it
  after each test; tests await it before reading the `outbox`.
- One message email per conversation until read: `Conversation.notifiedAt[recipient]` holds the
  emailed message's time and is claimed atomically only once `readAt` has reached it and the
  recipient's `seenAt` (wall-clock time of their last `/read`) is over 15 minutes old.
- A wishlist email is claimed per reader and ISBN in `WishlistNotice` (30-day TTL), so re-listing
  does not repeat it; proposals and counters share a per-reader `trade-proposal` throttle. A
  failed send gives its claim back.
- Unsubscribe links are `userId.category.HMAC` under a per-user `User.notificationKey`
  (`select: false`), with no expiry and no sign-in; `POST /notifications/unsubscribe` and the
  front end's `/unsubscribe` page. Wishlist matching for both directions is `lib/matches.js`.

## Back-end trades

- A route in `back-end/routes/exchanges.js` that opens a transaction signals every early
  exit by throwing `httpError(status, message)`, never `return res.status(...)`, so the
  shared `catch` aborts the transaction and `finally` ends the session.
- An ACCEPTED exchange holds its books via `locked` / `lockedByExchange`; anything that lists
  books as available to trade must filter `locked: false`.
- Trade deadlines (`back-end/lib/tradeDeadlines.js`): an unanswered offer expires at `expiresAt`
  (14 days from the latest proposal or counter), and a one-side-confirmed trade completes at
  `autoCompletesAt` (7 days from the first confirmation). Nothing fires at the deadline: the daily
  Vercel Cron (`/cron/trade-deadlines`, `CRON_SECRET`) sweeps, and every exchange route calls
  `resolveTradeDeadlines` for the trades it reads or acts on first. `Exchange` uses
  `optimisticConcurrency`, so a direct update to a trade must `$inc` `__v` or stale saves win.
  A trade a deadline closed records `deadlineDays`; the front end reads day counts from it and
  never hard-codes them.

## Messaging

- The API runs as a Vercel function, so live delivery is short polling, never a
  WebSocket/SSE server: poll through `front-end/src/usePolling.js` (pauses while the tab is
  hidden). An open thread asks `GET /messages/:user?after=<newest fetched id>` for new
  messages only; a message it sent is shown but never moves that cursor.
- Unread state is `Conversation.readAt` (per-participant marker) against the denormalised
  `lastMessageAt` / `lastMessageBy` (`back-end/routes/messages.js`); anything that writes a
  message must update both. `front-end/src/unread.js` holds the one shared navbar count.

## Location and distance

- Trades are in person, so every list of books for a reader is limited to their distance
  (`User.maxDistanceMiles`, default 25) around their ZIP. Build it with `listBooks`,
  `mostWanted` or `recommendations` (`back-end/lib/listings.js`) and `readerArea(userId)`
  (`lib/nearby.js`): `$geoNear` must open the pipeline and does not cast its query, and
  `presentStages` adds the rounded `distanceMiles` and strips the book's position fields.
  A reader without a ZIP has a null area: unfiltered, no distances.
- `User.zip` and `User.geo` and `OfferedBook.ownerGeo` are `select: false` and never reach
  another reader; `User.location` is the public place name. A book's position fields come only
  from `bookPosition` (`lib/nearby.js`): the add-offered-book route, `moveOwnerBooks` on a ZIP
  change, the seed, test fixtures and `npm run place-books` all go through it.
- A distance is a way to locate a reader, so it is sent only for books within the caller's
  distance (`distanceFields` in `lib/nearby.js` for a single book; beyond it, only a
  `distanceLabel`), never on a reader's profile, and ZIP changes are throttled (3 a day).
- The map (`routes/map.js`, `lib/map.js`) groups books by `OfferedBook.ownerPlace` (the owner's
  public place name) at `ownerPlacePoint` (`placePoint` in `lib/zipCodes.js`, the mean of the
  place's ZIP points, 2d-indexed for bbox queries), never at `ownerGeo`; it shows any distance.
- A map search is the query-string keys `parseSearch` reads in `back-end/lib/mapSearch.js`; its
  `searchFilter` (always on top of `marketFilter`) is the one filter every `/map` endpoint uses,
  so counts, the panel and `/map/nearest` agree. The front end keeps the same keys in the page's
  URL (`front-end/src/mapSearch.js`) and passes them through unchanged.
- ZIPs resolve offline through `lib/zipCodes.js` from the bundled GeoNames table
  (`npm run build:zip-codes`; shipped to Vercel by `includeFiles` in `vercel.json`).
  Test fixtures live in Brooklyn (11201); `createUser({ zip: null })` is a pre-ZIP account.

## Blocks, reports, suspensions and ratings

- A block (`Block` in `Data.js`) works both ways. Any route that lists offers builds its filter
  with `marketFilter` from `back-end/lib/blocks.js` (which also applies `locked: false`), and
  anything that lets one reader reach another (messages, proposing, countering or accepting a
  trade) checks `isBlockedBetween` on the server. The public book routes use `optionalAuth` in
  `app.js` so a signed-in caller's blocks apply; the front end calls them through `authFetch`.
- Admins are the confirmed accounts listed in `ADMIN_EMAILS`; there are no roles in the database.
  Admin API routes live in `back-end/routes/admin.js`, mounted behind `requireAdmin`
  (`back-end/lib/admin.js`), which is the real gate; `GET /user`'s `isAdmin` only lets the
  front end offer the page.
- A suspended reader (`User.suspended`, `back-end/lib/suspensions.js`) cannot sign in and has
  every session ended when suspended. `marketFilter` hides their offers, so listing through it
  covers them too; anything that lets one reader reach another checks `isSuspended` beside
  `isBlockedBetween`.
- A reader's rating is `ratingsAvg` over `ratingsCount`; the legacy `ratings` field is retired
  and must not be read or written. The front end formats it only through `front-end/src/rating.js`.

## Front-end build (Vite)

- The front end is a Vite app, not Create React App: `npm run dev`, `npm run build` (into
  `front-end/dist`), `npm run preview`. `front-end/index.html` is the entry point and lives at
  the front-end root, not in `public/`.
- Any file containing JSX must use the `.jsx` extension; Vite's esbuild transform does not
  parse JSX out of a `.js` file.
- The API base URL is `import.meta.env.VITE_SERVER_ADDRESS`, compiled into the bundle at build
  time; production builds get `/api` (same origin) from `front-end/.env.production`, local
  development sets it in `.env.local`. Only `VITE_`-prefixed variables reach client code, which
  also makes them public - never a secret. See `front-end/.env.example`.
- The map page (`src/BookMap.jsx`) is lazy-loaded because MapLibre is large; markers are React
  buttons portalled into MapLibre markers (`BookMap/MapMarker.jsx`) and clustered client-side with
  supercluster (`src/bookMap.js`). Tests mock `maplibre-gl` (`src/BookMap.test.jsx`).
- Tailwind is wired through `front-end/postcss.config.js`; react-scripts 5 did that implicitly
  from the presence of `tailwind.config.js`, Vite does not.

## Checks and CI

- `.no-mistakes.yaml` pins the canonical checks (front-end lint, build and tests, back-end
  tests); `.github/workflows/ci.yml` was generated from it with `no-mistakes ci-workflow` and
  runs the same commands. Change a command in both files together. The commands themselves
  are listed in `CONTRIBUTING.md` under "Building and Testing".
- Neither package commits a lockfile (`package-lock.json` is git-ignored), so installs are
  `npm install`, not `npm ci`.
- Front-end lint is ESLint 9 with the flat config in `front-end/eslint.config.mjs`. It enables
  `react/jsx-uses-vars` because core `no-unused-vars` does not count a name used only as a JSX
  tag. Fix violations rather than disabling rules.

## Tests

- `cd front-end && npm test` runs the suite once under Vitest (jsdom); `npm run test:watch`
  watches. Tests use `vi` from `vitest` for mocks; other globals come from `globals: true` in
  `front-end/vite.config.js`.
- `cd back-end && npm test` runs Mocha against an in-process MongoDB started as a one-node
  replica set (several exchange routes use transactions, which a standalone
  mongod rejects). `back-end/test/setup.js` is the root hook: it connects
  Mongoose and empties every collection after each test. `back-end/test/helpers.js` signs users
  up through the real auth routes, so protected routes get a genuine token; its direct
  fixtures (`createUser`, `await authHeader(user)`, ...) write to the database for states the routes
  cannot produce.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
