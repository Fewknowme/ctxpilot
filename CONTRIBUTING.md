# Contributing

## Local setup

1. Fork the repo.
2. Clone your fork.
3. Change into the repo root.
4. Install dependencies:

```bash
npm install
```

5. Build the workspace:

```bash
npm run build
```

## Tests

Run the full test suite:

```bash
npm test
```

## Build

Build all workspaces:

```bash
npm run build
```

## Pull request guidelines

- Keep one feature or fix per PR.
- Add or update tests for behavior changes.
- `npm run typecheck` must pass.
- Keep docs in sync when commands or setup behavior change.

## Issue labels

- `bug`
- `enhancement`
- `good first issue`

## Roadmap context

See [docs/MASTERPLAN.md](docs/MASTERPLAN.md) for current scope and future roadmap.
