# Contributing Guidelines

## Team Norms

### Team Expectations
- Make best effort to hold standups synchronously
- Team members must include blocking items in their standup report
- Team members that need help must reach out to get help
- Conflicts will be resolved by a 3-out-of-5 majority vote
- Responses expected by 2 business days or 1 weekend, over discord
- In case of an event where a member will be unresponsive for 2+ days, they must inform the rest of the team
- Should a member fail to deliver, tasks will be reassigned to other members until a compromise can be reached. If this is repeated, the professor may be contacted
- Standups should be done the day before they are due
- A member who makes no progress on a task after two standups in a row without making an honest effort to find a breakthrough will be reported to admins
- Follow all conventions outlined in the coding conventions document distributed to the class
- Always push working code, if you break the pipeline/build then fix it
- Make granular and small commits, per feature or per bug fix
- Don't leave dead/commented out code behind. If you see such code, delete it

## Git Workflow
- Create new branch from main
- Make edits
- Make commits
- Open pull request
- Another member will approve or deny this
- If approved, it will be merged into main. If denied, retry

## Local Development Setup
- npm install in the main directory
(Will be added as needed)

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
