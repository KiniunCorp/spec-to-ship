
# SpecToShip Repository Governance

This file governs development of the `spec-to-ship` source repository itself.

Supported conversational UIs for this repository:
- Claude Code
- Codex
- OpenCode

## Boundary

This repository is the product source for `s2s`.
It is not a user project managed by `.s2s`.

## Rules

1. Do not initialize, bootstrap, or rely on `.s2s/` in this repository.
2. Do not run the top-level user-project onboarding flow against this repository.
3. User-project governance source lives under `src/governance/user-project/`.
4. Root files in this repository (`AGENTS.md`, `CODEX.md`, `CLAUDE.md`, `OPENCODE.md`) govern development of `spec-to-ship`; they are not the templates that `s2s` installs into user repositories.
5. Validate onboarding, `.s2s` creation, stage flow, and delivery behavior only in external test or app repositories.
6. If a local `.s2s/` appears here accidentally, remove it.

## Product Change Rule

When changing user-project governance behavior:
- update `src/governance/user-project/*`
- update `README.md` and `README_es.md` if user-facing behavior changed
- update any relevant tests and migration logic

## Adapter Rule

`CODEX.md`, `CLAUDE.md`, and `OPENCODE.md` in this repository are repo-development adapters.
Keep them aligned with this file.

<!-- S2S_INTERNAL_GOVERNANCE_START -->
# S2S Internal Governance (Repo)

This block governs development of the `spec-to-ship` repository itself.

Internal boundary rules:
- Product source of truth lives in `src/`, `config/`, and public docs listed in `docs/documentation-map_*.md`.
- Internal maintainer governance lives in `internal/self-host/`.
- Runtime local state (`.s2s/`) is local-only and must remain untracked.
- This repository must not create or keep a working `.s2s/`.
- All `s2s` runtime validation must happen in external test/app repositories, not in this repository.
- If `.s2s/` appears here by accident, remove it with `npm run selfhost:clean`.
- Runtime root markers (`S2S_PROJECT_GUARDRAIL_*`, `S2S_CODEX_ADAPTER_*`, `S2S_CLAUDE_ADAPTER_*`) are local-only and must not be committed.
- Do not import `internal/self-host/*` from product runtime paths.

Maintainer flow:
1. Create one independent branch per change. Do not develop repository changes directly on `main`.
2. Manage any needed worktrees manually outside repo governance automation.
3. Run `npm run selfhost:apply` after updating internal templates.
4. Run `npm run check` before opening or updating a PR.
5. Finish each change through a PR into `main`.
6. Bump the product version with SemVer for every merged change.
7. Classify each PR as `product`, `governance`, or `mixed` using `internal/self-host/change-classification_*.md`.
8. Keep `Product Changes` and `Repo Governance Changes` separated in PR summary and changelog.
<!-- S2S_INTERNAL_GOVERNANCE_END -->
