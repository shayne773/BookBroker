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
  (toasts, dialog overlays).
- Motion is tokenised (`--duration-fast|base|slow`, `--ease-out|standard`) and
  `tokens.css` collapses those durations under `prefers-reduced-motion: reduce`, so a
  component honours the preference by using the tokens rather than by opting in.

## Front-end build (Vite)

- The front end is a Vite app, not Create React App: `npm run dev`, `npm run build` (into
  `front-end/dist`), `npm run preview`. `front-end/index.html` is the entry point and lives at
  the front-end root, not in `public/`.
- Any file containing JSX must use the `.jsx` extension; Vite's esbuild transform does not
  parse JSX out of a `.js` file.
- The API base URL is `import.meta.env.VITE_SERVER_ADDRESS`, compiled into the bundle at build
  time, so every environment needs its own build with its own value. Only `VITE_`-prefixed
  variables reach client code, which also makes them public - never a secret. See
  `front-end/.env.example`.
- Tailwind is wired through `front-end/postcss.config.js`; react-scripts 5 did that implicitly
  from the presence of `tailwind.config.js`, Vite does not.

## Tests

- `cd front-end && npm test` runs the suite once under Vitest (jsdom); `npm run test:watch`
  watches. Tests use `vi` from `vitest` for mocks; other globals come from `globals: true` in
  `front-end/vite.config.js`.
- The two react-router v7 shims CRA's Jest needed - the `react-router/dom` moduleNameMapper and
  the `TextEncoder`/`TextDecoder` polyfill - are gone; Vitest's jsdom needs neither.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
