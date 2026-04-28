# Technical architecture summary

---

## A. One-paragraph architecture summary

Spec-To-Ship is a TypeScript CLI orchestrator that governs how AI chat clients interact with a software project. It installs a control workspace (`.s2s/`) into the target repository containing governance files, configuration, and persistent operational state. When a developer submits a request — either directly via `s2s request` or through a chat client reading the installed governance files — the Flow Orchestrator classifies intent, resolves active project context from the Ledger, and produces the minimum stage route needed. In the default `chat-native` mode, each artifact-producing stage outputs a structured task package to the active chat session — the chat AI generates the artifact, writes it to the specified path, and runs `s2s stage <stage> --submit` to record completion. All orchestration (routing, state, quality checks, gate lifecycle) runs in the binary at zero AI token cost. In `standalone` mode, stages call the LLM API directly. For engineering execution, work is decomposed into Slices and executed in isolated git worktrees with command allowlists, acceptance checks, and git delivery under branch/PR safety policy. The Ledger is a computed aggregate of all persistent entities (Change, Spec, Slice, Run, Gate) and serves as the single source of truth for active work, pending approvals, and accumulated route decisions. The CLI exposes the full surface — request intake, stage execution, entity inspection, gate resolution, backup/restore, and governance diagnostics — while delegating orchestration logic and execution to dedicated subsystems.

---

## B. Main architectural layers

**CLI shell (`src/cli.ts` + `src/cli/`)**
The entry point for all user interaction. Parses commands and flags, resolves project context from the local registry (`~/.s2s/projects.json`) or the nearest `.s2s/` directory, and dispatches to command handlers. No business logic lives here — it calls into the orchestration, ledger, and runtime layers and formats output for humans or machines (`--json`). Fourteen extracted modules in `src/cli/` handle IO, state, types, and utilities.

**Flow Orchestrator (`src/orchestrator/` + `src/orchestration/`)**
Four modules: intent classifier, context resolver, flow planner, and stage router. The classifier scores the user prompt against nine intent types with weighted signal matching. The context resolver loads full project state from the Ledger. The flow planner combines intent and context to produce a `FlowDecision` (which stages to invoke, whether to create a new change, whether approval is required). The stage router converts that into an explicit `RouteDecision` with per-stage `invoke`/`skip` actions and rationale. `src/orchestration/router.ts` wraps these into the public API (`decideOrchestration`, `initializeSpec`, `advanceStageOwnership`) and owns route accumulation across refinements.

**Stage capabilities (`src/agents/`, `src/conductor/`)**
Four LLM stage agents (PM, Research, Design, Engineering), each with a fixed system prompt, declared input/output artifacts, and a `run()` method that calls the provider and parses the response. In `chat-native` mode (default), `buildStageContext()` constructs the task package for the chat AI instead of calling the LLM. In `standalone` mode, the agent's `run()` method is invoked directly. `src/conductor/pipeline.ts` is the dispatch layer — it selects the right path for a given stage or delegates to `runEngineeringExecution` for `engineering_exec`. Agents are stateless; all context is injected at call time.

**Operational state model (`src/ledger/`)**
Per-entity CRUD stores for Change, Spec, Slice, Run, and Gate, each backed by individual JSON files under `.s2s/artifacts/<projectId>/`. The Ledger is a computed aggregate derived by `deriveLedger()` on every mutation — it is not a log but a snapshot of the current meaningful state. See section C for entity details.

**Execution runtime (`src/runtime/engineering-exec.ts`)**
Handles the full `engineering_exec` lifecycle: slice selection, `SLICE_CONTEXT.md` generation, worker invocation, evidence collection, and git delivery. See section D.

**Worktree runtime (`src/runtime/worktree-provider*.ts`)**
An abstraction layer supporting two providers — `worktrunk` (the `wt` binary) and `native` (git worktree commands). Both implement the same `WorktreeProvider` interface; capabilities differ (Worktrunk supports PR workspace mode, native does not). See section D.

