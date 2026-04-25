# Changelog

> **Homebrew tap migration:** The official tap has moved from `guschiriboga/s2s` to `kiniuncorp/s2s`.
> Update with: `brew untap guschiriboga/s2s && brew tap kiniuncorp/s2s`

## 0.2.56

### Product Changes

- None.

### Repo Governance Changes

- **Release mirroring** — `sync-public.yml` now creates a matching GitHub release on `KiniunCorp/spec-to-ship` after every publish, using the same tag, title, and notes as the private repo release.
- Bumped product version to 0.2.56.

## 0.2.55

### Product Changes

- **Approval gate AI bypass fix (two-layer):**
  - *Guardrail layer:* Changed "wait for approval via `s2s approve`" to an explicit STOP directive across all three guardrail renderers (AGENTS, CODEX, CLAUDE). Added "never call `s2s approve` or `s2s reject`" to the "Rules (never violate)" section. CLI contract test updated to use piped stdin instead of `--yes` for gate approve/reject.
  - *CLI layer:* Added `confirmHumanApprovalCommand()` that ignores `--yes`, making `s2s approve` and `s2s reject` require an interactive terminal or piped stdin.
  - *Planner layer:* Fixed `requiresHumanApproval()` in the flow planner to return `true` whenever `engineering_exec` is in the recommended stages (not only when `pm`/`research`/`design` are). This ensures `implementation_only` and any other fast-track intent that reaches code execution always creates a human approval gate before `engineering_exec` runs. `hotfix` and `resume_existing_change` remain explicitly exempt. Added contract test case asserting `implementation_only` gates on `engineering_exec`.
  - *Classifier layer:* Removed generic verbs (`build`, `code`, `ship`, `execute`) from `implementation_only` signals — these are too broad and misclassify new-project requests as having an existing spec. `implementation_only` now requires explicit "skip planning / just implement / based on spec" language. Added `build`, `make`, `lets build`, `new [app/site/service/...]`, and `want a [thing]` as `new_feature` signals. Added `check:intent-classifier` to the release gate. Added fixture tests asserting "lets build a tech website" and similar prompts classify as `new_feature`.

### Repo Governance Changes

- Bumped product version to 0.2.55.

## 0.2.54

### Product Changes

- **README improvements** — Added "Why s2s" problem framing section; inline nav bar; "When to use s2s" scenario table; `s2s doctor` verification step in Quick Start; GitHub stars and license badges; all badges updated to `flat-square` style. Applied to both EN and ES versions.
- **Brand assets** — Added `assets/` directory with logo files (horizontal, vertical, icon, text variants). README headers updated with centered horizontal logo and HTML-aligned badge row.
- **VHS demo scripts** — Added `docs/demo.tape` (init flow), `docs/demo-claude.tape` (Claude Code integration), and `docs/demo-codex.tape` (Codex integration) for generating terminal demo GIFs with charmbracelet/vhs.

### Repo Governance Changes

- Bumped product version to 0.2.54.

## 0.2.53

### Product Changes

- **README rewrite** — chat-native concept leads; client-agnostic messaging; OpenCode added alongside Claude Code and Codex; Quick start reduced to `s2s init` + open your chat client; command reference de-emphasized as advanced; stages table promoted. Applied to both EN and ES versions.

### Repo Governance Changes

- Bumped product version to 0.2.53.

## 0.2.52

### Product Changes

- **OSS launch prep** — Namespace migrated from `guschiriboga` to `KiniunCorp`. Homebrew tap updated to `kiniuncorp/s2s`. Added `repository`, `homepage`, `bugs`, `author`, `engines`, and `keywords` to `package.json` for proper npm OSS metadata.

### Repo Governance Changes

- Added `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and GitHub issue templates.
- Added `ci.yml` workflow (typecheck + build on push/PR to main).
- Added `sync-public.yml` workflow (curated snapshot sync to `KiniunCorp/spec-to-ship` on release).
- Bumped product version to 0.2.52.

## 0.2.51

### Product Changes

- **Session banner now shows version** — `s2s stage` banner header now includes the CLI version (`v0.2.51`), matching the init banner format.
- **Session banner suppressed with `--json`** — `s2s stage --json` no longer emits the banner box before the JSON output.
- **`s2s request` now has its own banner** — A compact header (`s2s · request`) is shown before the decision output, also suppressed with `--json`.

### Repo Governance Changes

- Bumped product version to 0.2.51.

## 0.2.50

### Product Changes

- **Figma integration is now opt-in** — The design stage no longer requires `FigmaLink.json` as an output artifact. The design agent prompt and output list are conditional on `config/figma.mcp.json` being present and configured. Users without Figma get a clean `PrototypeSpec.md`-only output. Users with Figma configured get the same behaviour as before.

### Repo Governance Changes

- Bumped product version to 0.2.50.

## 0.2.49

### Product Changes

- **Gate supersession on spec refinement** — When a spec is updated and a new `spec_review` gate is created, any pending `spec_review` gate from a prior spec version on the same change is automatically cancelled. Previously, both the old and new gates stayed open, requiring the user to manually reject the stale one. Supersession runs silently (no output) since it is an automatic system action, not a human decision.
- **Artifact review summary on gate creation** — After `s2s stage <stage> --submit` creates a review gate, the CLI now shows the human-readable artifact name, a clickable `file://` path, and a bullet list of the artifact's top-level sections (extracted from H2 headings). Makes it easy for the human to identify and open the artifact for review before approving or rejecting.

### Repo Governance Changes

- Bumped product version to 0.2.49.

## 0.2.48

### Product Changes

- **Multi-tool chat permission pre-approval** — `s2s init` now detects which chat tools are present in the project (Claude Code, Codex, OpenCode) and prompts to pre-approve `s2s` commands for each. Users no longer have to manually allow `s2s` commands in their chat tool during an AI session. Consent is per-tool, per-project, and recorded in `.s2s/project.json` so the prompt never repeats. `s2s update` silently applies permissions for any newly detected tools. `s2s config chat-permissions` makes this available after init.
- **Pending footnote** — If no chat tools are detected at init time, the project is marked `pending`. The next time a chat-native command runs (e.g. `s2s stage pm`), a quiet footnote is appended to the context package: `run: s2s config chat-permissions`. The footnote is shown at most once and suppressed on all subsequent calls.

### Repo Governance Changes

- Bumped product version to 0.2.48.

## 0.2.47

### Product Changes

- **Re-engineered `engineering_exec` chat-native flow** — three coordinated fixes eliminating all known failure modes:
  1. **No more synthetic change creation**: `s2s stage engineering_exec` now exits early before the orchestrator decision block. Previously, if the ledger had no `activeChangeId` or `lastDecision`, the stage handler synthesized a new change ("Run engineering_exec stage for project …") that overrode the real active change and wiped out its slices from scope.
  2. **No more route-check warnings**: The `engineering_exec` handler now runs before the route check entirely, so the "[orchestrator] warning: Skip engineering_exec until engineering establishes or resumes an explicit slice/run." warning never fires.
  3. **Project-wide slice search**: `requireNextExecutableSlice` now accepts `projectWide: true` and searches all open slices across all changes instead of only the active-change scope. `startEngineeringExecChatNativeRun` passes this option, so it finds ready slices even when the ledger's active change is a stale synthetic one.

### Repo Governance Changes

- Bumped product version to 0.2.47.

## 0.2.46

### Product Changes

- Onboarding state messages are now user-friendly. During `s2s init`, the technical `[onboarding] init: project is not initialized yet (state=UNINITIALIZED_GIT_ROOT). This Git root can be configured directly.` is replaced with a clear product message: `[onboarding] This repository isn't set up with Spec-to-Ship yet. Starting guided initialization.` State codes are no longer shown to users in any context.

### Repo Governance Changes

- Bumped product version to 0.2.46.

## 0.2.45

### Product Changes

- `s2s init` and `s2s config`: backup policy configuration now shows all defaults upfront and asks "Accept defaults? [Y/n]" before prompting individually. Accepting (default) skips all 5 backup detail questions. Declining still walks through each setting individually.

### Repo Governance Changes

- Bumped product version to 0.2.45.

## 0.2.44

### Product Changes

- Fixed `engineering_exec --submit` failing with "Stage 'engineering_exec' is not part of the recommended route": `engineering_exec` is a slice-level operation and does not belong to the pipeline route, so `advanceStageOwnership` is no longer called on submit. Instead, the submit path completes the run lifecycle and checks remaining ready slices to determine the next action.
- Fixed stuck runs: `s2s stage engineering_exec` now detects any existing `running` runs and resumes the most recent one (re-prints its context) instead of creating a new run for a different slice. This recovers projects where a prior `--submit` failure left slices in `in_progress` state with orphaned `running` runs.

### Repo Governance Changes

- Bumped product version to 0.2.44.

## 0.2.43

### Product Changes

- Moved artifact store from `artifacts/` (project root) to `.s2s/artifacts/` — all s2s-internal state now lives under `.s2s/`. The `.s2s/.gitignore` entry for `artifacts/` already covered this path.
- `s2s update` automatically migrates existing `artifacts/` directories from the old project-root location to `.s2s/artifacts/` on first run after upgrade.
- Updated all user-facing path references (stage task output, error messages, live.md `nextAction`) from `artifacts/{projectId}/` to `.s2s/artifacts/{projectId}/`.

### Repo Governance Changes

- Bumped product version to 0.2.43.

## 0.2.42

### Product Changes

- Fixed slice derivation producing 0 slices after `engineering --submit`: the stage task output now includes the exact required Backlog.md column format (`| ID | Priority | Task | Description | Estimate | Dependencies | Acceptance Criteria | Allowed Paths | Out of Scope |`). Previously the descriptor only said "markdown table", causing Claude to invent different column names that the parser rejected.
- Fixed slice derivation errors being silently swallowed: `recordStageCompletion` now captures the derivation error and surfaces it as a `[s2s] WARNING` in the `--submit` output. The warning includes the required column format and the `--submit` re-run command so the user knows exactly what to fix.
- `engineering_exec` is now fully chat-native. `s2s stage engineering_exec` picks the next ready slice, creates an execution run in the ledger, writes `SLICE_CONTEXT.md`, and prints the slice context package to stdout. The chat AI implements the slice directly (branch → code → PR). `s2s stage engineering_exec --submit` records the run complete and creates an `execution_review` gate. No external agent or worktree is spawned in chat-native mode.
- Updated all three guardrail adapters (AGENTS, CODEX, CLAUDE) to describe the `engineering_exec` chat-native flow so the orchestrating AI knows how to run it.

### Repo Governance Changes

- Bumped product version to 0.2.42.

## 0.2.41

### Product Changes

- Fixed `s2s update` wiping live.md: instead of unconditionally resetting to `status: none`, update now rebuilds live.md from the current ledger state. Projects with a pending gate will see `gate_pending` preserved after update.
- Updated guardrail session-start instruction in all three adapters (AGENTS, CODEX, CLAUDE): when live.md status is not "none", the LLM now immediately surfaces the pending work to the user and asks whether to continue or start something new.

### Repo Governance Changes

- Bumped product version to 0.2.41.

## 0.2.40

### Product Changes

- No product code changes.

### Repo Governance Changes

- Fixed `release-binaries.yml`: build each architecture with a separate `pkg` invocation and an explicit `--output` path (`s2s-macos-arm64`, `s2s-macos-x64`) instead of a combined multi-target call. Avoids ambiguity in pkg's output file naming when multiple targets are specified.
- Bumped product version to 0.2.40.

## 0.2.39

### Product Changes

- No product code changes.

### Repo Governance Changes

- Automated Homebrew formula updates: the release pipeline now includes an `update-formula` job that patches `Formula/s2s.rb` in `guschiriboga/homebrew-s2s` automatically after every published release. No manual SHA256 copying required. Requires a one-time `HOMEBREW_TAP_TOKEN` secret setup.
- Updated `docs/homebrew-distribution_en.md` and `_es.md`: replaced 6-step manual checklist with 2-step automated release workflow; added one-time PAT setup instructions and manual fallback documentation.
- Bumped product version to 0.2.39.

## 0.2.38

### Product Changes

- No product code changes.

### Repo Governance Changes

- Added `.github/workflows/release-binaries.yml`: GitHub Actions workflow that builds self-contained macOS arm64 and x64 binaries on every published release, uploads tarballs (`s2s-{version}-macos-{arch}.tar.gz`) and `sha256sums.txt` as release assets.
- New `docs/homebrew-distribution_en.md` and `docs/homebrew-distribution_es.md`: full maintainer guide covering Homebrew quick install, upgrade, release-to-formula checklist, artifact naming convention, validation commands, and troubleshooting.
- Updated `README.md` and `README_es.md`: added Homebrew install instructions alongside npm; npm kept as primary install method.
- Updated `docs/documentation-map_en.md` and `docs/documentation-map_es.md`: added Homebrew Distribution entries under a new Distribution section.
- Bumped product version to 0.2.38.

