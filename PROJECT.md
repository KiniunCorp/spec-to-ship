# SpecToShip

## Product Definition

Spec-To-Ship is a CLI SDLC orchestrator. It sits between your AI chat client and your codebase, classifying work requests, planning the minimum stage route needed, and keeping execution governed through persistent state and human approval gates.

## Architecture

Three layers:

1. **CLI shell** (`s2s`) — project context resolution, `.s2s/` bootstrap and migrations, governance materialization, freeform request intake via `s2s request`

2. **Flow Orchestrator** — intent classification (9 types, confidence-scored), context resolution from the ledger, minimum stage route planning, Change/Spec lifecycle management

3. **Execution plane** — stage agents (PM, Research, Design, Engineering), slice-first execution in isolated git worktrees, git delivery and PR management

## Stage pipeline

Each stage produces a specific artifact:

| Stage | Artifact |
|-------|----------|
| `pm` | `PRD.md` |
| `research` | `Research.md` |
| `design` | `PrototypeSpec.md` |
| `engineering` | `TechSpec.md`, `Backlog.md` |
| `engineering_exec` | execution artifacts, verify outputs, git/PR outcomes |

Not every request runs all stages. The orchestrator selects the minimum route based on classified intent.

## Operational state

Six entity types persist under `.s2s/artifacts/<projectId>/`: Change, Spec, Slice, Run, Gate, and Ledger. The Ledger is a computed aggregate, the single source of truth for active entities, pending gates, and the accumulated stage route.

## Runtime model

Engineering execution supports two modes:
- `manual` — generate execution context, wait for human or agent action
- `shell` — run tasks using a command template with allowlist and timeout controls

Safety controls: global and template-level command allowlist, executable validation, per-task timeout, raw command execution disabled by default.

## Repository goals

- Keep the repo minimal, stable, and production-oriented.
- Keep docs aligned with implemented behavior.
- Keep generated artifacts and temporary outputs out of version control.
- Keep the core engine reusable across local OSS and future products.
