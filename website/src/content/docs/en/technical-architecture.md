---
title: "Technical Architecture"
description: "s2s uses a three-layer orchestration model: CLI shell, Flow Orchestrator, and an execution plane for git-isolated engineering work."
---

## Architecture overview

s2s uses a three-layer orchestration model:

1. **CLI shell** (`s2s` CLI)
   - Project context resolution and registry management
   - Project bootstrap, migration, and governance materialization
   - Freeform intent submission via `s2s request`
   - Runtime and config normalization

2. **Flow Orchestrator** (`src/orchestrator/` + `src/orchestration/`)
   - Intent classification (9 intent types, confidence-scored)
   - Context resolution (ledger state, active entities, pending gates)
   - Stage route planning: minimum sufficient stages for the classified intent
   - Change/Spec creation and lifecycle advancement

3. **Execution plane** (`src/conductor/`, `src/agents/`, `src/runtime/`)
   - Stage execution (PM, Research, Design, Engineering agents)
   - Slice-first engineering execution in isolated git worktrees
   - Git/worktree delivery operations (branch, push, PR, merge)

## Current chat adapters

- `codex-cli` (Codex)
- `claude-cli` (Claude Code)

## Main modules

- `src/cli.ts` (~5092 lines) — CLI entry point: command handlers, help, project setup
- `src/cli/` (14 modules) — extracted CLI utilities: IO, types, project management, utils
- `src/orchestrator/` — intent classifier, context resolver, flow planner
- `src/orchestration/` — orchestration router and approval policy
- `src/ledger/` — operational state: Change, Spec, Slice, Run, Gate, Ledger entities
- `src/conductor/` — stage execution pipeline (agent orchestration)
- `src/agents/` — PM, Research, Design, Engineering LLM agents
- `src/runtime/` — engineering execution, worktree providers, git delivery
- `src/governance/` — governance template generation
- `src/onboarding/` — onboarding state machine
- `src/providers/` — LLM provider abstraction
- `src/artifacts/` — persistent artifact storage
- `src/quality/` — artifact checks and quality gates

## Governance model

### Project-local control workspace

`<app-root>/.s2s/`

- `project.json`: project metadata and compatibility
- `project.local.json`: local state (pending updates, last-used timestamps)
- `config/`: runtime and model config, backup policy, governance exceptions
- `guardrails/`: adapter and behavior policies (`AGENTS.md`, `CODEX.md`, `CLAUDE.md`)
- `artifacts/`: stage outputs and onboarding traceability (inside `.s2s/`)
- `logs/`, `backups/`: migration logs and operational safety snapshots

### Root compatibility files (managed)

- `AGENTS.md`
- `CODEX.md`
- `CLAUDE.md`

These files contain managed compatibility shims that import canonical governance from `.s2s/guardrails/*`.

## Operational state model

Six entity types persisted as individual JSON files under `.s2s/artifacts/<projectId>/`:

```
Change (root aggregate)
  ├── Spec (versioned contract)
  │     └── Slice (executable work unit derived from TechSpec + Backlog)
  │           └── Run (execution record for one attempt)
  └── Gate (approval checkpoint)
Ledger (computed aggregate, refreshed on every mutation)
```

The Ledger is the single source of truth for active change/spec IDs, pending gates, slice/run status, and the last orchestration decision. It also carries `effectiveRoute` (the union of all stage routes accumulated for the active change, in pipeline order) and `effectiveApprovalRequired` (true if any past decision for the active change required human approval). Both reset when a new change is created.

## Chat-native pipeline model

s2s operates in `chat-native` mode by default. In this model, s2s owns orchestration and record-keeping; the chat AI owns artifact generation.

### Two-phase stage pattern

For every artifact-producing stage (`pm`, `research`, `design`, `engineering`):

**Phase 1 — context delivery:** `s2s stage <stage>` outputs a structured task package (objective, context, artifact specification, file paths, and WHEN DONE instruction). s2s writes `.s2s/live.md` with `status: context_delivered` and the next action. It then returns — no LLM call is made.

**Phase 2 — submit:** After the chat AI generates and writes the artifact, it runs `s2s stage <stage> --submit`. s2s reads the artifact, runs quality checks, advances ledger state, creates a gate if required, and updates `.s2s/live.md` with the result and next action.

### What s2s owns (zero AI tokens)

- Intent classification and route planning
- Context package construction
- Artifact quality assessment
- Ledger state advancement and gate lifecycle
- `.s2s/live.md` state — the authoritative "where am I" file for the chat AI
- `.s2s/protocol.md` — generated command reference for the current CLI version

### What the chat AI owns (focused AI tokens)

- Reading the context package and understanding the task
- Generating the artifact content (PRD, TechSpec, etc.)
- Writing artifacts to the specified paths
- Running `--submit` and following the next-action instruction

### Standalone mode

Setting `pipelineMode: 'standalone'` in `runtime.json` causes `s2s stage <stage>` to call the LLM API directly (API mode only). This is an explicit opt-in for headless CI environments. See [LLM Access Modes](/en/llm-access-modes/) for configuration details.

## Stage contract

1. `pm` — product requirements (PRD.md)
2. `research` — technical investigation (Research.md)
3. `design` — interface and architecture (PrototypeSpec.md)
4. `engineering` — technical spec and backlog (TechSpec.md, Backlog.md)
5. `engineering_exec` — slice-first execution in isolated worktree (standalone mode only in chat-native projects)

The orchestrator determines which stages a given request needs — not all requests require all stages.

## Orchestrator flow

`s2s request "<prompt>"` or `s2s stage <stage>` triggers:

1. **Intent Classifier** — scores prompt against 9 intent types (new feature, bug fix, investigation, refinement, etc.)
2. **Context Resolver** — loads full project state (ledger, active entities, pending gates)
3. **Flow Planner** — produces minimum stage route, change/spec reuse decision, approval requirement

The orchestrator's decision is persisted in the Ledger. Routes accumulate across refinements: if the same change receives multiple requests, `effectiveRoute` is the union of all required stages in pipeline order. Each subsequent `s2s stage` call validates against the accumulated route and advances stage ownership on completion.

Internal stage agents receive the orchestrator's decision as context — user request, classified intent, recommended route, and stage position — so they produce intent-focused output rather than generic artifacts.

## Machine-local runtime state

`~/.s2s/`

- `projects.json` — global project registry
- `runtime/worktree-provider/{kind}/{repoSlug}/` — worktree session metadata
- `worktrees/<project>/` — managed worktree directories
- `backups/projects/<project-hash>/<snapshot>/` — project backup snapshots
