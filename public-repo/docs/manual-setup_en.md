# SpecToShip - Manual Setup Details

This guide documents the manual setup path (without automatic `s2s` initialization).

## 1) Workspace bootstrap

Recommended structure from app name:

```bash
npm run workspace:bootstrap -- --app-name=superapp
```

By default, the initializer recommends and configures:

```text
superapp-workdir/
|_ superapp
|_ superapp-worktrees
|_ spec-to-ship
```

If approved, it creates missing folders and can relocate `spec-to-ship` into the recommended structure.

Custom paths:

```bash
npm run workspace:bootstrap -- \
  --app-name=superapp \
  --app-path=../app \
  --worktrees-path=../worktrees
```

This updates `config/runtime.json` so all runtime stages use those paths.

## 2) App scaffold initialization

Interactive flow (recommended):

```bash
npm run workspace:bootstrap
```

This offers two app modes:
- `recommended`: proven baseline (Next.js + TypeScript + Supabase-ready + app-side `just` recipes)
- `custom`: bring your own stack and still generate required execution contracts (`just change-worktree`, `just agent-verify`, OpenSpec folders)

For worktrees:
- Use `just change-worktree <change-id> [provider]` with `provider` as `codex|claude|opencode`.

Direct scaffold command:

```bash
npm run app:scaffold -- --mode=recommended
```
