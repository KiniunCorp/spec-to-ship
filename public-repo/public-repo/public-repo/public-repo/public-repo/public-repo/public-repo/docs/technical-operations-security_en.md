# Spec-To-Ship Technical Operations and Security (EN)

## Operating mode

Current operational mode is chat-first governance with project-local runtime in `.s2s`.
Supported chat adapters in CLI surface:

- `codex-cli` (`s2s codex-cli`)
- `claude-cli` (`s2s claude-cli`)

## Critical runtime files

- `.s2s/config/runtime.json`
- `.s2s/config/llm.json` (standalone mode only)
- `.s2s/config/execution.templates.json`
- `.s2s/project.json`

## Key operational controls

In `runtime.json`:

- `guardrailPolicy` (`strict|warn|prompt`)
- `execution.templateId`
- `execution.allowedCommands`
- `execution.timeoutMs`
- `execution.allowUnsafeRawCommand`
- `workspace.projectRepoPath`
- `workspace.worktreesRootPath`

In `llm.json` (standalone mode only):

- `mode` (`api` | `openai_compatible`)
- `provider`
- `model`
- `apiKeyEnvVar`

## Recommended production policy

1. Use `guardrailPolicy=strict`.
2. Use strict execution templates (`codex_strict`, `claude_strict`, or `opencode_strict`).
3. Keep command allowlist minimal.
4. Keep `allowUnsafeRawCommand` disabled.
5. Set bounded execution timeouts.
6. Keep human approval for merge decisions.
7. Enforce branch safety before push: if current branch is tied to closed/merged PR(s), switch to a fresh branch and open a new PR.
8. Set release update severity via `S2S_PROJECT_UPDATE_CLASS` (`soft` or `hard`) before shipping.

## Governance safety model

1. `s2s` keeps root compatibility shims:
- `AGENTS.md`
- `CODEX.md`
- `CLAUDE.md`

2. `s2s` maintains canonical project policy in `.s2s/guardrails/`.
   - If root compatibility shims conflict with `.s2s/guardrails/*`, `.s2s/guardrails/*` is the source of truth.

3. Config/migration safety:
- backups in `.s2s/backups/`
- global snapshots in `~/.s2s/backups/projects/<project-hash>/<snapshot-id>/`
- migration logs in `.s2s/logs/`
- CLI compatibility checks from `.s2s/project.json`

## Operational checklist

- Verify selected chat CLI is installed and authenticated.
- Run `s2s doctor` and resolve any strict guardrail discrepancies before stages.
- Validate `runtime.json` template and allowlist before execution.
- Run `s2s status` before critical stage execution.
- Ensure `gh` is available when `autoPush` is enabled (required for PR-state branch safety checks).
- Confirm expected project update severity (`soft`/`hard`) for the release and document it in changelog/release notes.
- Keep `.s2s/` committed or ignored according to your team policy.