## Chat-native architecture rearchitecture (v0.2.28–v0.2.34)

Phases 1–6 completed the full rearchitecture of `s2s` from a CLI-subprocess orchestrator to a chat-native binary. Summary of what changed across all phases:

- **Zero-token orchestration:** `s2s stage <stage>` now outputs a structured task package to the chat session. The chat AI generates the artifact; `s2s` handles all routing, state, and quality logic in the binary. No LLM calls from s2s in the default mode.
- **Two-phase stage pattern:** `s2s stage <stage>` (context delivery) + `s2s stage <stage> --submit` (record completion) replaces the old single-command pipeline invocation.
- **`.s2s/live.md`:** A machine-written state file updated after every command. The AI reads it to orient at session start and after context is lost — cheaper and more reliable than re-running `s2s status`.
- **`.s2s/protocol.md`:** Generated command reference written by `s2s init` and `s2s update`. Covers all active commands with syntax, arguments, and examples.
- **Compact governance templates:** `AGENTS.md`, `CODEX.md`, and `CLAUDE.md` under 35 lines each. Session orientation via `live.md`; two-phase stage pattern explicit in all clients.
- **Standalone mode:** `pipelineMode: 'standalone'` added as an explicit opt-in for headless/CI use. The broken `mode: 'cli'` path (CLIProvider subprocess) was fully deleted.
- **New documentation:** `docs/chat-native-workflow_en.md`, `docs/token-efficiency_en.md`, `docs/live-state_en.md`.

## 0.2.37

### Product Changes

- `s2s version` / `s2s --version` / `s2s -v`: now prints both `binary` and `project` versions when run inside a configured project. Outside a project, prints the binary version only (unchanged).
- `s2s help` (full listing): VERSION section now shows `binary` and `project` versions when run inside a project.
- `s2s` (default banner): the Ready status line now shows the project version (`v<templateVersion>`) alongside the project alias.
- `s2s status` (human output): Project Status block now includes Binary version and Project version rows.
- `s2s status --json`: response now includes a top-level `versions: { binary, project }` field.
- `s2s --json` (default): `context` object now includes `binaryVersion` and `projectVersion` fields.

### Repo Governance Changes

- Bumped product version to 0.2.37.

## 0.2.36

### Product Changes

- No product code changes.

### Repo Governance Changes

- Updated `docs/tech-architecture-summary_en.md`: corrected one-paragraph summary and stage capabilities section to reflect chat-native pipeline model (task package → AI generates → `--submit`; zero-token orchestration; standalone mode).
- Bumped product version to 0.2.36.

## 0.2.35

### Product Changes

- No product code changes.

### Repo Governance Changes

- Documentation finalization for chat-native architecture (Phase 7).
- Updated `docs/llm-access-modes_en.md` / `_es.md`: replaced CLI mode with pipeline mode explanation (chat-native vs. standalone).
- Updated `docs/technical-architecture_en.md`: added chat-native pipeline model section describing two-phase stage pattern and what s2s owns vs. what the AI owns.
- Updated `docs/user-manual_en.md` / `manual-usuario_es.md`: two-phase stage pattern, `live.md` orientation, `protocol.md` reference.
- Updated `docs/execution-templates_en.md` / `_es.md`: note that templates only apply to `engineering_exec` and standalone mode.
- Updated `docs/00_ThePitch.md`: added zero-token orchestration as a headline benefit.
- Updated `docs/02_User_summary.md`: step 3 describes the two-phase pattern.
- Updated `README.md`: quick-start shows `s2s request` → `s2s stage` → `--submit` pattern; project structure reflects `live.md`, `protocol.md`, and standalone-only `llm.json`.
- New: `docs/chat-native-workflow_en.md` — complete session walkthrough.
- New: `docs/token-efficiency_en.md` — token efficiency differentiator doc.
- New: `docs/live-state_en.md` — reference doc for `.s2s/live.md`.
- Updated `docs/documentation-map_en.md` to include new docs.
- Bumped product version to 0.2.35.

## 0.2.34

### Product Changes

- Added `standalone` pipeline mode as an explicit opt-in for headless/CI use. Set `pipelineMode: 'standalone'` in `runtime.json` via `s2s config edit` to have `s2s stage <stage>` call the LLM API directly instead of outputting a chat-native context package.
- `s2s config edit` now prompts for pipeline mode (`chat-native` / `standalone`) before LLM provider settings. LLM provider questions are only shown when standalone mode is selected; chat-native projects do not write `llm.json`.
- `s2s doctor` now checks that the configured API key env var is set when running in standalone mode.
- Standalone `s2s stage` now updates `.s2s/live.md` with the result status and next action after the run completes.

### Repo Governance Changes

- Bumped product version to 0.2.34.

## 0.2.33

### Product Changes

- Removed `CLIProvider` (`src/providers/cli.ts` deleted) and all `mode: 'cli'` dead code. The CLI provider was the broken path that caused ETIMEDOUT errors when s2s tried to spawn `codex`/`claude` as a subprocess from inside a chat session. Chat-native mode (default) never calls any LLM; standalone mode uses direct API providers only.
- Removed `'cli'` from `LLMProviderConfig.mode` union type (`src/types/index.ts`). Only `'api'` and `'openai_compatible'` are now valid standalone modes.
- `s2s config edit` no longer offers `cli` as an LLM mode option. Default is now `api`.
- `s2s init` / `s2s update` no longer preserve or normalize `mode: 'cli'` in existing `llm.json` files on project refresh.

### Repo Governance Changes

- Bumped product version to 0.2.33.

## 0.2.32

### Product Changes

- Added `.s2s/protocol.md`: generated command reference written by `s2s init` and `s2s update`. Covers all active commands with purpose, arguments, flags, inputs, outputs, next-action, and examples. Excluded: `execute` and `resume` stub redirects.
- Rewrote `.s2s/guardrails/AGENTS.md`, `CODEX.md`, and `CLAUDE.md` templates to compact pointer-based format (under 35 lines each). New format: session orientation via `live.md`, two-phase stage pattern (4 steps), pointers to `live.md` and `protocol.md`, and a prohibition list (4 rules). Removes verbose procedure repetition that cost unnecessary tokens per session.
- `s2s doctor` now checks: `protocol.md` exists, `protocol.md` version matches CLI, `live.md` exists, and governance templates use the current pattern (live.md pointer present).
- `s2s update` ensures `live.md` exists after update — creates it with idle state if missing (migration path for projects initialized before Phase 2).

### Repo Governance Changes

- Bumped product version to 0.2.32.

## 0.2.31

### Product Changes

- Added `s2s stage <stage> --submit`: records artifact completion, runs quality checks, and advances ledger state. If score ≥ threshold: auto-approves and prints next stage. If score < threshold: prints issues. If approval required: creates a gate and prints `s2s approve / s2s reject` instruction.
- If the required artifact is missing, `--submit` exits with a clear message naming the file path.
- Added `quality` config block to `RuntimeConfig` (`enabled`, `minAutoApproveScore` default 0.85, `blockOnFailure` default false).
- `s2s config edit` now prompts for quality threshold and block-on-failure settings.
- `.s2s/live.md` is updated to `submitted`, `gate_pending`, or `context_delivered` (quality fail) after `--submit`.

### Repo Governance Changes

- Bumped product version to 0.2.31.

## 0.2.30

### Product Changes

- Fixed CI failure in `check:engineering-exec-run-lifecycle`: moved the `dryRun` early-return before the `just` availability check in `runEngineeringWorker`. Dry-run mode never invokes `just`, so the check was spuriously throwing on environments without it installed (e.g., GitHub Actions runners).

### Repo Governance Changes

- Bumped product version to 0.2.30.

## 0.2.29

### Product Changes

- `s2s stage <stage>` in chat-native mode now outputs a structured **context package** instead of a placeholder. The output includes `=== S2S TASK: <stage> ===` with OBJECTIVE, CONTEXT (input artifacts), Orchestrator decision, Governance constraints, ARTIFACT SPECIFICATION, and WHEN DONE instruction. The chat AI reads this and generates the artifact in-context.
- Added `s2s stage <stage> --context` flag: outputs the same context package without updating `.s2s/live.md`. Useful for re-reading the task spec without triggering a state change.
- Added `.s2s/live.md`: a compact, always-current file written by s2s after every state-changing command (`s2s request`, `s2s stage`, `s2s approve`, `s2s reject`). Created with `status: none` on `s2s init`. The AI reads it to orient without re-running anything.
- Added `verbose` field to `RuntimeConfig`. When `false`, suppresses `[s2s]` prefix lines from stage output. Default: `true`.
- `engineering_exec` stage is unchanged for Phase 2 — it continues to spawn the configured execution template. Re-evaluation deferred to a future phase.

### Repo Governance Changes

- Bumped product version to 0.2.29.

## 0.2.28

### Product Changes

- `s2s stage <stage>` now operates in **chat-native mode** by default. Instead of spawning a CLI binary as a subprocess (which caused ETIMEDOUT errors), the command prints a placeholder message and returns. The chat AI running in the same session handles artifact generation natively. Full context package output arrives in Phase 2.
- Added `pipelineMode: 'chat-native' | 'standalone'` to `RuntimeConfig`. Defaults to `'chat-native'` for all new and existing projects. `'standalone'` (direct LLM API call) is reserved for future opt-in.
- `s2s init` no longer writes `config/llm.json` by default. The file is only written when an existing `llm.json` is present (standalone mode users). This removes the auto-configuration that triggered CLI provider invocations.

### Repo Governance Changes

- Bumped product version to 0.2.28.

## 0.2.27

### Product Changes

- Replaced plain-text root command output with a bordered box banner matching the init/session banner style. All three states (not initialized, needs repair, ready) now display consistently inside `┌─ … └─` framing with the product tagline.

### Repo Governance Changes

- Bumped product version to 0.2.27.

## 0.2.26

### Product Changes

- s2s is now chat-UI-agnostic: the preferred chat app prompt has been removed from `s2s init` and `s2s config edit`. The active chat UI is auto-detected from the environment on every invocation (`CLAUDECODE`, `CODEX_CI`/`CODEX_SHELL`, `OPENCODE` env vars) and stored as `lastDetectedClient` in project local state.
- Removed `s2s codex-cli` and `s2s claude-cli` as named launch commands. Users open their AI client directly in the project directory; s2s no longer launches chat sessions.
- Execution template selection (`execution.templateId`) is now derived from the auto-detected UI at init time and configured independently via `s2s config edit`.
- Removed `defaultChatApp` from `project.json` schema and `lastClient` from `project.local.json` schema.
- Updated shell completions to remove `codex-cli` and `claude-cli` command suggestions.
- Updated `s2s config edit` LLM CLI prompt to show binary names (`codex|claude|opencode`) instead of old command aliases.

### Repo Governance Changes

- Bumped product version to 0.2.26.

## 0.2.25

### Product Changes

- Simplified `s2s` root command output: replaced full rendered block layout with a concise plain-text summary showing version, project name, readiness state, and launch hint.
- Simplified `printInitPrerequisiteReport`: check-only mode retains the full diagnostic block layout; normal init/repair mode now prints a minimal status note instead of the full block report.
- Removed "Resolved Runtime Paths" block from post-init report; narrowed next actions to actionable steps when project is ready.
- Fixed Claude execution template args: removed `code` subcommand and `--cwd` flag; now uses `--dangerously-skip-permissions -p` for agentic runs and `--print -p` for inline LLM calls.

### Repo Governance Changes

- Bumped product version to 0.2.25.

## 0.2.24

### Product Changes

- `s2s init` now prints a product-ready banner at startup showing the CLI version, tagline, and target project path before the prerequisite report. Suppressed in `--json` mode.

### Repo Governance Changes

- Bumped product version to 0.2.24.

## 0.2.23

### Product Changes

- No product-visible behavior changes.

### Repo Governance Changes

- Added `docs/01_Tech_architecture_summary.md`: detailed technical architecture summary covering the main layers, core domain model, runtime and execution model, state and storage model, CLI behavior model, architectural strengths, and known pressure points.
- Added `docs/02_User_summary.md`: non-technical product summary covering product description, target audience, problem statement, user workflow, value proposition, differentiators, and current limitations.
- Replaced stale archived drafts (`docs/archived/full_tech_description.md`, `docs/archived/user_summary.md`) with current versions in `docs/`.
- Bumped product version to 0.2.23.

## 0.2.22

### Product Changes

- No product-visible behavior changes.

### Repo Governance Changes

- Moved `worklogs/` contents to `docs/archived/`: `business-orchestration/` and `governance-separation-implementation-temp.md` are now consolidated with the rest of the archived material for review.
- Removed empty `worklogs/` directory from the repository.
- Bumped product version to 0.2.22.

## 0.2.21

### Product Changes

- No product-visible behavior changes.

### Repo Governance Changes