**Repo-local vs. local-control state**
`.s2s/` in the project root holds portable project state — governance files, config, artifacts, logs. `~/.s2s/` is the machine-local control root — global project registry, worktree directories, LLM workspaces, and backup snapshots. See section E.

---

## C. Core domain model

**Change** is the root aggregate. It represents a unit of work — a request, refinement, or fix — with an intent, scope definition, stage ownership map, and a status lifecycle (`draft → active → in_review → done`). One Change is active at a time per project. It links to its current Spec via `activeSpecId`.

**Spec** is the versioned contract for a Change. It holds goals, constraints, acceptance criteria, design context, and per-stage artifact summaries. When a refinement is significant enough, a new Spec version is created (`refinedFromSpecId` links the chain). Status follows `draft → active → review_ready → approved → superseded`.

**Slice** is a scoped unit of engineering work derived from `TechSpec.md` and `Backlog.md` during the `engineering` stage. Each Slice has a sequence number, priority, size estimate, allowed/out-of-scope file paths, task references, and acceptance checks. Slices are the input to `engineering_exec` — execution always targets the next ready Slice, not the full change.

**Run** is the execution record for one attempt at a Slice. It tracks provider, branch name, worktree path, verification result, PR number/URL, and a list of evidence items (artifacts produced, test results, git outcomes). Status: `pending → running → succeeded / failed / blocked`.

**Gate** is a human approval checkpoint. Created after stages that require review (`engineering`, `engineering_exec`). Holds gate type (`spec_review` or `execution_review`), reason, and decision once resolved. Pending gates block stage advancement until `s2s approve` or `s2s reject` is called.

**Ledger** is a computed aggregate refreshed on every state mutation. It does not store entity data — it stores IDs, indexes (slices by status, runs by status), blockers, and orchestration decision fields (`lastIntent`, `lastDecision`, `effectiveRoute`, `effectiveApprovalRequired`). It is the single source of truth for what is currently active, blocked, or pending approval. `effectiveRoute` is the union of all stage routes accumulated for the active Change — it persists across refinements so that approval gates set by earlier decisions are never silently dropped.

**Entity relationships:**
```
Change (1)
  ├── Spec (1..n, versioned)
  │     └── Slice (0..n, derived from TechSpec+Backlog)
  │           └── Run (0..n, one per attempt)
  └── Gate (0..n, approval checkpoints)
Ledger (1 per project, computed)
```

---

## D. Runtime and execution model

**Slice-first execution**
`engineering_exec` does not execute a full plan in one pass. It selects the single next executable Slice (lowest sequence, `ready` status, no unresolved dependencies), creates a Run record, then executes that Slice. This keeps execution bounded and recoverable — a failure affects one Slice's Run, not the entire change.

**`SLICE_CONTEXT.md`**
Generated at execution time by `buildSliceContextDocument()` and written to artifacts. It is a structured execution contract containing: project/change/spec/slice/run IDs, exact task description, acceptance checks, allowed and out-of-scope file paths, technical constraints, design summary from the Spec, and blocker reporting rules. This document is what the engineering worker agent receives as its primary instruction.

**Worktree isolation**
Each Slice execution runs in an isolated git worktree under `~/.s2s/worktrees/<repo-slug>/<slice-id>/`. The worktree is a separate working directory checked out from the same Git repository, on a dedicated branch (`s2s-<provider>/<change-id>`). Code changes happen in the worktree, not in the main working directory. Two providers:

- **Native** — uses `git worktree add/remove`, persists session metadata in `~/.s2s/runtime/worktree-provider/native/<repo-slug>/`. No PR workspace support.
- **Worktrunk** — uses the `wt` binary for centralized session management. Supports `openPullRequestWorkspace` mode (a full PR review workspace separate from the change worktree). State tracked in Worktrunk config files plus `~/.s2s/runtime/worktree-provider/worktrunk/<repo-slug>/`.

