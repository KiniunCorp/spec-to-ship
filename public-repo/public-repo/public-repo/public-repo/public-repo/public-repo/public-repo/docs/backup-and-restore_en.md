# Spec-To-Ship Backup and Restore Guide (EN)

This guide explains how to back up and restore project governance/runtime state managed by `s2s`.

## What is included

`s2s backup` stores:

- Full project-local `.s2s/` workspace
- Root compatibility shims for chat clients:
  - `AGENTS.md`
  - `CODEX.md`
  - `CLAUDE.md`

## Global backup location

Backups are stored globally (outside app repo) with project isolation:

```text
~/.s2s/backups/projects/<project-hash>/<snapshot-id>/
  manifest.json
  s2s/
  root/
```

- `<project-hash>`: deterministic hash from absolute app root path
- `<snapshot-id>`: ISO-like timestamp id

## Commands

Create backup (current project context):

```bash
s2s backup
```

Create backup for explicit project alias/path:

```bash
s2s backup my-project
```

Restore latest snapshot:

```bash
s2s restore --latest
```

Restore specific snapshot:

```bash
s2s restore --snapshot=<snapshot-id>
```

Restore specific project:

```bash
s2s restore my-project --latest
```

## Safety behavior on restore

Before writing restored files, `s2s restore` always creates an automatic pre-restore safety backup.

This means every restore operation can be rolled back via another restore operation.

## How to inspect available snapshots

Use your shell to list snapshots for a project:

```bash
ls ~/.s2s/backups/projects
ls ~/.s2s/backups/projects/<project-hash>
```

Tip: `s2s backup` output prints snapshot id and project backup directory.

## Recommended usage policy

1. Create a backup before major config edits (`s2s config edit`).
2. `s2s` also creates automatic pre-policy snapshots when guardrail discrepancy decisions are applied in init/config.
2. Create a backup before stage transitions with risky runtime changes.
3. Keep backup/restore operations in your delivery checklist.