- Rewrote `README.md` and `README_es.md`: leads with the request-driven workflow, replaces placeholder install instructions, consolidates command reference into a table, removes developer-only content from the top.
- Updated `PROJECT.md`: three-layer architecture model, stage-to-artifact table, updated runtime model section.
- Updated `docs/technical-architecture_en.md`: added `effectiveRoute`/`effectiveApprovalRequired` to the Ledger description; added intent-aware agent context to the orchestrator flow section.
- Rewrote `docs/arquitectura-tecnica_es.md`: full rewrite to match the English version (three-layer model, orchestrator, all modules, route accumulator, intent-aware agents).
- Updated `docs/user-manual_en.md`: added `--refine "prompt"` syntax to the daily workflow.
- Rewrote `docs/manual-usuario_es.md`: full parity with the English user manual — added `s2s request` to the daily workflow, step 4 and troubleshooting item 8, `--refine` argument syntax.
- Updated `docs/documentation-map_en.md` and `docs/documentation-map_es.md`: added all missing feature guide entries (LLM modes, execution templates, cost observability, Figma MCP, manual setup).
- Fixed adapter names in `docs/technical-operations-security_en.md` and `docs/operacion-tecnica-seguridad_es.md`: `codex` → `codex-cli`, `claude` → `claude-cli`.
- Moved stale planning and internal reference files to `docs/archived/`: both v0-2-0 and v0-3-0 plan directories, `full_tech_description.md`, `user_summary.md`, brand/monetization docs, speech/onboarding docs, learning path stubs, usage example stubs, step-by-step guide (referenced workspace bootstrap scripts that are no longer part of the product).
- Bumped product version to 0.2.21.

## 0.2.20

### Product Changes

- Internal stage agents (pm, research, design, engineering) now receive the orchestrator's decision as context: the user's original request, classified intent, recommended route, current stage position, and rationale. This allows agents to produce intent-focused artifacts rather than generic templates — a bug fix route produces a targeted output, not a full product spec.
- Stage execution prompt guard now explicitly excludes `s2s request` in addition to `s2s stage`, preventing the inner LLM from attempting to re-run intent classification.

### Repo Governance Changes

- Added `buildOrchestratorDecisionContext()` to `src/agents/base.ts`: reads `lastDecision` and `effectiveRoute` from the project ledger and injects them into every agent's context messages.
- Updated `buildManagedStageExecutionPrompt()` to include `s2s request` in the list of forbidden commands inside managed stage execution.
- Updated `loadManagedStageGovernanceContext()` to explicitly tell the inner LLM to ignore `s2s request` instructions from the injected governance files.
- Bumped product version to 0.2.20.

## 0.2.19

### Product Changes

- Governance files now instruct the AI to run `s2s request "<user message>"` before executing stages, letting the orchestrator choose the minimum sufficient route. The previous hardcoded linear sequence (`pm → research → design → engineering → engineering_exec`) is replaced with a request-driven instruction in all three guardrail files (`AGENTS.md`, `CODEX.md`, `CLAUDE.md`).
- `s2s stage <stage> --refine` now accepts an optional argument: `s2s stage pm --refine "add dark mode"`. When provided, the refinement prompt is forwarded to `initializeSpec` as the real intent rather than the generic synthetic fallback, giving the orchestrator accurate signal for route classification.

### Repo Governance Changes

- Updated all three governance renderers in `src/governance/user-project/renderers.ts` to emit request-driven instructions.
- Added `refinePrompt?: string` to `CLISharedFlags` in `src/types/index.ts`.
- Updated `--refine` flag parser in `src/cli.ts` to accept an optional argument.
- Bumped product version to 0.2.19.

## 0.2.18

### Product Changes

- No product-visible behavior changes.

### Repo Governance Changes

- Fixed guardrail conflict detector false-positives on negated instructions. Prohibition phrases such as "Do NOT skip s2s request" were triggering `severity: fail` rules because the regex matched the trigger word without checking for a preceding negation. Added `isNegatedMatch()`: if the 25 characters before the matched trigger word end with "not", "don't", "never", "must not", "do not", or "should not", the match is suppressed. This unblocks the governance request-driven workflow change, which must emit prohibition instructions that include the words `skip` and `s2s`.
- Bumped product version to 0.2.18.

## 0.2.17

### Product Changes

- Orchestration decisions are now accumulated additively across refinements. `WorkLedger` gains `effectiveRoute` (union of all stage routes for the active change, in pipeline order) and `effectiveApprovalRequired` (true if any past decision required human approval). Both reset when a new change is created. `advanceStageOwnership` now uses the effective route and effective approval flag instead of only the last decision, so stages and approval gates from earlier decisions are preserved across refinements.

### Repo Governance Changes

- Added `effectiveRoute` and `effectiveApprovalRequired` to `WorkLedger` in `src/types/index.ts` and `LedgerAggregationOptions` in `src/ledger/status.ts`.
- Added `mergeRoutes()` helper and `PIPELINE_STAGE_ORDER` constant to `src/orchestration/router.ts`.
- Removed unused `shouldHoldForApproval()` helper (logic inlined into `advanceStageOwnershipFromDecision`).
- Fixed shell injection vector in `commandExists`: replaced `spawnSync('bash', ['-lc', \`command -v ${command}\`])` with a PATH-walk using `accessSync`. No bash string interpolation occurs; command names with shell metacharacters are rejected before lookup.
- Removed duplicate private `commandExists` from `src/cli.ts`; both call sites now use the shared `commandExists` from `src/runtime/shell.ts`.
- Bumped product version to 0.2.17.

## 0.2.16

### Product Changes

- After a stage completes, `s2s stage` now suggests the next stage in the orchestrator's route in the Next Actions block (e.g., "Run `s2s stage engineering` to continue the orchestrated route.").

### Repo Governance Changes

- Bumped product version to 0.2.16.

## 0.2.15

### Product Changes

- `s2s stage` now asks for confirmation when the requested stage is not in the orchestrator's recommended route. In interactive terminals, the user is prompted "Run '<stage>' anyway? [y/N]". If declined, the stage is skipped and the next recommended stage is suggested. In non-interactive mode or with `--yes`, the stage proceeds without prompting.

### Repo Governance Changes

- Bumped product version to 0.2.15.

## 0.2.14

### Product Changes

- When a requested stage is not in the orchestrator's recommended route, `s2s stage` now prints the orchestrator's skip reason as a warning (e.g., "Skip research because the route has no unresolved technical investigation work") and notes that it's proceeding anyway because the stage was explicitly requested.

### Repo Governance Changes

- Bumped product version to 0.2.14.

## 0.2.13

### Product Changes

- `s2s stage` now prints the orchestrator's intent classification and recommended route before executing, so users can see what the orchestrator decided. When the requested stage is not in the recommended route, a note is printed.

### Repo Governance Changes

- Bumped product version to 0.2.13.

## 0.2.12

### Product Changes

- No product behavior changes. Internal refactoring only.

### Repo Governance Changes

- Extracted backup/restore helpers into `src/cli/project/backups.ts` (~321 lines): `createGlobalProjectBackup`, `restoreGlobalProjectBackup` helpers, `maybeCreateStartupBackup`, `latestGlobalProjectBackupInfo`, `backupRootAdaptersBeforeMutation`, `touchProjectLastUsed`, `buildManagedStateSignature`, `listFilesRecursively`, etc.
- CLI decomposition step 8.
- Bumped product version to 0.2.12.

## 0.2.11

### Product Changes

- No product behavior changes. Internal refactoring only.

### Repo Governance Changes

- Extracted interactive prompt system into `src/cli/io/prompts.ts` (~248 lines): `promptYesNoInteractive`, `promptYesNoSync`, `askEnumeratedOption`, `askWithDefault`, `askPrompt`, `confirmStateChangingCommand`, `canPromptForMissingInput`, scripted stdin state, and all supporting helpers.
- CLI decomposition step 7 of 8.
- Bumped product version to 0.2.11.

## 0.2.10

### Product Changes

- No product behavior changes. Internal refactoring only.

### Repo Governance Changes

- Extracted client/provider utilities into `src/cli/utils/client-provider.ts` (~155 lines): `normalizeClient`, `chatAppProvider`, `resolveCLICommandForClient`, `defaultLLMArgs`, `normalizePendingProjectUpdate`, etc.
- Extracted config/state helpers into `src/cli/project/config.ts` (~126 lines): `readLocalState`, `writeLocalState`, `defaultRuntimeConfig`, `defaultLLMConfig`, `defaultExecutionTemplates`.
- Extracted guardrail helpers into `src/cli/project/guardrails.ts` (~55 lines): `normalizeGuardrailPolicy`, `enforceGuardrailPolicyForExecution`, `getGovernanceConflictView`, `printGuardrailConflictSummary`.
- CLI decomposition step 6 of 8.
- Bumped product version to 0.2.10.

## 0.2.9

### Product Changes

- No product behavior changes. Internal refactoring only.

### Repo Governance Changes

- Extracted project registry functions into `src/cli/project/registry.ts` (~129 lines): `loadRegistry`, `saveRegistry`, `updateRegistryForProject`, `removeProjectFromRegistryByPath`, `sanitizeRegistryProjects`, `dedupeAlias`, `registryPath`. CLI decomposition step 5 of 8.
- Bumped product version to 0.2.9.

## 0.2.8

### Product Changes

- No product behavior changes. Internal refactoring only.

### Repo Governance Changes

- Updated CLI decomposition plan with progress status and honest assessment of remaining work.
- Bumped product version to 0.2.8.

## 0.2.7

### Product Changes

- No product behavior changes. Internal refactoring only.

### Repo Governance Changes

- Extracted `handleCompletionCommand` and all completion script renderers (bash/zsh/fish) into `src/cli/handlers/completion.ts` (~230 lines). CLI decomposition step 4 of 8.
- Bumped product version to 0.2.7.

## 0.2.6

### Product Changes

- No product behavior changes. Internal refactoring only.

### Repo Governance Changes

- Extracted all CLI-local types, interfaces, and constants into `src/cli/types.ts` (~171 lines). This creates the shared foundation that all future decomposition steps import from.
- CLI decomposition step 3 of 8.
- Bumped product version to 0.2.6.

## 0.2.5

### Product Changes

- No product behavior changes. Internal refactoring only.

### Repo Governance Changes

- Extracted CLI state management (`getActiveCLIFlags`, `setActiveCLIFlags`, `createDefaultCLISharedFlags`) into `src/cli/io/state.ts`.
- Extracted output helpers (`failCLI`, `printJson`, `commandMeta`, `printVerboseContext`, `warnOrchestrator`) into `src/cli/io/output.ts`.
- CLI decomposition step 2 of 8.
- Bumped product version to 0.2.5.

## 0.2.4

### Product Changes

- No product behavior changes. Internal refactoring only.

### Repo Governance Changes

- Extracted pure utility functions from `cli.ts` into `src/cli/utils/` modules: `paths.ts` (path resolution, ~116 lines), `versioning.ts` (semver, timestamps, ~55 lines), `file-io.ts` (JSON/file operations, ~43 lines). CLI decomposition step 1 of 8.
- Bumped product version to 0.2.4.

## 0.2.3

### Product Changes

- Removed legacy pipeline state writes: `pipeline-state.json` is no longer written during `initProject`, `runStage`, or `engineering_exec`. The operational model (Change/Spec/Slice/Run/Gate/Ledger) is now the single source of truth for workflow state. Legacy `pipeline-state.json` is still read as a fallback for projects initialized before v0.2.0.

### Repo Governance Changes

- Updated improvement backlog to mark item #1 as done.
- Bumped product version to 0.2.3.

## 0.2.2

### Product Changes

- Added `s2s request "<prompt>"` command: submits a freeform work request to the Flow Orchestrator, which classifies intent, plans the minimum stage route, and creates/reuses Change and Spec entities. Supports `--json` for machine-readable output.
- Added orchestrator failure logging: non-fatal orchestrator errors are now logged to `.s2s/logs/orchestrator.log` and surfaced to stderr with `--verbose`, replacing silent empty catches.

### Repo Governance Changes

- Added `request` to the public help topics and README command surface.
- Created `docs/v0-2-0_plan/v0-2-x-improvements.md` improvement backlog.
- Bumped product version to 0.2.2.

## 0.2.1

### Product Changes

- Added `--refine` flag to `s2s stage` so users can trigger refinement on an active change (e.g., `s2s stage pm --refine`).
- `feature_refinement` intent now reuses the active change instead of creating a new one, enabling additive spec versions through the orchestrator.
- Refinement flow is tested end-to-end in `check:orchestrated-stage-flow`.

### Repo Governance Changes

- Updated PRD §8.6 iterate status to reflect that refinement is now surfaced via `--refine` flag.
- Bumped product version to 0.2.1.

## 0.2.0

### Product Changes

