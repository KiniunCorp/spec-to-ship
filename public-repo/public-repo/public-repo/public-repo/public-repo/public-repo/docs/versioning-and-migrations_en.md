# s2s CLI - Versioning and Migrations

## CLI versioning standard

`s2s` uses Semantic Versioning:

- `MAJOR.MINOR.PATCH`
- Examples:
  - `0.1.0`
  - `0.1.1`
  - `0.1.2`
  - `1.0.0`
  - `2.0.0`
  - `0.1.0-rc.1`
  - `1.1.0-beta.2`

Current version: see `package.json` or run `s2s --version`.

## Mandatory bump rule

Every merged change must bump the CLI version.

- Minimum required bump: `PATCH` (`0.1.0` -> `0.1.1`).
- Use `MINOR` for backward-compatible new capabilities.
- Use `MAJOR` for breaking behavior/contracts.

For each bump, update all of:

1. `package.json` (`version`)
2. `package-lock.json`
3. `src/cli.ts` constants (`CLI_VERSION`, `TEMPLATE_VERSION`, `DEFAULT_MIN_CLI_VERSION` when applicable)
4. `CHANGELOG.md`

Repository enforcement:

- `npm run check` now validates product self-versioning before delivery.
- `npm run check` also validates that the active changelog entry separates `Product Changes` from `Repo Governance Changes`.
- CI runs on `pull_request` and `push` to `main`.
- To force PR-only delivery into `main`, enable GitHub branch protection and require CI.

## Project compatibility fields

Each project stores compatibility metadata in `.s2s/project.json`:

- `schemaVersion`: project schema contract version
- `templateVersion`: `.s2s` template generation version
- `minCliVersion`: minimum required `s2s` CLI version
- `lastMigratedByCliVersion`: last CLI version that migrated this project

## Migration policy

1. Migrations run automatically when a project command executes.
2. Before migration changes are applied, a backup is created under:
   - `.s2s/backups/<timestamp>/`
3. Migrations are idempotent and logged in:
   - `.s2s/logs/migrations.log`
4. If current CLI version is lower than `minCliVersion`, command execution is blocked.

## Project update severity policy (soft/hard)

When CLI detects project-managed files are outdated (`schemaVersion`, `templateVersion`, or project `minCliVersion` drift), it classifies update severity:

- `soft`: user can defer update; pending state is stored in `.s2s/project.local.json`
- `hard`: update is mandatory; execution is blocked until update is applied

Mandatory behavior:

1. Inform user before updating project files.
2. Ask for confirmation in interactive mode.
3. In non-interactive mode:
   - soft updates are deferred
   - hard updates fail fast

Build/release flag:

- `S2S_PROJECT_UPDATE_CLASS=soft|hard`
- default is `soft`
- use `hard` for releases that must force project update before continuing.

## Upgrade flow

Install:

```bash
brew tap kiniuncorp/s2s
brew install s2s
```

Upgrade:

```bash
brew upgrade s2s
```

Verify:

```bash
s2s --version
```
