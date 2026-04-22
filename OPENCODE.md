# SpecToShip Repository Adapter For OpenCode

This file is the OpenCode-specific adapter for developing the `spec-to-ship` source repository.
Repository-wide rules live in `AGENTS.md`.

## OpenCode Rules

1. Treat this repository as product source, not as a user project managed by `.s2s`.
2. Do not run the user-project onboarding flow in this repository.
3. Do not create or rely on `.s2s/` here.
4. When changing what `s2s` installs into user repositories, edit `src/governance/user-project/*`.
5. Validate onboarding and runtime behavior in an external test or app repository, not here.
6. Keep `OPENCODE.md` aligned with `AGENTS.md`.

<!-- S2S_INTERNAL_GOVERNANCE_START -->
# S2S Internal OpenCode Adapter (Repo)

For OpenCode sessions in this repository:
- Treat `internal/self-host/` as maintainer-only governance assets.
- Follow public product behavior from `README.md` and `docs/documentation-map_en.md`.
- Assume the maintainer manages worktrees manually; do not introduce repo-specific worktree automation policy here.
- Every repository change must live on its own branch and finish as a PR into `main`.
- Do not create or rely on `.s2s/` in this repo; validate `s2s` behavior only in external test/app repositories.
- Keep runtime root markers (`S2S_PROJECT_GUARDRAIL_*`, `S2S_CODEX_ADAPTER_*`, `S2S_CLAUDE_ADAPTER_*`) out of commits.
- Prefer deterministic edits and run `npm run check` before delivery.
<!-- S2S_INTERNAL_GOVERNANCE_END -->