- Wired the Flow Orchestrator into the CLI `stage` command: `initializeSpec` creates Change/Spec entities on first stage run, `advanceStageOwnership` advances stage status after each stage completes.
- Auto-derive slices after engineering stage using TechSpec.md + Backlog.md via `deriveAndPersistSlices`.
- Auto-create approval gates via `createWorkGate` when the orchestrator holds for human review.
- Fixed environment-sensitive test failures in `check:readiness-model` and `check:init-prerequisites` by pinning explicit `uiTarget` in test sandboxes.
- Fixed source-repo root output: unsupported repos no longer see `s2s init` in common commands.
- Formally deferred the `iterate` stage from the v0.2.0 CLI surface; refinement is handled through `spec_revision` and `feature_refinement` intents.
- Reworded README/README_es intro from "chat-first" to "CLI SDLC orchestrator" to match PRD positioning.

### Repo Governance Changes

- Added `check:orchestrated-stage-flow` end-to-end test to the default release gate.
- Updated PRD, implementation plan, recovery plan, execution tracker, and validation status to reflect post-recovery orchestrator wiring.
- Bumped product version to 0.2.0.

## 0.1.64

### Product Changes

- Re-ran the full release gate on top of the repaired RP1-RP5 scope, including the external-repo CLI contract smoke and the deterministic slice-first execution happy path, and confirmed the recovered 0.2.0 surface is release-ready.

### Repo Governance Changes

- Added `docs/v0-2-0_plan/codex_developer_prompt_rp6.md` from the shared developer prompt template for the RP6 recovery assignment.
- Updated the PRD, implementation plan, recovery tracker, execution tracker, and English/Spanish READMEs so the final command surface, worktree-root contract, and release-validated happy path are all documented truthfully.
- Synchronized repo metadata to product version `0.1.64`.

## 0.1.63

### Product Changes

- Added release-focused regression coverage so the post-init `s2s status` surface, kept operational commands, and the full change/spec/slice/execution happy path are all locked to the repaired operational model.
- Expanded the validation path to cover the default Worktrunk provider root contract under `~/.s2s/worktrees/<project>/`, and wired that check into the default `npm run check` release gate.

### Repo Governance Changes

- Added `docs/v0-2-0_plan/codex_developer_prompt_rp5.md` from the shared developer prompt template for the RP5 recovery assignment.
- Updated the recovery and execution trackers plus the maintainer README so RP5 records the expanded release-validation scope and `npm run check` is documented as the default release path.
- Synchronized repo metadata to product version `0.1.63`.

## 0.1.62

### Product Changes

- Replaced the `research` stage's UX-interview artifact contract with an SDLC-only technical-investigation brief, and updated validation plus CLI wording to match the PRD.
- Added focused regression coverage for the research-stage prompt, `Research.md` template, and surfaced CLI help contract.

### Repo Governance Changes

- Added `docs/v0-2-0_plan/codex_developer_prompt_rp4.md` from the shared developer prompt template for the RP4 recovery assignment.
- Updated `docs/v0-2-0_plan/recovery_plan.md`, `docs/v0-2-0_plan/s2s-execution-tracker-template.md`, and `docs/v0-2-0_plan/s2s-technical-prd-final-v2.md` so the recovery trackers record RP4 completion and explicitly fold `technical_investigation` into `research`.
- Synchronized repo metadata to product version `0.1.62`.

## 0.1.61

### Product Changes

- Aligned managed runtime defaults, `s2s init`, `s2s config`, `s2s doctor`, and the repo-facing worktrees surface to the PRD's centralized `~/.s2s/worktrees/<project>/` contract.
- Added regression coverage so readiness checks and external CLI smoke validation now assert the centralized repo-scoped worktree path model.

### Repo Governance Changes

- Added `docs/v0-2-0_plan/codex_developer_prompt_rp3.md` from the shared developer prompt template for the RP3 recovery assignment.
- Updated `docs/v0-2-0_plan/recovery_plan.md` so the active release-hardening tracker reflects RP3 completion and the next ready follow-on work.
- Synchronized repo metadata to product version `0.1.61`.

## 0.1.60

### Product Changes

- Reworked `s2s status` so the surfaced workflow now derives current stage, completed progress, next actions, active runs, and executable slices from persisted change/spec/slice/run/gate state before consulting the legacy pipeline artifact.
- Expanded `s2s show` with real `slice`, `run`, and `runs` inspection paths, and tightened the existing slice/blocker guidance so the supported execution flow is presented as slice-first.
- Updated stage-success follow-up guidance and the hidden `execute` / `resume` messaging so the supported execution path points to operational slice/run state instead of legacy pipeline semantics.

### Repo Governance Changes

- Added `docs/v0-2-0_plan/codex_developer_prompt_rp2.md` from the shared developer prompt template for the RP2 recovery assignment.
- Updated `docs/v0-2-0_plan/recovery_plan.md` and `docs/v0-2-0_plan/s2s-execution-tracker-template.md` so the active release-hardening trackers reflect RP2 completion and the next ready follow-ons.
- Synchronized repo metadata to product version `0.1.60`.

## 0.1.59

### Product Changes

- Reworked `s2s status` so it stays consistent with `s2s init`: initialized repositories now report as initialized even before the first stage artifact exists, while still surfacing stored phase progress, artifact state, blockers, and next actions.
- Implemented real CLI support for `s2s show`, `s2s approve`, `s2s reject`, and `s2s worktrees list`, removed release-facing scaffold receipts from those commands, and explicitly held back `s2s execute` plus `s2s resume` until their workflow wiring is truthful.
- Updated the user-facing command surface, README help, and CLI contract coverage to match the repaired RP1 release surface.

### Repo Governance Changes

- Added `docs/v0-2-0_plan/codex_developer_prompt_rp1.md` from the shared developer prompt template for the RP1 recovery assignment.
- Updated `docs/v0-2-0_plan/recovery_plan.md` and `docs/v0-2-0_plan/s2s-execution-tracker-template.md` so the active release-hardening tracker reflects RP1 completion and the newly ready RP2/RP3 follow-ons.
- Synchronized repo metadata to product version `0.1.59`.

## 0.1.58

### Product Changes

- None.

### Repo Governance Changes

- Refreshed the 0.2.0 execution tracker and implementation plan after PR #110 merged so `P8-T3` is recorded on `main`, Phase 8 is marked complete, and the planned 0.2.0 implementation work is closed out on the main branch.
- Cleaned the remaining stale branch-review wording in `docs/v0-2-0_plan/s2s-execution-tracker-template.md` now that the final Phase 8 task is merged.
- Synchronized `docs/v0-2-0_plan/s2s-technical-prd-final-v2.md` and repo metadata to product version `0.1.58`.

## 0.1.57

### Product Changes

- Added persisted `Run.worktreePath` support plus a new exported execution-traceability record/document surface so `engineering_exec` now materializes a single request/change/spec/slice/run/branch/worktree/PR chain and records it as `ExecutionTraceability.md`.
- Expanded the Phase 8 lifecycle coverage to assert persisted worktree linkage, exported traceability record generation, and emitted traceability artifacts, and bumped the product version metadata to `0.1.57`.

### Repo Governance Changes

- Filled `docs/v0-2-0_plan/codex_developer_prompt_p8_t3.md` from the shared developer prompt template for the `P8-T3` assignment.
- Refreshed the 0.2.0 execution tracker so `P8-T3` is recorded on `codex/p8-t3-end-to-end-traceability`, the live queue is empty behind Phase 8 review, and the final handoff guidance now points to review/merge instead of another coding task.
- Synchronized `docs/v0-2-0_plan/s2s-technical-prd-final-v2.md`, `docs/v0-2-0_plan/s2s-implementation-plan-final-v2.md`, and repo metadata to product version `0.1.57`.

## 0.1.56

### Product Changes

- None.

### Repo Governance Changes

- Cleaned duplicate `0.1.55` changelog and execution-tracker entries so merged Phase 8 / Phase 11 work is represented once and the live queue is accurate again.
- Refreshed the 0.2.0 execution tracker and implementation plan after PRs #107, #108, and #109 merged so `P11` is recorded complete on `main`, `P8-T2` is recorded on `main`, and `P8-T3` becomes the only remaining ready follow-on.
- Synchronized `docs/v0-2-0_plan/s2s-technical-prd-final-v2.md` and repo metadata to product version `0.1.56`.

## 0.1.55

### Product Changes

- Extended `src/runtime/github-operator.ts` so delivery results now retain the pull request number alongside the existing URL, reusing the open PR number when branch safety reuses an existing PR and inferring the created PR number from the returned GitHub URL for fresh PRs.
- Updated `src/runtime/engineering-exec.ts` to persist the PR number and URL onto completed execution runs in the same write path that already stores the reused/open-PR safety decision.
- Expanded `scripts/test-git-delivery-policy.ts` and `scripts/test-run-lifecycle.ts` to assert the persisted PR metadata contract, and bumped the product version metadata to `0.1.55`.

### Repo Governance Changes

- Filled `docs/v0-2-0_plan/codex_developer_prompt_p8_t2.md` from the shared developer prompt template for the `P8-T2` assignment.
- Refreshed the 0.2.0 execution tracker and implementation plan so `P8-T2` is recorded on `codex/p8-t2-pr-metadata-runs`, `P8-T3` stays blocked until this branch merges, and `P11-T1` plus `P11-T4` remain the next live-ready follow-ons.
- Synchronized `docs/v0-2-0_plan/s2s-technical-prd-final-v2.md` and repo metadata to product version `0.1.55`.
- Extended orchestration backward routing so reused changes can reopen previously completed `research`, `design`, and `engineering` stages through the existing `decision.expansion` contract when new findings require stepping back before implementation continues.
- Updated the planner, stage router, and change initialization flow to persist `reopenedStages`, explain reopened-stage routing explicitly, reactivate reused changes when needed, and reset rerouted downstream stage status to `ready`.
- Expanded focused orchestration regression coverage for backward planner decisions, resumed research reroutes, reopened design routes, and reused-change initialization.
- Filled `docs/v0-2-0_plan/codex_developer_prompt_p11_t1.md` from the shared developer prompt template for the `P11-T1` assignment.
- Refreshed the 0.2.0 execution tracker so `P11-T1` is recorded in review on `codex/p11-t1-backward-routing`, `P11-T4` becomes the remaining Phase 11 follow-on, and `P8-T2` stays first on the next-ready frontier.
- Synchronized `docs/v0-2-0_plan/s2s-technical-prd-final-v2.md`, `docs/v0-2-0_plan/s2s-implementation-plan-final-v2.md`, and repo metadata to product version `0.1.55`.

## 0.1.54

### Product Changes

- None.

### Repo Governance Changes

- Cleaned duplicate `0.1.53` changelog and execution-tracker entries so merged Phase 8 / Phase 11 work is represented once and the live queue is readable again.
- Refreshed the 0.2.0 execution tracker and implementation plan after PRs #104, #105, and #106 merged so `P8-T1`, `P11-T3`, and `P11-T2` are recorded on `main`, `P8-T2` becomes the first ready follow-on, and Phase 11 is marked in progress.
- Synchronized `docs/v0-2-0_plan/s2s-technical-prd-final-v2.md` and repo metadata to product version `0.1.54`.

## 0.1.53

### Product Changes

- Added `src/ledger/gate-lifecycle.ts` with minimal persisted gate creation and resolution helpers for `spec_review`, `execution_review`, `delivery_review`, and `final_review`, including change/spec lifecycle integration plus ledger refresh on open/approve/reject/cancel flows.
- Exported the new gate-lifecycle types and helpers from `src/types/index.ts`, `src/ledger/index.ts`, and `src/index.ts`, added `scripts/test-gate-lifecycle.ts`, wired it into `npm run check`, and bumped the product version metadata to `0.1.53`.
- Persisted branch safety decisions on engineering execution delivery so run records can now distinguish reused open PRs from fresh-branch fallbacks.
- Extended the delivery-policy and run-lifecycle regression scripts to assert the persisted PR safety decision contract.

### Repo Governance Changes

- Filled `docs/v0-2-0_plan/codex_developer_prompt_p11_t3.md` from the shared developer prompt template for the `P11-T3` assignment.
- Refreshed the 0.2.0 execution tracker so `P11-T3` is recorded in draft PR #105, Phase 11 is marked in review on this branch, and `P11-T2` plus `P8-T1` remain the next ready follow-ons.
- Filled `docs/v0-2-0_plan/codex_developer_prompt_p8_t1.md` from the shared developer prompt template for the `P8-T1` assignment.
- Refreshed the 0.2.0 execution tracker so `P8-T1` is recorded on `codex/p8-t1-pr-safety-decision`, Phase 8 is marked in progress on this branch, and `P8-T2` is identified as the next Phase 8 follow-on after merge.
- Synchronized `docs/v0-2-0_plan/s2s-technical-prd-final-v2.md`, `docs/v0-2-0_plan/s2s-implementation-plan-final-v2.md`, and repo metadata to product version `0.1.53`.

## 0.1.52

### Product Changes

- None.

### Repo Governance Changes

- Refreshed the 0.2.0 execution tracker and implementation plan after PR #103 merged so `P6-T5` is recorded on `main`, Phase 6 is closed, and the next-ready frontier moves to `P8-T1` plus ready Phase 11 follow-ons.
- Synchronized `docs/v0-2-0_plan/s2s-technical-prd-final-v2.md` and repo metadata to product version `0.1.52`.