**Branch and PR safety**
Before pushing, `engineering_exec` checks the current branch for closed or merged PRs (`gh pr list --head <branch> --state all`). If closed/merged PRs are found on that branch, it creates a fresh branch and opens a new PR, avoiding contamination of the delivery branch.

**Run evidence**
A Run accumulates evidence items throughout execution: verification output, execution report, list of materialized artifacts, git branch, PR number and URL, and a boolean `verificationPassed`. This evidence is persisted on the Run record and is available for inspection via `s2s show runs`.

---

## E. State and storage model

**In Git (committed, portable)**
Nothing from S2S is designed to be committed by default. The `.s2s/` directory is typically gitignored. Exception: teams may choose to commit `.s2s/artifacts/` for traceability or `.s2s/config/` for shared configuration, but S2S does not enforce this.

**Repo-local (`.s2s/`, project-scoped)**
- `project.json` — project metadata, schema version, CLI compatibility range
- `project.local.json` — machine-local state (last-used timestamps, pending update flags)
- `config/runtime.json` — guardrail policy, execution mode and template, worktree paths, observability toggles
- `config/llm.json` — LLM provider, model, access mode
- `config/execution.templates.json` — execution templates per client
- `guardrails/AGENTS.md`, `CODEX.md`, `CLAUDE.md` — canonical governance instructions for AI clients
- `artifacts/<projectId>/` — all entity JSON files (changes, specs, slices, runs, gates, ledger) — lives under `.s2s/`
- `logs/orchestrator.log` — non-fatal orchestrator warnings
- `backups/` — local safety snapshots before migrations

**Machine-local (`~/.s2s/`)**
- `projects.json` — global project registry mapping alias → project path
- `runtime/worktree-provider/{native|worktrunk}/{repo-slug}/` — provider session metadata
- `worktrees/<repo-slug>/<slice-id>/` — actual worktree directories for execution isolation
- `llm-workspaces/<project-hash>/` — per-project LLM workspace context
- `backups/projects/<project-hash>/<snapshot-id>/` — global backup snapshots (manifest, `.s2s/` snapshot, root shim snapshot)

**Why the split exists**
Repo-local state is project config and work artifacts — it belongs conceptually to the project, can be shared with teammates, and follows the repository. Machine-local state is runtime infrastructure — worktree directories are absolute paths on one machine, the project registry maps local file system paths, and backup snapshots may contain machine-specific configuration. Mixing the two would make `.s2s/` non-portable across machines and team members.

---

## F. CLI behavior model

**Root `s2s` (no arguments)**
Calls `handleDefaultChatCommand()`. Resolves project context from the nearest `.s2s/` or registry. If a project is found and healthy, launches the configured chat client (codex-cli, claude-cli, codex-desktop, claude-desktop). If desktop mode is active, prints guidance and does not spawn a process. If no project is configured, prints a lightweight status/help surface with the next suggested command.

**`s2s init [path]`**
Validates prerequisites (Node.js, Git, chat CLI availability). Runs the onboarding state machine: creates `.s2s/`, writes `project.json`, generates `runtime.json` and `llm.json` with guided prompts, writes governance files to `.s2s/guardrails/`, upserts root compatibility shims, registers the project in `~/.s2s/projects.json`. Idempotent — re-running repairs state rather than re-creating from scratch.

**Project commands** (`stage`, `request`, `status`, `show`, `approve`, `reject`, `config`, `doctor`, `backup`, `restore`, `update`)
All accept an optional `[project]` argument. Resolution order: (1) explicit `--repo <path>` flag, (2) explicit `[project]` argument, (3) nearest `.s2s/` in current directory or ancestors, (4) fail with guidance. This means all commands work both inside a project directory and from anywhere if the project name is known.

**Operational commands**
`s2s show` accepts `change`, `spec`, `slices`, `runs`, `gates` as subjects and prints structured summaries. `s2s approve` and `s2s reject` accept a gate ID and call `resolveGate()`, then refresh the Ledger. `s2s worktrees list` inspects `~/.s2s/worktrees/` and cross-references with the provider session store.

