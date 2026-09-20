# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Front-end auth

- Every authenticated request goes through `authFetch` in `front-end/src/auth.js`, which
  attaches the bearer token and turns a 401 into one shared "session expired" policy.
  Do not hand-roll `Authorization` headers or read `localStorage.token` in a page.
- Pages that need a signed-in user live under the `RequireAuth` layout route in
  `front-end/src/AppContent.js`; `front-end/src/RequireAuth.js` redirects to `/login` and
  passes the intended destination in the navigation state, which `Login.js` reads.
- In a `catch`, ignore the error when `isSessionExpiredError(err)` is true: the redirect is
  already in flight, so showing a page-level error would flash.

## Tests

- `cd front-end && CI=true npx react-scripts test --watchAll=false` runs the suite.
- react-router v7 needs two shims for the Jest/jsdom that ships with react-scripts 5: the
  `jest.moduleNameMapper` entry for `react-router/dom` in `front-end/package.json`, and the
  `TextEncoder`/`TextDecoder` polyfill in `front-end/src/setupTests.js`.
- `CI=true npx react-scripts build` fails on pre-existing `no-unused-vars` warnings; a plain
  `npx react-scripts build` succeeds.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