## 0.1.51

### Product Changes

- Added a typed engineering-execution handoff in `src/runtime/engineering-exec.ts` that packages the resolved persisted change/spec/slice/run scope, task subset, and `SLICE_CONTEXT.md` contract for downstream execution consumers.
- Refactored `src/runtime/engineering-worker.ts`, `src/runtime/openspec-bridge.ts`, and `src/runtime/task-executor.ts` to consume that shared handoff instead of reconstructing execution state from `Backlog.md` or generic unchecked task lines, and removed the generic validation/delivery checklist items from executor-managed task scope.
- Exported the new execution-handoff types and helper from `src/types/index.ts` and `src/index.ts`, expanded `scripts/test-engineering-exec-run-lifecycle.ts` with handoff-driven OpenSpec materialization plus synthetic task execution success/failure coverage, and bumped the product version metadata to `0.1.51`.

### Repo Governance Changes

- Filled `docs/v0-2-0_plan/codex_developer_prompt_p6_t5.md` from the shared developer prompt template for the `P6-T5` assignment.
- Refreshed the 0.2.0 execution tracker so `P6-T5` is recorded on `codex/p6-t5-worker-bridge-task-executor`, Phase 6 is marked in review on this branch, and `P8-T1` is identified as the next follow-on after merge.
- Synchronized `docs/v0-2-0_plan/s2s-technical-prd-final-v2.md`, `docs/v0-2-0_plan/s2s-implementation-plan-final-v2.md`, and repo metadata to product version `0.1.51`.

## 0.1.50

### Product Changes

- None.

### Repo Governance Changes
- Refreshed the 0.2.0 execution tracker and implementation plan after PR #102 merged so `P6-T4` is recorded on `main` and `P6-T5` is the only next-ready Phase 6 task.
- Synchronized [docs/v0-2-0_plan/s2s-technical-prd-final-v2.md](/Users/gustavochiriboga/repos/personal/spec-to-ship/docs/v0-2-0_plan/s2s-technical-prd-final-v2.md) and repo metadata to product version `0.1.50`.

## 0.1.49

### Product Changes

- Refactored `runEngineeringExecution` so `engineering_exec` always resolves a persisted slice up front: it now accepts an explicit `sliceId` or auto-selects the next executable slice from the shared selection surface before run creation begins.
- Removed the generic `ExecutionPlan.md` and `EngineeringOpenSpecDraft.md` entry artifacts from the execution entry flow, kept run creation and `SLICE_CONTEXT.md` generation bound to the resolved slice, and updated run evidence plus delivery messaging to match the slice-first contract.
- Expanded `scripts/test-engineering-exec-run-lifecycle.ts` to cover explicit-slice execution, implicit persisted-slice selection, no-executable-slice failure, and the absence of the removed generic entry artifacts.
- Bumped the product version metadata to `0.1.49`.

### Repo Governance Changes

- Filled `docs/v0-2-0_plan/codex_developer_prompt_p6_t4.md` from the shared developer prompt template for the `P6-T4` assignment.
- Refreshed the 0.2.0 execution tracker and implementation plan so `P6-T4` is recorded on `codex/p6-t4-engineering-exec-entry-flow`, `P6-T5` is identified as the next follow-on after merge, and the plan docs stay aligned with branch-local reality.
- Synchronized the current product version metadata in `docs/v0-2-0_plan/s2s-technical-prd-final-v2.md` to `0.1.49`.

## 0.1.48

### Product Changes

- None.

### Repo Governance Changes

- Refreshed the 0.2.0 planning docs after pulling merged `P6-T3` from `main`, correcting stale branch-local/review wording so Phase 6 remains in progress on `main` and `P6-T4` is the only next-ready coding task.
- Updated the execution tracker handoff, next-ready queue, phase/task rows, and merged-frontier summary so downstream agents target the already-merged `SLICE_CONTEXT.md` handoff surface instead of the stale `P6-T3` review branch.
- Bumped the product version metadata to `0.1.48` across `package.json`, `package-lock.json`, `src/cli.ts`, and the 0.2.0 planning docs.

## 0.1.47

### Product Changes

- Added a reusable `buildSliceContextDocument` helper in `src/runtime/engineering-exec.ts` that builds `SLICE_CONTEXT.md` from persisted change/spec/slice/run state, including slice scope, acceptance checks, technical constraints, spec summary, and design-context handoff when present.
- Updated `runEngineeringExecution` to emit `SLICE_CONTEXT.md` for explicit slice executions, record that artifact as run evidence, export the shared helper from `src/index.ts`, and keep the existing worker/worktree flow unchanged ahead of the later entry-flow refactor.
- Expanded `scripts/test-engineering-exec-run-lifecycle.ts` so the dry-run execution coverage now asserts the generated slice-context contract, design-aware content, and persisted evidence linkage, and bumped the product version metadata to `0.1.47`.

### Repo Governance Changes

- Filled `docs/v0-2-0_plan/codex_developer_prompt_p6_t3.md` from the shared developer prompt template for the `P6-T3` assignment.
- Refreshed the 0.2.0 execution tracker and implementation plan so `P6-T3` is recorded on `codex/p6-t3-slice-context-generation`, `P6-T4` is identified as the next execution follow-on after merge, and plan-version metadata is synchronized to `0.1.47`.
- Synchronized the current product version metadata in `docs/v0-2-0_plan/s2s-technical-prd-final-v2.md` to `0.1.47` so the branch-local planning documents stay aligned.

## 0.1.46

### Product Changes

- None.

### Repo Governance Changes

- Refreshed the 0.2.0 planning docs after pulling merged `P6-T1` and `P6-T2` from `main`, correcting stale review and branch-local wording so Phase 6 is now recorded as in progress on `main` and `P6-T3` is the only next-ready coding task.
- Updated the execution tracker handoff, next-ready queue, phase/task rows, and merged-frontier summary so downstream agents target the shared selector plus run-lifecycle baseline already on `main`.
- Bumped the product version metadata to `0.1.46` across `package.json`, `package-lock.json`, `src/cli.ts`, and the 0.2.0 planning docs.

## 0.1.45

### Product Changes

- Added `src/ledger/run-lifecycle.ts` as the shared execution-run surface, including persisted run ID derivation from explicit slice IDs, open-run protection, ledger refresh, evidence merging, and slice-state synchronization for running/verifying/succeeded/failed/blocked outcomes.
- Extended `src/runtime/engineering-exec.ts` so explicit `sliceId` targets now create and advance persisted run records through dry-run or real execution without reintroducing backlog-first slice selection, and surfaced `sliceId` / `runId` on the execution result contract.
- Exported the new run-lifecycle helpers and supporting types from `src/index.ts`, added focused ledger and dry-run execution coverage in `scripts/test-run-lifecycle.ts` plus `scripts/test-engineering-exec-run-lifecycle.ts`, wired both into `npm run check`, and bumped the product version metadata to `0.1.45`.
- Added deterministic executable-slice selection helpers in `src/ledger/selection.ts`, including explicit scope resolution to the active change/spec, candidate evaluation against ready/queued status plus completed dependencies and absent blockers, and stable sequence/priority/size tie-break ordering.
- Exported the new slice-selection contract from `src/types/index.ts`, `src/ledger/index.ts`, and `src/index.ts`, so later Phase 6 execution entry work can consume one shared persisted-slice selection surface instead of re-scanning backlog artifacts.
- Added `scripts/test-slice-selection.ts`, wired it into `npm run check`, and bumped the product version metadata to `0.1.45` across `package.json`, `package-lock.json`, and `src/cli.ts`.

### Repo Governance Changes

- Filled `docs/v0-2-0_plan/codex_developer_prompt_p6_t2.md` from the shared developer prompt template for the `P6-T2` assignment.
- Filled `docs/v0-2-0_plan/codex_developer_prompt_p6_t1.md` from the shared developer prompt template for the `P6-T1` assignment.
- Refreshed the 0.2.0 execution tracker to record `P6-T1` as merged on `main`, `P6-T2` on `codex/p6-t2-run-lifecycle`, keep Phase 6 in progress, and leave `P6-T3` gated until the run-lifecycle branch merges.

## 0.1.44

### Product Changes

- None.

### Repo Governance Changes

- Refreshed the 0.2.0 planning docs after pulling merged `P5-T5` from `main`, correcting stale branch-local wording so Phase 5 is now recorded as complete on `main` and Phase 6 is marked ready.
- Updated the execution tracker handoff, next-ready queue, and phase/task status rows so downstream agents target `P6-T1` and `P6-T2` on the persisted slice surface instead of the stale branch-local `P5-T5` frontier.
- Bumped the product version metadata to `0.1.44` across `package.json`, `package-lock.json`, `src/cli.ts`, and the 0.2.0 planning docs.

## 0.1.43

### Product Changes

- Added exported slice-persistence helpers on top of `deriveSlicePlan`, including spec-scoped persisted slice IDs, stored `sliceKey` / `sourceTaskIds` / `taskSubset` / `implementationNotes` context on `WorkSlice`, and direct ledger refresh from the persisted slice set.
- Mapped derived plan slices into explicit `WorkSlice` JSON artifacts with deterministic `ready` / `queued` / `blocked` status derivation, persisted dependency IDs, and preserved terminal lifecycle state when slice plans are regenerated.
- Cancelled superseded non-terminal slices instead of deleting history, blocked regenerated plans from silently removing in-progress slices, expanded the slice-derivation contract coverage around persisted artifacts/ledger updates/cross-spec ID uniqueness, and bumped the product version metadata to `0.1.43`.

### Repo Governance Changes

- Filled `docs/v0-2-0_plan/codex_developer_prompt_p5_t5.md` from the shared developer prompt template for the `P5-T5` assignment.
- Refreshed the 0.2.0 execution tracker and implementation plan to record Phase 5 as complete on `codex/p5-t5-persist-slices-ledger`, open `P6-T1` plus `P6-T2` as the next-ready work, and synchronize the planning docs to version `0.1.43`.

## 0.1.42

### Product Changes

- None.

### Repo Governance Changes

- Refreshed the 0.2.0 planning docs after pulling merged `P5-T4` and `P4-T4` from `main`, correcting the stale review state so Phase 4 is now recorded as complete and `P5-T5` is the only next-ready coding task.
- Updated the execution tracker handoff, next-ready queue, and phase/task status rows so downstream agents target the real post-merge frontier instead of the stale `P4-T4` review state.
- Bumped the product version metadata to `0.1.42` across `package.json`, `package-lock.json`, `src/cli.ts`, and the 0.2.0 planning docs.

## 0.1.41

### Product Changes

- Added a persisted `designContext` handoff on `Spec` plus a shared resolver/export surface so downstream planning and execution consumers can reference linked design artifacts and the captured design-stage summary without inventing new UI behavior.
- Exposed the same design handoff through resolved project context, expanded design/linkage and context-resolver coverage, and wired the context-resolver contract script into `npm run check`.
- Added deterministic slice-plan derivation in `src/ledger/derive-slices.ts` on top of the exported draft-slice surface, including explicit task-subset items, dependency-key assignment, stable topological sequencing with priority-aware tie breaks, and blockers/warnings for missing or cyclic dependencies.
- Exported the new `deriveSlicePlan` helper plus the explicit task-subset contract from `src/ledger/index.ts`, `src/index.ts`, and `src/types/index.ts`, and expanded `scripts/test-slice-derivation-contract.ts` to lock the new sequencing/dependency behavior.
- Bumped the product version metadata to `0.1.41` across `package.json`, `package-lock.json`, `src/cli.ts`, and the 0.2.0 planning docs.

### Repo Governance Changes

