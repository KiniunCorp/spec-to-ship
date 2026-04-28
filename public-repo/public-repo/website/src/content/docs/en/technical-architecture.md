---
title: "Technical Architecture"
description: "s2s uses a three-layer orchestration model: CLI shell, Flow Orchestrator, and an execution plane for git-isolated engineering work."
---

## The three layers

s2s is built as three distinct layers with clear ownership boundaries. Understanding where each responsibility lives makes the whole system predictable.

### Layer 1: CLI shell

The CLI shell (`s2s` binary) is the user-facing entry point. It handles:

- Project context resolution — finding the `.s2s/` workspace for the current directory
- Global project registry — tracking all initialized projects in `~/.s2s/projects.json`
- Project bootstrap and migration via `s2s init` and `s2s update`
- Governance materialization — writing guardrail files and root shims into the project
- Freeform intent submission via `s2s request`
- Runtime and configuration normalization

The CLI is stateless with respect to the workflow. It reads from and writes to the ledger on every command, but it does not hold any workflow state in memory between invocations.

### Layer 2: Flow Orchestrator

The orchestrator (`src/orchestrator/` and `src/orchestration/`) is where all workflow decisions are made. It runs on every meaningful command and owns three things:

**Intent classification.** When you submit a request, the classifier scores the prompt against nine intent types — new feature, bug fix, investigation, refinement, hotfix, and others. Each classification carries a confidence score. The highest-confidence match determines the intent type.

**Context resolution.** Before making any routing decision, the orchestrator loads full project state from the ledger: the active change and spec, any pending gates, the accumulated effective route, prior orchestration decisions. This is how route accumulation works — the orchestrator knows what was decided before.

**Route planning.** Given the classified intent and current context, the orchestrator produces the minimum stage route — the smallest set of stages that request actually needs. A bug fix does not get routed through product and design. A new feature does. A security investigation routes differently from both. The route is persisted in the ledger so every subsequent command can validate against it.

The orchestrator never calls an LLM. Every decision runs in the binary.

### Layer 3: Execution plane

The execution plane (`src/conductor/`, `src/agents/`, `src/runtime/`) handles the actual work: running stages and delivering code changes.

For artifact-producing stages (`pm`, `research`, `design`, `engineering`), the conductor assembles a context package from the ledger and the prior stage artifacts, then hands it to the appropriate agent. In chat-native mode, the "agent" is the task package output — the conductor writes it to stdout for the active chat session to read. In standalone mode, the agent calls the LLM API directly.

For engineering execution, the runtime creates an isolated git worktree, runs the configured AI agent inside it, and handles git delivery — branch creation, commit, push, PR.

## The operational state model

s2s persists all workflow state as individual JSON files under `.s2s/artifacts/<projectId>/`. Six entity types form the state model:

```
Change (root aggregate)
  ├── Spec (versioned contract)
  │     └── Slice (executable work unit derived from TechSpec + Backlog)
  │           └── Run (execution record for one attempt)
  └── Gate (approval checkpoint)
Ledger (computed aggregate, refreshed on every mutation)
```

A **Change** is the root entity for a piece of work. It carries the original request, the classified intent, and the effective route. When you submit a new request for an existing feature, the orchestrator reuses the Change and accumulates the new route into it.

A **Spec** is the versioned planning contract for a Change. It holds references to stage artifacts (the PRD, Research doc, PrototypeSpec, TechSpec, Backlog) and tracks which stages have been completed.

A **Slice** is an executable unit of work derived from the TechSpec and Backlog. Engineering execution runs one Slice at a time — this bounds the blast radius of any single execution and makes recovery straightforward.

A **Run** records one execution attempt for a Slice: which agent ran, which worktree was used, what the result was, and whether verification passed.

A **Gate** is an approval checkpoint. It records what triggered it, its state (pending, approved, rejected), and who resolved it.

The **Ledger** is a computed aggregate over all the above. It is the single source of truth for `s2s status` and for every orchestration decision. It carries the `effectiveRoute` (the union of all stage routes accumulated for the active change, in pipeline order) and `effectiveApprovalRequired` (true if any past decision required human approval — this cannot be dropped by a subsequent request).

