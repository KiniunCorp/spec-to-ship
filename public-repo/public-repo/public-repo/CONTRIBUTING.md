# Contributing to Spec-To-Ship

Thank you for your interest in contributing. This document explains how to work on the project and submit changes.

## Prerequisites

- Node.js >= 20
- npm >= 10
- Git

Optional: [`just`](https://github.com/casey/just) for shorthand commands.

## Setup

```bash
git clone https://github.com/KiniunCorp/spec-to-ship.git
cd spec-to-ship
npm install
```

Build from source and link globally:

```bash
npm run build && npm link
# or: just install
```

## Development workflow

Every change lives on its own branch and merges to `main` via PR.

```bash
git checkout -b feat/your-feature
# ... make changes ...
npm run check        # must pass before submitting
git push origin feat/your-feature
# open a PR on GitHub
```

## Running checks

```bash
npm run typecheck    # TypeScript type check only
npm run build        # compile src/ → dist/
npm run check        # full release gate: typecheck + build + 29 contract tests
```

All checks in `npm run check` must pass before a PR can merge.

## Versioning policy

Every PR that changes product code must bump the version in four places:

- `package.json` — `version` field
- `src/cli.ts` — `CLI_VERSION`, `TEMPLATE_VERSION`, `DEFAULT_MIN_CLI_VERSION`
- `CHANGELOG.md` — add a `## x.y.z` section describing the change

PRs that change only docs, workflows, or governance files do not require a version bump unless they also change product behavior.

## Opening issues

- **Bugs:** use the bug report template. Include your `s2s --version` output and steps to reproduce.
- **Feature requests:** use the feature request template. Describe the problem, not the solution.
- **Non-trivial PRs:** open an issue first to discuss the approach before writing code.

## Security issues

Do not open a public issue for security vulnerabilities. See [SECURITY.md](./SECURITY.md) for the responsible disclosure process.

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md). By participating, you agree to uphold its standards.