- Filled `docs/v0-2-0_plan/codex_developer_prompt_p4_t4.md` from the shared developer prompt template for the `P4-T4` assignment.
- Refreshed the 0.2.0 execution tracker after implementing `P4-T4` on `codex/p4-t4-design-context-handoff`, leaving `P5-T4` as the next clean execution-critical follow-on after this branch.
- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p5_t4.md` assignment prompt and refreshed the 0.2.0 execution tracker to record `P5-T4` on `codex/p5-t4-sequence-dependencies-task-subsets`, keep `P4-T4` as the clean parallel follow-on on `main`, and note that `P5-T5` becomes ready after this branch merges.
- Corrected the Phase 10 planning artifacts so `P10-T4` and the full CLI UX finalization phase are recorded as merged/completed on `main` via PR #94.
- Refreshed `docs/v0-2-0_plan/codex_developer_prompt_p10_t4.md` so the stored assignment values match the requested `P10-T4` handoff inputs.

## 0.1.40

### Product Changes

- Bumped the product version metadata to `0.1.40` across `package.json`, `package-lock.json`, `src/cli.ts`, and the 0.2.0 planning docs.

### Repo Governance Changes

- Refreshed the 0.2.0 execution tracker, implementation plan, and technical PRD to keep version metadata and the latest merged-frontier handoff truthful after the PR #92 through PR #94 wave on `main`.

## 0.1.39

### Product Changes

- Tightened CLI prompt wrappers so guided commands now fail fast when neither an interactive terminal nor scripted stdin answers are available, instead of silently accepting defaults in non-interactive runs.
- Routed supported state-changing confirmations through the same prompt-availability checks so piped stdin answers work consistently with the shared confirmation helpers.
- Refreshed `scripts/test-cli-v1-contract.sh`, `README.md`, and `README_es.md` to lock the new terminal-detection contract, guided-init behavior, and wrapper-prefix fallback messaging.
- Bumped the product version metadata to `0.1.39` across `package.json`, `package-lock.json`, `src/cli.ts`, and the 0.2.0 planning docs.

### Repo Governance Changes

- Filled `docs/v0-2-0_plan/codex_developer_prompt_p10_t4.md` from the shared developer prompt template for the `P10-T4` assignment.
- Refreshed the 0.2.0 execution tracker and implementation plan on top of merged `P5-T3` and `P4-T3`, recording `P10-T4` as implemented on `codex/p10-t4-prompt-wrappers-terminal-detection` and leaving `P5-T4` plus `P4-T4` as the remaining ready follow-ons after merge.

## 0.1.38

### Product Changes

- Moved the design-invocation signal matcher into `src/agents/design.ts`, expanded it to cover feature-flow, asset-requirement, information-architecture, and CLI-UX requests, and exported the shared helpers from `src/index.ts` so later orchestrator work can reuse one design-stage surface.
- Updated `src/orchestrator/flow-planner.ts` and `src/orchestrator/stage-router.ts` so design reuse now follows the current spec context, preferring explicit `Spec.designDefinition` linkage and only falling back to the preserved primary design artifact on that spec instead of skipping design from arbitrary raw project files.
- Expanded `scripts/test-flow-planner.ts` and `scripts/test-stage-router.ts` with regression coverage for both cases: raw `PrototypeSpec.md`/`FigmaLink.json` files without linked spec context still invoke `design`, while a spec that already carries the linked design definition lets the route skip `design`.
- Bumped the product version metadata to `0.1.38` across `package.json`, `package-lock.json`, `src/cli.ts`, and the execution tracker docs.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p4_t3.md` assignment prompt and refreshed the 0.2.0 execution tracker on top of merged `P5-T3`, recording `P4-T3` on `codex/p4-t3-design-invocation-alignment` and leaving `P5-T4`, `P4-T4`, and `P10-T4` as the next clean follow-ons on refreshed `main`.

## 0.1.37

### Product Changes

- Added deterministic draft-slice derivation in `src/ledger/derive-slices.ts`, including stable slice keys, estimate-to-size inference, backlog/change scope fallback handling, ordered tech-spec implementation notes, and exported helper surfaces for later Phase 5 work.
- Expanded `scripts/test-slice-derivation-contract.ts` to cover draft derivation, size inference, fallback scope behavior, and duplicate backlog-ID rejection.
- Bumped the product version metadata to `0.1.37` across `package.json`, `package-lock.json`, `src/cli.ts`, and the execution tracker docs.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p5_t3.md` assignment prompt and refreshed the 0.2.0 execution tracker so `P5-T3` is recorded on `codex/p5-t3-derive-slices` and `P5-T4` is now the next critical-path follow-on.

## 0.1.36

### Product Changes

- Bumped the product version metadata to `0.1.36` across `package.json`, `package-lock.json`, `src/cli.ts`, and the 0.2.0 planning docs.

### Repo Governance Changes

- Refreshed the 0.2.0 execution tracker, implementation plan, and technical PRD after PR #89, PR #90, and PR #91 merged, recording `P4-T1`, `P5-T2`, and `P10-T7` as merged and moving the next-ready queue to `P5-T3`, remaining Phase 4 follow-ons, and the final clean CLI task.

## 0.1.35

### Product Changes

- Bumped the product version metadata to `0.1.35` across `package.json`, `package-lock.json`, `src/cli.ts`, and the 0.2.0 planning docs.

### Repo Governance Changes

- Refreshed the 0.2.0 execution tracker, implementation plan, and technical PRD after PR #86, PR #87, and PR #88 merged, advancing Phase 4 and Phase 5 to `in_progress`, recording `P10-T6` as merged, and moving the next-ready queue to `P5-T2`, Phase 4 follow-ons, and the remaining clean CLI work.

## 0.1.34

### Product Changes

- Added `s2s completion` to `src/cli.ts`, including bash/zsh/fish completion script output, shell inference from `$SHELL`, and `--json` support for the completion payload when needed for tooling.
- Expanded the top-level help surface so `s2s help` now documents the completion command and install path, every active help topic includes concrete examples, and top-level commands like `s2s status --help` and `s2s show --help` resolve back through the registered help topics.
- Refreshed `scripts/test-cli-v1-contract.sh` to lock the new command-local help behavior plus the bash/zsh/fish completion output contract, and updated `README.md` / `README_es.md` so the published CLI surface documents help discovery and shell completion installation.
- Bumped the product version metadata to `0.1.34` across `package.json`, `package-lock.json`, and `src/cli.ts`.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p10_t6.md` assignment prompt and refreshed the 0.2.0 execution tracker for the rebased `codex/p10-t6-help-examples-completion` branch after `P4-T2` and `P5-T1` merged on `main`.

## 0.1.33

### Product Changes