**Interactive vs. non-interactive behavior**
Guided commands (init, config edit) detect whether stdin is a TTY and whether answers can be read from a piped stdin answer stream. In non-interactive mode with missing required inputs, the CLI fails fast with a clear error rather than silently accepting defaults. `--yes` skips confirmation prompts on destructive commands. `--no-input` disables all prompts and fails if any would be triggered.

---

## G. Strengths of the architecture

**Intent-aware minimum routing.** The orchestrator classifies intent before selecting stages. A bug fix never runs pm or design. A research question runs research only. This is the core product value and it is fully implemented in the classifier and planner — not a governance trick.

**Route accumulation across refinements.** `effectiveRoute` is additive. Approval gates set by earlier decisions survive refinements. A team cannot accidentally drop a required security review by submitting a follow-up request.

**Slice-first execution boundary.** `engineering_exec` operates on one Slice at a time. Failures are scoped. Re-runs are targeted. There is no "run the whole backlog and hope" mode.

**Clean entity separation.** Change, Spec, Slice, Run, and Gate are independent entities with their own stores and lifecycle state machines. The Ledger computes from them on demand — no dual-write, no denormalization bugs.

**Governance is data, not convention.** The three guardrail files are generated from typed templates and written to `.s2s/guardrails/`. Conflict detection runs on every `s2s stage` call in strict mode. The governance contract is enforceable at runtime, not just documented in a README.

**Intent-aware agent prompts.** Internal stage agents receive the orchestrator's full decision (user request, classified intent, route, stage position) as context. A PM agent running for a bug fix knows not to write a 5-section PRD.

**Worktree abstraction.** Both Worktrunk and native git worktrees are supported behind a single interface. Teams can use whichever provider fits their setup without changing any other part of the workflow.

**Machine/project state split.** `.s2s/` is portable across teammates; `~/.s2s/` is machine-local infrastructure. The split is deliberate and enforced by the storage model.

---

## H. Weak points / future pressure points

**Single active Change per project.** The domain model supports multiple changes (`changeIds[]` on the Ledger), but the "active change" resolution picks one winner. Teams running multiple parallel features in the same project will need a clearer multi-change management surface before this scales.

**Ledger recomputation cost.** `deriveLedger()` loads all entities on every call. At low entity counts this is negligible. As artifact directories grow across hundreds of changes, slices, and runs, full recomputation on every mutation will become a bottleneck. An incremental update model or a persistent indexed store will be needed.

**No rollback for partial stage execution.** If an LLM agent crashes mid-stage, the artifacts it wrote are partially complete and there is no built-in rollback. The backup system (`s2s backup/restore`) is the recovery mechanism, but it is manual. An atomic write + rollback model per stage execution would make recovery automatic.

**Engineering agent is effectively a black box.** `runEngineeringExecution` calls a worker agent and collects evidence, but the actual code changes made inside the worktree are opaque until the Run is inspected. There is no incremental visibility into what the agent is doing during execution.

**Intent classifier is rule-based, not learned.** The classifier uses weighted keyword signals. It works well for clear cases but will produce unexpected routes on ambiguous or multi-intent prompts. There is no feedback loop — a mis-classified intent that runs the wrong stages does not inform future classifications.

**`src/cli.ts` is still large.** The extraction of 14 modules into `src/cli/` reduced it from ~6,500 to ~5,200 lines, but it remains the largest single file in the codebase and the most complex to navigate. Further decomposition of command handlers into their own modules would improve maintainability.

**No multi-project request routing.** `s2s request` is scoped to a single project. A team managing five microservices cannot submit a cross-cutting request and have the orchestrator plan work across all of them. This is a natural next scaling surface.

**`iterate` stage exists in the type system but is not implemented.** `PipelineStage` includes `'iterate'`, and `runIteration` is referenced in `pipeline.ts`, but it is not reachable from the CLI surface. This creates a latent contract gap between the type system and the runtime.