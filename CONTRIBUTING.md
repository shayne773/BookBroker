# Contributing Guidelines

## Code conventions

- Always push working code. If you break the build, fix it.
- Make granular, small commits — one per feature or bug fix.
- Don't leave dead or commented-out code behind. If you see such code, delete it.

Architecture, sharp edges and the conventions specific to this codebase (front-end
auth, the design system, the back end, email, trades, tests) live in
[`AGENTS.md`](./AGENTS.md). Read it before making a change; keep it up to date when
you learn something durable.

## Git workflow

- Create a new branch from `master`.
- Make your edits and commits.
- Open a pull request; it needs another contributor's approval.
- Once approved and green, it is merged into `master`.

## Local development setup

See the [README](./README.md) for prerequisites, environment configuration and the
commands that run each service.

## Building and Testing

The checks every pull request must pass are pinned in `.no-mistakes.yaml` and run by
the `CI` GitHub workflow (`.github/workflows/ci.yml`). From the repository root:

```
npm --prefix front-end install && npm --prefix back-end install
npm --prefix front-end run lint     # ESLint
npm --prefix front-end run build    # Vite production build
npm --prefix front-end test         # Vitest
npm --prefix back-end test          # Mocha, against an in-process MongoDB
```

The back-end tests need no database of their own: they start MongoDB in-process
(and download its binary on the first run).