- Added a shared slice-derivation contract in `src/types/index.ts` and `src/ledger/derive-slices.ts`, including versioned engineering artifact constants, typed derivation input/plan shapes, and normalization helpers that later Phase 5 tasks can reuse without touching execution runtime code.
- Tightened `src/agents/engineering.ts` so `TechSpec.md` keeps exact derivation headings while `Backlog.md` now emits deterministic row IDs, dependency references, acceptance checks, and path-scope columns suitable for later parsing.
- Added `scripts/test-slice-derivation-contract.ts`, wired it into `npm run check`, and exported the new derivation helpers/constants from `src/index.ts`.
- Bumped the product version metadata to `0.1.33` across `package.json`, `package-lock.json`, and `src/cli.ts`.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p5_t1.md` assignment prompt and refreshed the 0.2.0 execution tracker for the rebased `codex/p5-t1-derivation-contract` branch after `P4-T2` merged on `main`.

## 0.1.32

### Product Changes

- Added a shared primary-design artifact constant in `src/agents/design.ts` so the design stage and downstream lifecycle code agree that `PrototypeSpec.md` is the canonical design-definition anchor when it exists.
- Updated `src/orchestration/router.ts` so completed `design` stage ownership persists `Spec.designDefinition` alongside the existing `sourceArtifacts` linkage, preserving the full design artifact set while giving later phases an explicit spec-level pointer.
- Exported the new design linkage constant from `src/index.ts`, added `scripts/test-design-spec-linkage.ts`, and extended `scripts/test-source-artifact-linkage.ts` so the design-to-spec contract is covered directly in the lifecycle suite.
- Bumped the product version metadata to `0.1.32` across `package.json`, `package-lock.json`, `src/cli.ts`, and the 0.2.0 planning docs.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p4_t2.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `codex/p4-t2-design-spec-linkage` branch.

## 0.1.31

### Product Changes

- Bumped the product version metadata to `0.1.31` across `package.json`, `package-lock.json`, `src/cli.ts`, and the 0.2.0 planning docs.

### Repo Governance Changes

- Refreshed the 0.2.0 execution tracker, implementation plan, and technical PRD after PR #83, PR #84, and PR #85 merged, advancing Phase 3 to done and the next-ready queue to Phase 5, Phase 4, and the remaining clean CLI follow-ons.

## 0.1.30

### Product Changes

- Added a shared global CLI flag parser in `src/cli.ts` for `--json`, `--dry-run`, `--yes`, `--no-input`, `--verbose`, `--debug`, `--repo`, and `--config`, and layered it onto the renderer-based command surface already merged on `main`.
- Expanded the current command handlers so root/status/doctor/list/init can emit machine-readable JSON, explicit repo overrides can target the active project commands, and state-changing flows like `update`, `restore`, and `remove` now honor `--yes`, `--dry-run`, and `--no-input` consistently.
- Kept the human-readable renderer output from `src/output/renderers.ts` intact while making the scaffold receipts and operational commands JSON-aware, and refreshed `scripts/test-cli-v1-contract.sh` to lock the merged flag-contract behavior.
- Updated `README.md` and `README_es.md` so the published CLI surface now documents the shared global flags and the new JSON/dry-run options on the active commands.
- Bumped the product version metadata to `0.1.30` across `package.json`, `package-lock.json`, and `src/cli.ts`.

### Repo Governance Changes

- Refreshed the 0.2.0 execution tracker after the `origin/main` merge so Phase 10 now records `P10-T3` as merged and `P10-T5` as the active review branch on top of that baseline.

## 0.1.29

### Product Changes

- Added a shared CLI output-renderer module in `src/output/renderers.ts`, exported its typed renderer contract from `src/types/index.ts` / `src/index.ts`, and standardized summary, status, warnings, next-actions, doctor, phase-progress, and artifact-tree blocks behind one public surface.
- Reworked `src/cli.ts` so the root `s2s`, `s2s init`, `s2s status`, `s2s stage`, `s2s doctor`, and the scaffolded `show` / `execute` / `resume` / `approve` / `reject` / `worktrees` verbs now render through the shared output layer instead of ad hoc strings or raw JSON.
- Added `scripts/test-output-renderers.ts`, expanded `scripts/test-cli-v1-contract.sh`, and wired the new renderer coverage into `npm run check` to lock the shared block formatting plus the updated command-surface contract.
- Updated `README.md` and `README_es.md` so the published CLI surface now documents the standardized renderer outputs and scaffold receipts.
- Bumped the product version metadata to `0.1.29` across `package.json`, `package-lock.json`, `src/cli.ts`, and the 0.2.0 planning docs.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p10_t3.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `codex/p10-t3-output-renderers` branch, including the handoff from renderer completion toward `P10-T5`, `P10-T6`, and `P10-T7`.

## 0.1.28

### Product Changes

- Updated `advanceStageOwnership` / `advanceStageOwnershipFromDecision` in `src/orchestration/router.ts` so lifecycle-bearing stages now promote approval-free changes/specs out of draft and hold approval-required routes in `in_review` / `review_ready` without auto-advancing the next stage before review.
- Expanded `StageOwnershipUpdateResult` in `src/types/index.ts` with `approvalReady`, added `scripts/test-approval-ready-transitions.ts`, and refreshed the existing stage-ownership/source-artifact coverage plus `npm run check` wiring to lock the new review-hold behavior.
- Bumped the product version metadata to `0.1.28` across `package.json`, `src/cli.ts`, and the 0.2.0 planning docs.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p3_t5.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `codex/p3-t5-approval-ready-transitions` branch, including the new follow-on readiness toward Phase 4 / Phase 5 once `P3-T5` merges.

## 0.1.27

### Product Changes

- Reserved the PRD top-level CLI verbs in `src/cli.ts` for `show`, `execute`, `resume`, `approve`, `reject`, and `worktrees`, and wired each to bounded usage/help scaffolds instead of leaving them as unknown commands.
- Expanded `scripts/test-cli-v1-contract.sh` to lock the new command-tree help topics and scaffolded failure contract so later CLI work can build on a stable top-level surface.
- Updated `README.md` and `README_es.md` so the published command surface now reflects the read-only root `s2s` behavior plus the newly registered operational command entrypoints.
- Bumped the product version metadata to `0.1.27` across `package.json`, `src/cli.ts`, and the 0.2.0 planning docs.
- Updated `advanceStageOwnership` / `advanceStageOwnershipFromDecision` in `src/orchestration/router.ts` so completed PM, research, design, and engineering stages now link their resolved human-readable artifacts back onto the owning spec’s `sourceArtifacts` instead of only persisting stage summaries.
- Expanded the lifecycle contract in `src/types/index.ts` so `StageOwnershipUpdateResult` now exposes `linkedSourceArtifacts`, allowing downstream consumers to inspect which artifacts were attached for the completed stage without re-reading the artifact tree.
- Added `scripts/test-source-artifact-linkage.ts`, refreshed `scripts/test-stage-ownership.ts`, and wired the new artifact-linkage coverage into `npm run check` to lock source-artifact accumulation, stage replay, and no-artifact fallback behavior.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p10_t2.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `codex/p10-t2-command-tree` branch, including the new follow-on readiness toward `P10-T3`, `P10-T5`, and `P10-T6`.
- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p3_t4.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `codex/p3-t4-source-artifact-linkage` branch, including the new lifecycle handoff from `P3-T4` review toward `P3-T5`.

## 0.1.26

### Product Changes

- Reworked the root `s2s` entrypoint in `src/cli.ts` so it now renders a read-only status/help surface with repository context, `.s2s` health, recommended next command, and explicit chat-launch hints instead of auto-initializing and launching chat.
- Updated `assessLightweightPrerequisites` in `src/runtime/readiness.ts` to inspect the managed `.s2s/config/runtime.json` layout, report local-state presence explicitly, and recommend `s2s init`, `s2s doctor`, or `s2s stage pm` from the shared readiness contract.
- Reused the shared expected-runtime helper in `src/runtime/init-prerequisites.ts`, expanded the exported public contract in `src/types/index.ts` / `src/index.ts`, and refreshed `scripts/test-lightweight-prerequisites.ts` plus `scripts/test-cli-v1-contract.sh` to lock the new root-command behavior.
- Updated `README.md` and `README_es.md` so Quick Start and desktop onboarding now describe `s2s` as the lightweight entrypoint and `s2s init` as the explicit state-changing setup command.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p10_t1.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `codex/p10-t1-root-command-behavior` branch, including the new P10 handoff toward `P10-T2` while `P3-T4` remains the next lifecycle follow-on.

## 0.1.25

### Product Changes

- Added `advanceStageOwnership` / `advanceStageOwnershipFromDecision` in `src/orchestration/router.ts` so completed stage outputs now update the initialized change/spec pair, mark the completed stage as `done`, promote the next routed stage to `ready`, and persist stage summaries onto the owning spec without re-inferring ownership from whichever change is merely active.
- Expanded the public 0.2.0 lifecycle contract in `src/types/index.ts` and `src/index.ts` with the new `StageOwnershipUpdateResult` surface for downstream stage integrations.
- Added `scripts/test-stage-ownership.ts` and wired `check:stage-ownership` into `npm run check` to cover stage advancement, decision replay, and resume flows that must not bind output to the wrong active change.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p3_t3.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `codex/p3-t3-stage-ownership-updates` branch, including the handoff to `P3-T4`.

## 0.1.24

### Product Changes

- Added `initializeSpec` / `initializeSpecFromDecision` in `src/orchestration/router.ts` so Phase 3 can create or reuse a persisted `Spec` on top of the shared change-init flow, relink the active spec onto the owning change, and stay idempotent for repeated orchestration-decision replay.
- Expanded the public 0.2.0 contract in `src/types/index.ts` and `src/index.ts` with the new `SpecInitializationResult` surface for downstream lifecycle consumers.
- Added `scripts/test-spec-initialization.ts` and wired `check:spec-initialization` into `npm run check` to cover new-spec creation, persisted-decision replay, resumed specless changes, and existing-spec reuse behavior.
- Extended `InitPrerequisiteReport` in `src/runtime/init-prerequisites.ts` with a derived post-init summary, readiness checklist, and likely next actions so `s2s init` can report initialized/configured/ready state from the shared readiness model.
- Updated `src/cli.ts` so `s2s init --check`, first-time init, and repair reruns all print the new checklist-style readiness output instead of only raw prerequisite groupings.
- Expanded `scripts/test-init-prerequisites.ts` and `scripts/test-cli-v1-contract.sh` to lock the new init summary/help/output contract, and refreshed the user-facing `README.md` / `README_es.md` notes for the new end-of-init guidance.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p3_t2.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `codex/p3-t2-spec-initialization-flow` branch, including the new P3 handoff to `P3-T3`.
- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p9_t5.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `codex/p9-t5-post-init-summary` branch.

## 0.1.23

### Product Changes

- Added `initializeChange` / `initializeChangeFromDecision` in `src/orchestration/router.ts` so Phase 3 can create or reuse a persisted `Change` directly from the versioned orchestration decision record without changing the existing routing entry points.
- Expanded the public 0.2.0 contract in `src/types/index.ts` and `src/index.ts` with the new `ChangeInitializationResult` surface for downstream lifecycle consumers.
- Added `scripts/test-change-initialization.ts` and wired `check:change-initialization` into `npm run check` to cover new-change creation, ledger activation, persisted-decision replay, and resume-without-duplication behavior.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p3_t1.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `codex/p3-t1-change-initialization-flow` branch.

## 0.1.23

### Product Changes

- Extended `src/runtime/init-prerequisites.ts` so `InitPrerequisiteReport` now validates repo-local `.s2s` state bundles in addition to the shared readiness model, covering managed project state, support configs, guardrails, scripts, runtime directories, and root compatibility shim markers through a single init-repair contract.
- Reworked `s2s init` in `src/cli.ts` so reruns and partial `.s2s` state now execute an in-place repair flow instead of exiting early, while preserving `--check` as a non-mutating preflight and revalidating repo-local state after repair.
- Expanded `scripts/test-init-prerequisites.ts` and `scripts/test-cli-v1-contract.sh` to cover missing/partial repo-local state, rerun repair behavior, and the updated init output contract.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p9_t4.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `codex/p9-t4-repo-init-repair` branch, including the new readiness handoff to `P9-T5`.

## 0.1.22

### Product Changes

- Added `src/runtime/init-prerequisites.ts` plus the exported `InitPrerequisiteReport` contract so `s2s init` can evaluate repo, machine, and feature readiness against user-project `.s2s/config/*` paths instead of falling back to the source-repo runtime config layout.
- Added an explicit `s2s init` command in `src/cli.ts` with `--check` support, grouped prerequisite reporting, and bounded first-time onboarding execution that revalidates prerequisite status after guided setup without yet claiming full rerun/repair support.
- Added `scripts/test-init-prerequisites.ts`, expanded `scripts/test-cli-v1-contract.sh`, and wired the new init-prerequisite validation into `npm run check` to cover `.s2s`-aware preflight behavior plus the new CLI command/help surface deterministically.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p9_t3.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `P9-T3` implementation branch, including the narrowed remaining blocker around root-command auto-onboarding.

## 0.1.21

### Product Changes

- Added `assessLightweightPrerequisites` in `src/runtime/readiness.ts` as the non-invasive, client-agnostic root-command prerequisite helper on top of the shared `RuntimeReadinessReport`, including summary text, pending actions, blocking/action-required check lists, and likely next-command guidance.
- Expanded the public runtime contract in `src/types/index.ts` and `src/index.ts` with the new lightweight prerequisite report/options types so later CLI work can consume the shared root-check surface without re-deriving readiness state.
- Added `scripts/test-lightweight-prerequisites.ts` and wired `check:lightweight-prerequisites` into `npm run check` to cover unsupported source-repo context, uninitialized user-project guidance, and fully ready lightweight prerequisite assessment outcomes.
- Added a versioned `OrchestrationDecisionRecord` contract in `src/types/index.ts` so downstream lifecycle, runtime, and CLI layers can consume a stable persisted orchestration payload instead of a raw planner snapshot.
- Rewired `src/orchestration/router.ts` so `decideRoute` now persists the routed decision matrix plus request metadata into the project ledger, and exported explicit build/record helpers for consumers that need the full decision record.
- Updated the ledger aggregation surface and compatibility coverage so `lastDecision` now stores the persisted orchestration record, including route-stage decisions, without changing runtime worktree or engineering-exec behavior.
- Added `scripts/test-orchestration-decision-record.ts` and expanded the existing router/ledger/entity/artifact tests to cover the persisted decision-record shape and ledger round-tripping.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p9_t2.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `P9-T2` implementation branch.
- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p2_t5.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `codex/p2-t5-orchestration-decision-persistence` branch.

## 0.1.20

### Product Changes

- Added `src/orchestrator/stage-router.ts` so the Phase 2 router now converts shared `FlowDecision` outputs into explicit invoke-vs-skip decisions for `pm`, `research`, `design`, `engineering`, and `engineering_exec`.
- Rewired `decideRoute` to consume `planFlow` instead of relying on static intent-only stage tables, so routing now preserves planner-driven stage skipping, design invocation, resume detection, and direct-execution paths.
- Expanded the public route contract in `src/types/index.ts` and `src/index.ts` with stage-decision metadata, and added `scripts/test-stage-router.ts` plus updated route assertions in `scripts/test-intent-classifier.ts` to cover the new planner-backed guidance matrix.
- Added an explicit readiness-domain model for repo, machine, and enabled feature checks, including typed readiness reports, per-scope summaries, feature summaries, and exported assessment helpers in `src/runtime/readiness.ts`, `src/types/index.ts`, and `src/index.ts`.
- Refactored `ensureRuntimeReady` to consume the new readiness model, surface structured readiness output, and block bootstrap attempts in the `spec-to-ship` source repository instead of mutating repo-local runtime state there.
- Added `scripts/test-readiness-model.ts` plus a `check:readiness-model` validation hook to cover blocked source-repo context, action-required user-project setup, and fully ready user-project assessment outcomes deterministically.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p2_t4.md` assignment prompt and refreshed the 0.2.0 execution tracker to show active P2-T4 implementation on `codex/p2-t4-stage-router`.
- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p9_t1.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `P9-T1` readiness-model branch.

## 0.1.18

### Product Changes

- Hardened the shared worktree-provider path contract so `controlRoot` and `worktreesRoot` now resolve from a centralized local default under `~/.s2s`, with `~` expansion support for explicit overrides and an exported helper surface for downstream runtime consumers.
- Added explicit runtime-path resolution outputs for the shared worktree contract, including the resolved local runtime root and provider state root, and updated the Worktrunk/native providers to persist their managed state under the centralized resolved runtime path.
- Expanded the worktree runtime validation scripts to cover default `~/.s2s` path resolution, explicit `~` overrides, and provider-level default worktree/runtime root behavior without changing CLI routing or execution-orchestration logic.
- Hardened Phase 7 resumable-state validation by adding shared tracked-branch checks in `src/runtime/worktree-provider.ts`, so Worktrunk and native providers now classify stale, integrated, missing-branch, and merged/closed-PR sessions consistently before reuse.
- Expanded the concrete provider coverage in `scripts/test-worktrunk-provider.ts` and `scripts/test-worktree-provider-native.ts` to exercise diverged branches, integrated branches, and explicitly non-resumable PR-linked sessions against real Worktrunk and `git worktree` behavior.
- Added `src/orchestrator/flow-planner.ts` to combine classified intent plus resolved project context into a minimum-sufficient `FlowDecision`, including resume detection, planning-stage reuse, design invocation, and engineering-first vs research-first flow selection.
- Exported `planFlow` and `buildFlowDecision` from `src/index.ts`, and expanded `FlowDecision` with optional confidence and matched-signal metadata so downstream orchestration can reuse the planner contract without re-deriving inputs.
- Added `scripts/test-flow-planner.ts` to cover greenfield planning, design-aware planning with existing artifacts, hotfix direct-execution routing, resume detection, and research-first bug-fix planning.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p7_t5.md` assignment prompt and refreshed the 0.2.0 execution tracker for the P7-T5 implementation branch.
- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p7_t4.md` assignment prompt and refreshed the 0.2.0 execution tracker for the `P7-T4` implementation branch.
- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p2_t3.md` assignment prompt and refreshed the 0.2.0 tracker/version headers for the P2-T3 implementation branch.

## 0.1.17

### Product Changes

- Added `src/runtime/worktree-provider-native.ts` as the Phase 7 native fallback runtime, backed by `git worktree` operations, centralized runtime paths, provider-managed session metadata, availability checks, and basic resumable-session validation for controlled degradation.
- Exported the native fallback provider from `src/index.ts` and added `scripts/test-worktree-provider-native.ts` plus a `check:worktree-provider-native` validation hook to cover native create/reuse/list/remove/validate behavior against a sandbox git repository.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p7_t3.md` assignment prompt for the native fallback runtime task.

## 0.1.16

### Product Changes

- Added `src/runtime/worktree-provider-worktrunk.ts` as the concrete Worktrunk-backed Phase 7 runtime, including availability checks, request-scoped Worktrunk config generation, centralized path handling, session persistence, listing, removal, validation, and PR workspace support on top of the shared provider contract.
- Exported the Worktrunk provider factory and JSON-list parser from `src/index.ts` so follow-on runtime integration can construct the primary provider directly from the public API.
- Added `scripts/test-worktrunk-provider.ts` to exercise real Worktrunk-backed session creation, reuse, PR workspace allocation, integrated-session validation, and removal against a temporary git repository.
- Added `src/orchestrator/context-resolver.ts` plus exported `ContextResolution` types to inspect persisted operational state and human-readable project artifacts, returning a stable summary of active work, open records, pending gates, and available stage artifacts for Phase 2 orchestration.
- Expanded `src/ledger/selection.ts` and the public API with ordered open-change/spec/slice/run helpers so later planner work can consume a shared project-context surface instead of rebuilding ledger queries ad hoc.
- Added `scripts/test-context-resolver.ts` to validate the new resolver against empty and active project states, including artifact filtering and ordered open-work selection.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p7_t2.md` assignment prompt and refreshed the 0.2.0 execution tracker for the P7-T2 implementation branch.
- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p2_t2.md` assignment prompt and refreshed the 0.2.0 execution tracker for the P2-T2 implementation branch.

## 0.1.15

### Product Changes

- Added `src/runtime/worktree-provider.ts` as the Phase 7 runtime contract boundary for provider registration, normalized provider config, centralized worktree path derivation, stable session ids, and capability checks.
- Expanded the worktree provider/session types in `src/types/index.ts` and the public exports in `src/index.ts` so later Worktrunk/native implementations can share a stable lifecycle, validation, and PR-workspace contract.
- Added `scripts/test-worktree-provider-contract.ts` to validate the exported worktree runtime interface without pre-implementing the provider-specific runtimes.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p7_t1.md` assignment prompt and refreshed the 0.2.0 execution tracker for the P7-T1 implementation branch.

## 0.1.14

### Product Changes

- Added `src/orchestrator/intent-classifier.ts` to classify freeform requests into the 0.2.0 `WorkIntent` taxonomy using explicit signal scoring for new features, refinements, bug work, investigations, refactors, implementation-only requests, spec revisions, resumptions, and hotfixes.
- Rewired `src/orchestration/router.ts` and the exported router intent types to consume the shared 0.2.0 intent model with conservative stage recommendations instead of the legacy pre-0.2.0 keyword unions.
- Added `scripts/test-intent-classifier.ts` to validate representative intent-classification fixtures plus route recommendations for new-feature, bug-fix, and hotfix requests.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p2_t1.md` assignment prompt and refreshed the 0.2.0 execution tracker for the P2-T1 implementation branch.

## 0.1.13

### Product Changes

- Added `src/ledger/status.ts` to derive and refresh the aggregate `WorkLedger` index from the persisted Change, Spec, Slice, Run, and Gate stores, including active-change/spec resolution, pending-gate tracking, blocker aggregation, and status-grouped slice/run indexes.
- Added `src/ledger/selection.ts` plus new public exports for active change/spec lookup and grouped pending/blocked/status-based record selection helpers on top of the derived ledger index.
- Added `scripts/test-ledger-aggregation.ts` to validate ledger derivation, persisted refresh behavior, blocker aggregation, and selection helpers end to end.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p1_t5.md` assignment prompt and refreshed the 0.2.0 execution tracker for the P1-T5 implementation branch.

## 0.1.12

### Product Changes

- Added a deterministic transition map for Change, Spec, Slice, Run, and Gate lifecycle states under `src/ledger/transitions.ts`.
- Enforced lifecycle validation inside the shared identified-entity store so invalid status changes now fail through the existing store update/save APIs.
- Added `scripts/test-transition-validation.ts` and exported the transition helpers from the public package surface for direct validation coverage.

### Repo Governance Changes

- Added the filled `docs/v0-2-0_plan/codex_developer_prompt_p1_t4.md` assignment prompt and refreshed the 0.2.0 tracker/plan docs for the P1-T4 handoff.

## 0.1.11

### Product Changes

- Added typed CRUD store modules for Change, Spec, Slice, Run, Gate, and Ledger records under `src/ledger/`, building directly on the shared artifact JSON helper contract.
- Expanded `src/artifacts/store.ts` with delete helpers so entity-store modules can support full CRUD semantics without introducing a second persistence path.
- Exported the new operational store functions from the public package surface and added `scripts/test-entity-stores.ts` to validate create/get/list/update/delete behavior end to end.

### Repo Governance Changes

- None.

## 0.1.10

### Product Changes

- Added nested artifact path support in `src/artifacts/store.ts`, including JSON read/write/list helpers for the new 0.2.0 operational artifact layout.
- Added typed artifact helpers for Change, Spec, Slice, Run, Gate, and Ledger JSON persistence so upcoming entity-store work can share a stable storage contract.

### Repo Governance Changes

- None.

## 0.1.9

### Product Changes

- Added the initial 0.2.0 operational type layer for flow decisions, changes, specs, slices, runs, gates, the aggregate ledger, and the Worktrunk-first worktree provider contract.
- Exported the new operational domain contracts from the public package surface so follow-up phases can build stores, transitions, and orchestration against a shared model.

### Repo Governance Changes

- None.

## 0.1.8

### Product Changes

- `s2s` now distinguishes the `spec-to-ship` source repository from user-managed project repos and blocks onboarding/bootstrap, managed setup, and engineering execution when they target the source repo.
- User-project governance is now rendered from dedicated product-owned sources under `src/governance/user-project/`, with canonical policy materialized into `.s2s/guardrails/*` and root chat-client files reduced to compatibility shims.
- Managed stage context, doctor checks, and guardrail conflict detection now treat `.s2s/guardrails/*` plus runtime config as the authoritative source for user-project governance.
- Workspace-level guidance outside the target app repo now uses `.s2s-workspace.md` metadata instead of writing reserved governance filenames into surrounding directories.

### Repo Governance Changes

- Root governance files in the `spec-to-ship` repository were cleaned back to source-repo mode only, preventing runtime user-project policy from being committed into maintainer docs.
- Internal isolation checks now fail when source-repo governance drifts back into user-project runtime language.
- README, manuals, architecture docs, onboarding artifacts, and CLI help now consistently describe the new canonical-guardrails-plus-root-shims model.
- CLI contract checks were updated to validate the new shim contract and fixed to use literal matching for guardrail paths containing `*`.

## 0.1.7

### Product Changes

- Managed Codex stage executions now run from isolated s2s LLM workspaces instead of reusing the app repo root, avoiding nested stage bootstrap loops in desktop-driven flows.
- Internal stage workers now receive repo guardrails explicitly in the managed prompt context, preserving repo-specific execution rules without re-running top-level `s2s` bootstrap commands.

### Repo Governance Changes

- None.

## 0.1.6

### Product Changes

- `s2s list` now prints each configured project as a readable summary with the project version, update notice when applicable, app path, and user-friendly last-used / latest-backup timestamps.
- `s2s update [project]` now refreshes project-managed files explicitly, resolving the target from either the current configured project directory or an explicit project alias/path.

### Repo Governance Changes

- CLI contract coverage now validates the richer `s2s list` output shape for configured projects.
- CLI contract coverage now validates the explicit `s2s update` refresh flow.

## 0.1.5

### Product Changes

- Codex executions launched by `s2s` now add `--skip-git-repo-check` for managed non-interactive runs, avoiding trust-gate failures in desktop-first project setups.
- Desktop-init runtime config now verifies both root pinning and trust-bypass flags in the Codex bridge configuration used by stage execution.

### Repo Governance Changes

- CLI contract coverage now fails if managed Codex invocations drop the trust-bypass flag required by desktop-managed stage execution.

## 0.1.4

### Product Changes

- Desktop-client project setup now configures stage execution against the matching CLI bridge instead of only storing `lastClient`.
- Codex stage/runtime execution now pins the working root explicitly (`--cd` / `--cwd`) so desktop-first projects execute against the project/worktree root deterministically.
- Execution templates now support desktop bridge executable paths for Codex and user-scoped desktop installs are detected before global app installs.

### Repo Governance Changes

- Canonical and UI-specific adapter docs now require conversational UIs to stop and surface blockers when a required `s2s` command fails, instead of continuing outside the `s2s` flow.

## 0.1.3

### Product Changes

- None.

### Repo Governance Changes

- Repository self-versioning enforcement:
  - validates SemVer alignment across `package.json`, `package-lock.json`, and `src/cli.ts`
  - requires a matching `CHANGELOG.md` section for the active product version
  - compares the current checkout against the base branch to ensure merged changes carry a real version bump
- Active changelog entries now have to separate `Product Changes` from `Repo Governance Changes`.
- GitHub Actions CI workflow for `pull_request` and `push` to `main`.
- Repository maintainer workflow now documents PR-first delivery to `main` with required CI and SemVer discipline.
- Repository governance now states one independent branch per change and manual maintainer-owned worktree management.
- Runtime config now declares versioning delivery policy explicitly.
- This repository now forbids `.s2s/` in repo root; runtime validation must happen in external test/app repositories.

## 0.1.2

### Added

- SemVer delivery enforcement in engineering execution:
  - requires a manifest version bump before commit/push/PR delivery
  - validates staged manifest, lockfile, and changelog updates by default
  - exports delivery version metadata (`versionFrom`, `versionTo`, `versionBumpType`, `versionNote`)

### Changed

- Engineering execution summaries now include the detected version bump note in chat output.
- Internal governance boundary is now explicitly enforced for root adapter docs:
  - runtime markers (`S2S_PROJECT_GUARDRAIL_*`, `S2S_CODEX_ADAPTER_*`, `S2S_CLAUDE_ADAPTER_*`) are treated as local-only and non-versioned
  - `npm run selfhost:apply` now strips those runtime-managed blocks from root docs
  - `npm run check:isolation` now fails if runtime-managed root markers are present

## 0.1.1

### Added

- Guided project update policy from binary-vs-project compatibility checks:
  - soft updates can be deferred and remain pending
  - hard updates are mandatory and block execution in non-interactive mode
- Pending update tracking in `.s2s/project.local.json` (`pendingProjectUpdate`).
- New `s2s remove [project] [--yes] [--keep-backups]` command to clean project-local `.s2s`, managed root adapters, and global registry/backups entries.
- Internal governance boundary assets under `internal/self-host/` (EN/ES boundary docs + managed templates).
- New maintainer command: `npm run selfhost:apply` (also `just selfhost-apply`).
- New isolation contract check: `npm run check:isolation`.
- Automatic onboarding for existing projects across `s2s` flows with root recommendation and state classification.
- Governance discrepancy exception registry: `.s2s/config/governance.exceptions.json`.
- Backup policy file: `.s2s/config/backup.policy.json`.
- Startup backups:
  - `startup-change` snapshots when managed project state changes
  - `periodic-startup` snapshots when the last backup exceeds the effective interval (max 7 days)
- Onboarding traceability artifacts under `.s2s/artifacts/onboarding/`.
- Stage execution artifacts under `.s2s/artifacts/stages/<stage>/` (`latest.md` + timestamped snapshots).
- Interactive backup policy prompts during onboarding and `s2s config edit`.

### Changed

- `s2s doctor` now reports project update state (up to date / soft pending / hard mandatory).
- CLI contract checks now validate soft/hard project update behavior.
- `package.json` now uses `files` whitelist to avoid publishing internal maintainer assets.
- Desktop launch mode no longer prompts switching to CLI; `s2s` now confirms desktop readiness and exits cleanly.
- Startup prompts now handle temporary stdin read errors (`EAGAIN`/`EWOULDBLOCK`) safely.
- `s2s` now resolves project context from the current folder (and Git-root ancestors only), avoiding accidental inherited parent contexts outside the active repo.
- Global registry load now auto-sanitizes invalid entries (missing paths, duplicates).
- Interactive confirmations for `s2s remove` and inherited-context initialization now use resilient async prompts (prevents auto-cancel in non-blocking TTYs).
- Startup backup checks now run from shared project-context resolution paths (not only chat launch).
- CLI contract checks now validate startup backup behavior for change-driven and periodic cases.

## 0.1.0

### Added

- Session Banner at chat launch with project/client/stage governance context.
- `runtime.chatObservability` config block:
  - `sessionBannerEnabled`
  - `wrapperPrefixEnabled`
  - `wrapperPrefixTemplate`
- Optional wrapper-prefix launch mode with safe fallback behavior in interactive terminals.
- `s2s doctor` checks for Claude handshake and chat observability settings.
- Git delivery branch/PR safety policy:
  - pre-push PR-state validation by branch
  - no reuse of branches tied to closed/merged PRs
  - automatic fresh branch allocation and new PR creation when required
- New contract check: `check:git-delivery-policy` (`scripts/test-git-delivery-policy.ts`).

### Changed

- Default `s2s` launch now resolves nearest project and launches chat in the project root.
- Claude adapter and guardrail blocks now enforce explicit first-response bootstrap requirements.
- CLI config editor now includes chat observability toggles.
- Version baseline is now pre-v1: `0.1.0`.

## 0.0.1

### Added

- New `s2s` CLI entrypoint exposed as binary.
- Project-local `.s2s` workspace bootstrap and migration flow.
- Global local registry at `~/.s2s/projects.json`.
- Commands:
  - `s2s`
  - `s2s version` (`-v`, `--version`)
  - `s2s <chat-app> [path-user-app]`
  - `s2s help` (`--help`, `-h`)
  - `s2s list`
  - `s2s config [project]`
  - `s2s config edit [project]`
  - `s2s stage <stage> [project]`
  - `s2s status [project]`
- Context resolution rules with optional final `[project]` argument.
- Root governance adapters auto-managed in `AGENTS.md`, `CODEX.md`, and `CLAUDE.md`.
- SemVer compatibility fields in `.s2s/project.json`.
- Auto-migration backups and migration log.
- New docs:
  - `docs/versioning-and-migrations_en.md`
  - `docs/versioning-and-migrations_es.md`

### Changed

- Initial pre-v1 public baseline moved to `0.0.1`.
- CLI v1 scope supports `codex` and `claude` chat apps.
- README EN/ES and user manuals now document CLI-first workflow.
- Cost report commands removed from default `just` surface.

### Pending (post-v1)

- OpenCode support in CLI surface.
- Cost/token observability command surface.
- Figma MCP operational CLI flow.
