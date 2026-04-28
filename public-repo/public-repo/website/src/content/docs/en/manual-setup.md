---
title: "Manual Setup"
description: "Step-by-step guide to setting up an s2s project workspace and app scaffold without using automatic s2s initialization."
---

This guide covers the manual setup path when you need to configure the workspace outside of `s2s init`.

## Workspace bootstrap

Bootstrap the recommended structure from an app name:

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

## App scaffold initialization

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
