# BookBroker front end

A React single-page app built with [Vite](https://vite.dev/). The Express + MongoDB
API in `../back-end` is a separate service; this app only talks to it over HTTP.

## Configuration

The API base URL is a build-time value, not a runtime one: Vite substitutes
`import.meta.env.VITE_SERVER_ADDRESS` into the bundle when it builds. Each
environment therefore needs its own build with its own value.

Copy `.env.example` to `.env.local` for local development:

```
cp .env.example .env.local
```

On Vercel, set `VITE_SERVER_ADDRESS` per environment (production / preview /
development) and redeploy so a new bundle is produced.

Only variables prefixed `VITE_` reach client code — that prefix is what makes a
value public, so never put a secret behind it.

## Available scripts

In this directory, you can run:

### `npm run dev`

Runs the app in development mode on [http://localhost:3000](http://localhost:3000),
with hot module replacement.

### `npm run build`

Builds the app for production into the `dist` folder, minified and with hashed
filenames. This is the directory Vercel serves. `vercel.json` in this directory
rewrites every path that does not match a built file to `/index.html`, so a
refresh or a direct link to a client-side route such as `/books/:id` still loads
the app instead of a 404.

### `npm run preview`

Serves the contents of `dist` locally, so you can check a production build
before deploying it.

### `npm test`

Runs the test suite once with [Vitest](https://vitest.dev/) in a jsdom
environment. `npm run test:watch` keeps it running in watch mode.

There is no `lint` script: the only linting this app had came from
react-scripts, which ran `eslint-config-react-app` on every start and build.
That went away with the migration and `vite build` does not lint, so choosing
and wiring up a replacement linter is tracked as separate follow-up work.

## Layout notes

- `index.html` lives at the project root, not in `public/`: it is the app's
  entry point and it loads `src/index.jsx` as a module.
- `public/` holds static files copied to the site root as-is, such as
  `/favicon.ico` and `/manifest.json`.
- Files containing JSX use the `.jsx` extension, which is what Vite's esbuild
  transform expects.