## How the context package is built

When the conductor prepares a stage, it reads from the ledger and assembles a context package specifically for that stage and that intent. The package contains:

- The original user request and the classified intent
- The full effective route and the current position in it
- Artifacts from completed prior stages (summarized and referenced, not dumped in full)
- The artifact specification for this stage — what to produce, what fields to include, what quality criteria apply
- The exact file path to write the artifact
- The exact `--submit` command to run when done

This is what makes the workflow token-efficient. The AI does not need to re-read the full conversation history because the context package contains exactly what is relevant to this stage. Prior decisions are present as structured inputs, not as conversational history to reconstruct.

## Governance model

s2s maintains governance in two places: the canonical policy in `.s2s/guardrails/` and the root compatibility shims in the project root.

The guardrails directory contains the authoritative governance files — adapter policies, behavior rules, stage contracts. These are written and managed by s2s. You do not edit them directly.

The root compatibility files (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`) are shims that your AI client reads automatically at the start of every session. Each shim imports the relevant canonical policy from `.s2s/guardrails/`. If the root files are ever modified externally in a way that conflicts with the canonical guardrails, `s2s doctor` detects the discrepancy.

The `guardrailPolicy` setting in `runtime.json` controls what happens when a conflict is detected:

- `strict` — blocks `s2s stage` and fails `s2s doctor`
- `warn` — reports the discrepancy but does not block
- `prompt` — asks you to choose at init or config time

## The live state file

`.s2s/live.md` is written by s2s after every significant command. It is the authoritative "where am I?" file for the active chat session — not the conversation history, not the scrollback buffer, not `s2s status`. The AI reads it at session start and falls back to it whenever it needs to reorient mid-session.

The file always contains the current stage, status, and next action. It is updated atomically on every write. The AI must never modify it. See [Live State Reference](/en/live-state/) for the full format and status values.

## Worktree isolation

Engineering execution runs in an isolated git worktree — a separate directory on a dedicated branch. This means:

- Your main working directory is untouched during execution
- Two parallel execution streams can run without conflicting
- Each stream has its own branch and can produce its own PR
- If execution fails or produces bad output, the worktree is discarded; nothing has touched main

Worktree directories are managed in `~/.s2s/worktrees/<project>/`. Metadata about active sessions lives in `~/.s2s/runtime/worktree-provider/`.

Delivery branches follow the naming convention `s2s-<provider>/<change-id>`:

```
s2s-claude/auth-rate-limiting
s2s-codex/auth-rate-limiting
```

## Machine-local runtime state

All global state lives in `~/.s2s/`:

```
~/.s2s/
  projects.json                          ← global project registry
  runtime/worktree-provider/<kind>/<repo>/  ← worktree session metadata
  worktrees/<project>/                   ← managed worktree directories
  backups/projects/<project-hash>/<id>/  ← project backup snapshots
```

Project-local state lives in `<app-root>/.s2s/`:

```
.s2s/
  project.json
  project.local.json
  config/
    runtime.json
    backup.policy.json
    governance.exceptions.json
  guardrails/
  artifacts/
    <projectId>/
      changes/
      specs/
      slices/
      runs/
      gates/
      ledger.json
  logs/
    orchestrator.log
  backups/
```

## Key source modules

For contributors or readers who want to trace the implementation:

| Module | Responsibility |
|--------|---------------|
| `src/cli.ts` | CLI entry point, command handlers, project setup |
| `src/cli/` | Extracted CLI utilities: IO, types, project management |
| `src/orchestrator/` | Intent classifier, context resolver, flow planner |
| `src/orchestration/` | Orchestration router, approval policy |
| `src/ledger/` | Operational state: Change, Spec, Slice, Run, Gate, Ledger |
| `src/conductor/` | Stage execution pipeline, agent orchestration |
| `src/agents/` | PM, Research, Design, Engineering stage agents |
| `src/runtime/` | Engineering execution, worktree providers, git delivery |
| `src/governance/` | Governance template generation |
| `src/quality/` | Artifact quality checks and gate triggers |
| `src/artifacts/` | Persistent artifact storage |
| `src/providers/` | LLM provider abstraction (API, OpenAI-compatible) |
