# Plan: Chat-Native Architecture Rearchitecture

**Status:** Approved direction. Implementation in progress on branch `feat/chat-native-architecture`.

> Note: `pm` is used as the running example throughout this document. The chat-native model
> applies to **all** stages, commands, and workflows — see the full coverage table below.

## Vision

s2s is a **pure orchestration layer**. It is never the LLM. It manages state, assembles context,
enforces governance, and records outcomes. The chat UI's AI is always the one generating artifacts —
with full conversation context, full model capability, and no context loss across sessions, UI changes,
or model upgrades.

The key insight: **artifacts are the persistent memory**. PRD.md, TechSpec.md, Backlog.md, and the
ledger are the source of truth. A user can switch from Codex to Claude to OpenCode mid-feature and
the AI picks up exactly where the previous session left off — because the context is in the files,
not in the chat session.

## Full Coverage: What Chat-Native Applies To

### Artifact-producing stages (all follow the two-phase pattern)

| Stage | Output artifacts | Quality validator |
|-------|-----------------|-------------------|
| `pm` | PRD.md | Heading structure + acceptance criteria bullets |
| `research` | Research.md | Investigation Plan + Unknowns sections |
| `design` | PrototypeSpec.md | Screen Specs with ≥4 screens |
| `engineering` | TechSpec.md, Backlog.md | Heading structure |
| `engineering_exec` | Code, tests, commits | **To be re-evaluated in Phase 2** — see execution model section |

### Commands that output context / instructions (no LLM call — already correct)

| Command | Role in chat-native model |
|---------|--------------------------|
| `s2s request` | Classifies intent, writes `idea.json`, outputs recommended route |
| `s2s status` | Shows active change, current stage, pending actions |
| `s2s show` | Shows artifact content on demand |
| `s2s doctor` | Governance check, surfaces config issues |

### Commands that advance or record state

| Command | Change type | Role |
|---------|-------------|------|
| `s2s stage <stage> --submit` | **New** | Records artifact completion, runs quality check, advances ledger |
| `s2s approve <gate>` | Unchanged | Human approves a review gate |
| `s2s reject <gate>` | Unchanged | Human rejects and stage is restarted |

### Admin and project management commands (unchanged)

| Command | Role |
|---------|------|
| `s2s init` | Initialize a project |
| `s2s update` | Refresh managed files to current CLI version; regenerates `live.md` and `protocol.md` |
| `s2s list` | List registered projects |
| `s2s backup` / `s2s restore` | Backup and restore project workspace |
| `s2s remove` | Remove a project from s2s management |
| `s2s worktrees` | Worktree management (primarily during `engineering_exec`) |
| `s2s completion` | Shell completion scripts |
| `s2s version` | Print version |

## The Problem With Today's Architecture

When any artifact-producing stage runs (e.g. `s2s stage pm`):
1. s2s calls `createProvider()` → spawns its own LLM call (in isolation)
2. The agent generates the artifact using only the stored inputs + governance files
3. The chat session's AI never participates; its context is completely separate

This applies to all four artifact-producing stages: pm, research, design, engineering.

This means:
- Any nuance the user expressed in chat is lost at stage time
- The LLM generating the artifact is a different invocation from the one that talked to the user
- When `mode: 'cli'`, s2s tries to spawn `claude`/`codex` as a subprocess from inside a `claude`/`codex`
  session — which is nested, fragile, and times out

## Target Architecture

### Execution model

The same two-phase pattern applies to every artifact-producing stage:

```
User message
  │
  ▼
Chat AI (in-session, full context)
  │
  ├─ runs: s2s stage <stage>          (e.g. pm, research, design, engineering)
  │         │
  │         └─► s2s outputs: context package + task spec → exits (no LLM call)
  │             includes: existing artifacts, governance, orchestrator decision,
  │             artifact spec (required sections, format, output path)
  │
  ├─ reads output, generates artifact content in-context (full conversation history available)
  │
  ├─ writes: artifact(s) to .s2s/artifacts/    (e.g. PRD.md, TechSpec.md + Backlog.md)
  │
  └─ runs: s2s stage <stage> --submit
            │
            └─► s2s reads artifact(s), runs quality check, advances ledger
                outputs: quality score + gate decision + next step instruction
```

`engineering_exec` currently spawns the chat UI binary with a constructed prompt via
`execution.templates.json`. This is a fresh subprocess with no conversation context — which may
or may not be the right model. **Re-evaluate during Phase 2:**
- If execution runs in an isolated git worktree: spawning a focused fresh context may be correct
- If execution runs in the current session: chat-native (AI writes code in-context) may be better
- A hybrid could also apply: s2s outputs the implementation prompt, the current AI decides whether
  to act in-context or delegate to a worktree subprocess

Do not assume `engineering_exec` is exempt from this rearchitecture until it is explicitly reviewed.

s2s makes zero LLM calls in chat-native mode. The chat AI is the LLM. Context is never lost.

### What s2s owns

- State machine (ledger, change lifecycle, stage ownership)
- Context assembly (reading and packaging artifacts, governance files, orchestrator decisions)
- Quality validation (structural checks, scoring, auto-approve threshold)
- Governance enforcement (guardrails, approved commands, stage routing)
- Artifact store (read/write/list artifacts)
- Progress reporting (verbose output, stage position, route)

### What the chat AI owns

- Generating artifact content (PRD.md, TechSpec.md, Backlog.md, Research.md, etc.)
- Engineering execution (writing code, running tests, making commits)
- Human-facing communication (explaining, asking for clarification)
- Following s2s command output to determine the next action (see below)

### How the AI knows when and what to call: s2s is self-directing

The chat AI never independently decides which s2s command to run. Two mechanisms cover the
full flow — together they leave no ambiguity:

**1. Governance files (session entry protocol)**
`AGENTS.md`, `CODEX.md`, and `CLAUDE.md` are loaded by the chat UI at the start of every session. They define:
- When the user expresses a new idea → run `s2s request "<idea>"`
- At session start, if there is active work → run `s2s status` to orient
- Never skip a stage without running `s2s stage <stage>` first

**2. s2s command output (runtime next-action instructions)**
Every s2s command ends with an explicit instruction for what to do next. The AI reads and follows:

```
s2s request "add dark mode"
  └─► [s2s] intent=new_feature route=pm → engineering
      [s2s] Next: s2s stage pm
      [s2s] Live state updated → .s2s/live.md

s2s stage pm                          ← outputs full context package (only time it's verbose)
  └─► [s2s] stage 1/2 · pm · route: pm → engineering
      === S2S TASK: pm stage ===
      ... (task spec, artifact requirements — see Context Package Format) ...
      WHEN DONE: write .s2s/artifacts/PRD.md, then run: s2s stage pm --submit
      [s2s] Live state updated → .s2s/live.md

s2s stage pm --submit  (quality passes, no gate)
  └─► [s2s] pm submitted · quality 0.91 ✓ · next: s2s stage engineering
      [s2s] Live state updated → .s2s/live.md

s2s stage pm --submit  (quality below threshold)
  └─► [s2s] pm submitted · quality 0.61 ✗ · threshold 0.85
      [s2s] Issues: missing "Risks & Mitigations" · no bullets in Acceptance Criteria
      [s2s] Fix issues, rewrite PRD.md, run: s2s stage pm --submit
      [s2s] Live state updated → .s2s/live.md

s2s stage pm --submit  (gate created)
  └─► [s2s] pm submitted · quality 0.88 ✓ · gate created (spec_review)
      [s2s] Waiting for human review: s2s approve / s2s reject
      [s2s] Live state updated → .s2s/live.md
```

State-change commands (`submit`, `approve`, `reject`, `request`) output 3-5 lines maximum.
Only `s2s stage <stage>` (without `--submit`) outputs the full context package — and only because
the AI genuinely needs all of it to generate the artifact.

If the AI loses track at any point, `s2s status` always outputs the current state and next action.

This means the flow is fully recoverable across sessions and UI switches: a new AI session reads
the governance files, runs `s2s status`, and gets back on track without any human intervention.

## Context Package Format

When any artifact-producing stage runs in chat-native mode, s2s outputs a structured context block
to stdout. The format is the same for all stages; the content is stage-specific.

Example for `s2s stage pm` (route: pm → engineering, 3-stage feature):

```
[s2s] Stage: pm · 1 of 2 · route: pm → engineering · intent: new_feature
[s2s] Project: my-app · /path/to/app

=== S2S TASK: pm stage ===

OBJECTIVE
Generate PRD.md for the active feature request. Write it to .s2s/artifacts/PRD.md.

CONTEXT
--- idea.json ---
{ "idea": "...", "requestedAt": "..." }

--- Orchestrator decision ---
User request: "add dark mode support"
Classified intent: new_feature
Recommended route: pm → engineering
Rationale: no external research required; straightforward feature scoped to UI layer.
Current stage: pm (1 of 2)
Remaining after this stage: engineering

--- Prior artifacts (if any) ---
(none for first stage; subsequent stages include all previously produced artifacts here)

--- Governance (apply these constraints) ---
[contents of .s2s/guardrails/AGENTS.md, CODEX.md, and CLAUDE.md]

ARTIFACT SPECIFICATION
File: PRD.md
Required sections: Problem, Users & JTBD, MVP Scope, Non-goals, Key Flows, Success Metrics,
Risks & Mitigations, Acceptance Criteria
Format: markdown
Constraint: under ~2 pages, all acceptance criteria must be testable

QUALITY THRESHOLD
Auto-approve if score ≥ 0.85. Quality is checked on --submit.

WHEN DONE
Write the artifact to .s2s/artifacts/PRD.md, then run:
  s2s stage pm --submit
=========================
```

The same structure applies to all stages. What changes per stage:
- `[s2s]` header: stage name, position in route
- OBJECTIVE: stage-specific goal and output file(s)
- CONTEXT: accumulates — `engineering` stage receives idea.json + PRD.md + Research.md + PrototypeSpec.md
- ARTIFACT SPECIFICATION: stage-specific files, required sections, format rules
- WHEN DONE: correct `--submit` command for the current stage

The `[s2s]` prefixed lines are always shown. The block between `=== S2S TASK ===` delimiters is
the structured task the chat AI acts on.

## Verbose Mode

A lightweight progress line emitted at the start of every `s2s stage` and `s2s request` invocation,
always visible to the chat AI and (when shown) to the user.

Format:
```
[s2s] stage 1/3 · pm · route: pm → engineering · intent: new_feature
```

### Configuration

`runtime.json`:
```json
{
  "verbose": true
}
```

Default: `true`. When `false`, the `[s2s]` prefix lines are suppressed; only the task block is output.

This is also controllable per-invocation: `s2s stage pm --verbose` / `--no-verbose`.

The verbose line is intentionally one line — not a banner, not a table. It gives the chat AI
(and the watching user) a quick orientation:
- What stage is running
- Where in the route it sits
- What the intent was

## Quality Scoring and Auto-Approve

### Existing foundation

`src/quality/checks.ts` already:
- Validates artifact structure (required headings, section content)
- Produces a `QualityReport` with per-artifact `score` (0.0–1.0)
- Writes `QualityReport.json`

`src/conductor/pipeline.ts` already calls `runQualityChecks` and `getStageQuality` after each stage.

### What to add

New field in `RuntimeConfig` and `runtime.json`:

```json
{
  "quality": {
    "enabled": true,
    "minAutoApproveScore": 0.85,
    "blockOnFailure": false
  }
}
```

After `s2s stage pm --submit`:

```
score >= minAutoApproveScore  →  auto-approve, output next step
score < minAutoApproveScore   →  output quality report, create review gate
                                 if blockOnFailure: exit 1
                                 else: warn, still output next step (let human decide)
```

The quality gate output should be actionable for the chat AI:

```
[s2s] Quality: PRD.md score=0.62 (threshold=0.85) ⚠ below threshold
[s2s] Issues:
  - Missing required heading: "Risks & Mitigations"
  - Acceptance Criteria section has no bullet points
[s2s] Action: fix the issues above, rewrite PRD.md, and run s2s stage pm --submit again
```

### Exposing in `s2s config edit`

```
Quality auto-approve threshold [0.85]: _
Block on quality failure? [n]: _
```

## New CLI Surface

### `s2s stage <stage> --submit`

Applies to: `pm`, `research`, `design`, `engineering`. Applicability to `engineering_exec`
to be determined during Phase 2 re-evaluation.

Records that the chat AI has completed the stage artifact(s). s2s:
1. Reads the stage's output artifact(s) from `.s2s/artifacts/`
   - pm: PRD.md
   - research: Research.md
   - design: PrototypeSpec.md
   - engineering: TechSpec.md + Backlog.md
2. Runs quality checks and scores each artifact
3. Advances ledger state (stage ownership, change status)
4. Creates a review gate if approval is required
5. Outputs: quality score per artifact, overall gate decision, next step instruction

If any required artifact is missing: exits with an error naming the missing file(s).

### `s2s stage <stage> --context`

Outputs the context package only — same as running `s2s stage <stage>` in chat-native mode, but
explicit. Useful if the AI wants to re-read the task spec without triggering any state changes.
Works for all artifact-producing stages.

### No other new commands needed

The split between "get task" (`s2s stage <stage>`) and "record completion" (`s2s stage <stage> --submit`)
is sufficient for all stages. Existing commands (`s2s status`, `s2s show`, `s2s approve`, `s2s reject`)
are unchanged.

## Token Cost and Efficiency: A Core Product Differentiator

### Why this matters for users

Token cost is real money. Every unnecessary token in governance files, command output, or context
packages is a cost the user pays on every interaction. A well-orchestrated s2s workflow should cost
significantly less per feature than an unguided AI session — because s2s handles all the state
tracking, routing, and context assembly, and the AI only spends tokens on the work that genuinely
requires intelligence.

**This is a product differentiator worth making explicit in all user-facing documentation.**
Users should understand: s2s is not just an orchestrator — it is an efficiency layer that keeps
their AI spend focused on creative and technical work, not on re-discovering state or re-reading
context that s2s already manages.

### Design rules applied throughout this architecture

Every design decision accounts for LLM token cost. The goal: **minimum tokens to keep the AI
correctly orchestrated at all times.**

| Principle | What it means in practice |
|-----------|--------------------------|
| s2s does the heavy lifting | State tracking, routing, quality checks, context assembly — all done by the binary, zero tokens |
| Governance files are short | Under 40 lines. Session entry + hard rules + pointer. No procedures. |
| Living file is compact | Under 30 lines. Current state + next action. Always overwritten, never appended. |
| `s2s` stdout is minimal | 3-8 lines for state-change commands. Only stage context commands output the full task spec. |
| Context package is on-demand | Only output when the AI needs to generate an artifact — not on status, submit, approve, reject. |
| Protocol reference is never auto-loaded | The AI reads it only when explicitly directed to for a specific command. |
| Artifacts excerpted by s2s | s2s includes only the relevant prior artifact sections in context packages, not full dumps. |
| Living file over status re-runs | Reading `.s2s/live.md` (~150 tokens) beats re-running a stage command to re-discover state. |

### Token budget targets (approximate, per operation)

| Operation | Target token output |
|-----------|-------------------|
| `s2s request` | ~50 tokens |
| `s2s stage <stage> --submit` (pass) | ~60 tokens |
| `s2s stage <stage> --submit` (fail) | ~100 tokens |
| `s2s approve` / `s2s reject` | ~40 tokens |
| `s2s status` | ~100 tokens |
| `s2s stage <stage>` context package | ~800-1500 tokens (justified — AI needs this to generate the artifact) |
| Reading `.s2s/live.md` | ~150 tokens |
| Reading `.s2s/protocol.md` | ~600 tokens (only when explicitly needed) |

## The Living File: `.s2s/live.md`

### Purpose

A single, compact, always-current file that tells the AI exactly where the project is and what
to do next. It is the primary runtime orientation mechanism — more reliable than governance files
(which were loaded N messages ago) and cheaper than re-running `s2s status`.

### Written by s2s. Never by the AI.

s2s overwrites this file after every command that changes state:
`s2s request`, `s2s stage <stage>`, `s2s stage <stage> --submit`, `s2s approve`, `s2s reject`.

The AI only reads it — never modifies it.

### Format

```markdown
# S2S Live State
Updated: 2026-04-09T14:32:00Z

## Active Work
Project: my-app
Feature: add dark mode
Intent: new_feature
Route: pm → engineering

## Current Position
Stage: pm
Status: context_delivered
Next action: generate PRD.md, write to .s2s/artifacts/PRD.md, then run: s2s stage pm --submit

## Artifacts
- PRD.md: pending
- TechSpec.md: pending
- Backlog.md: pending

## Blockers
none
```

Statuses: `none` (no active work) · `context_delivered` · `submitted` · `gate_pending` ·
`approved` · `rejected`

Note: there is no `artifact_written` status — s2s cannot observe when the AI writes the file.
The transition from `context_delivered` to `submitted` happens only when the AI calls `--submit`.

### When the AI reads it

- **Session start:** governance file instructs: "run `s2s status` or read `.s2s/live.md` to orient"
- **After any s2s command:** stdout ends with `[s2s] Live state updated → .s2s/live.md` — AI can
  skip reading it if the stdout already contained the next action (happy path)
- **When uncertain:** governance file instructs: "if unsure what to do, read `.s2s/live.md`"
- **After a session break:** new session reads live.md to resume without re-running anything

### Token cost

Reading `.s2s/live.md` costs ~150-200 tokens. This is the cheapest possible orientation mechanism.
`s2s status` outputs roughly the same content. Both are far cheaper than re-running a stage command
or asking the AI to figure out state from scratch.

## LLM-Reliable Protocol Reference

### The problem

If command documentation lives only in AGENTS.md/CODEX.md/CLAUDE.md, it will inevitably drift from the
real CLI as s2s evolves. The LLM cannot detect drift — it will call commands that no longer exist,
use flags that changed, or skip steps that were added. This causes hallucination and silent failures.

### Design principle: the CLI is the source of truth

The LLM should never need to recall command syntax from memory. Instead:

1. **Happy path:** s2s command output always ends with the next action — the AI just follows
2. **Orientation:** `s2s status` always surfaces where the project is and what to do next
3. **Command details:** `.s2s/protocol.md` — a generated reference the AI can read on demand
4. **Per-command help:** `s2s help <command>` — always accurate, from the running binary

### `.s2s/protocol.md` — generated command reference

A file written by s2s into the user project's `.s2s/` directory. It is:
- **Generated**, not hand-written — derived from the CLI source at build time
- **Regenerated** on every `s2s init` and `s2s update` — always matches the installed binary version
- **Structured for LLM consumption** — consistent format, no ambiguity, explicit next-actions

Format per command:

~~~markdown
### s2s stage <stage>

**Purpose:** Get the task context for an artifact-producing stage.
**When to use:** When the orchestrator route includes this stage and it has not yet been submitted.
**Applies to:** pm, research, design, engineering

**Arguments:**
- `<stage>` (required): one of pm, research, design, engineering, engineering_exec

**Flags:**
- `--submit`: Record that the artifact has been written. Runs quality check and advances ledger.
- `--context`: Output the context package only. No state changes. Safe to repeat.
- `--yes`: Skip interactive confirmations.
- `--json`: Output result as JSON (for tooling).

**Inputs (reads):**
- `.s2s/ledger/` — current change, route, orchestrator decision
- `.s2s/artifacts/` — all prior stage artifacts (included in context package)
- `.s2s/guardrails/` — governance constraints

**Outputs (without --submit):**
- stdout: context package + task spec + artifact specification + next-action instruction

**Outputs (with --submit):**
- stdout: quality score, gate decision, next-action instruction
- `.s2s/artifacts/<artifact>` — validated (read, not written — the AI wrote it)
- `.s2s/ledger/` — stage ownership and change status advanced

**Next action:**
- Without --submit: write the artifact, then run `s2s stage <stage> --submit`
- With --submit (pass): follow the next-action instruction in the output
- With --submit (fail): fix quality issues, rewrite artifact, re-run `--submit`

**Example:**
```
s2s stage pm
# ... generate PRD.md ...
s2s stage pm --submit
```
~~~

Every active command in the CLI has an equivalent entry. **Excluded from `protocol.md`:**
`s2s execute` and `s2s resume` are stub commands that redirect to other commands — including them
would mislead the LLM. `s2s execute` → use `s2s stage engineering_exec`. `s2s resume` → use `s2s status`.

The reference covers:

| Command | One-line purpose |
|---------|-----------------|
| `s2s request "<idea>"` | Classify intent, set route, start a new feature |
| `s2s stage <stage>` | Get task context for a stage (outputs full context package) |
| `s2s stage <stage> --submit` | Record artifact completion, run quality check, advance ledger |
| `s2s stage <stage> --context` | Re-output context package only, no state changes |
| `s2s status` | Show current state, active change, next action |
| `s2s show <artifact>` | Print artifact content |
| `s2s approve <gate>` | Approve a human review gate |
| `s2s reject <gate>` | Reject and restart a stage |
| `s2s init [path]` | Validate prerequisites and initialize a repository |
| `s2s update [project]` | Refresh project-managed files to current CLI version, apply pending updates |
| `s2s list` | List all projects registered with s2s |
| `s2s doctor` | Check governance and configuration health |
| `s2s config [project]` | Show or edit project configuration |
| `s2s backup` | Backup project workspace and governance files |
| `s2s restore` | Restore project workspace from a backup |
| `s2s remove` | Remove a project from s2s management |
| `s2s worktrees list` | List active worktrees |
| `s2s completion` | Generate shell completion scripts (bash, zsh, fish) |
| `s2s version` | Print installed s2s version |
| `s2s help <command>` | Get detailed help for any command |

### Governance files: short pointer, not inline content

AGENTS.md, CODEX.md, and CLAUDE.md are each under 40 lines. Each contains only what the AI must know at session entry.
The protocol detail lives in `.s2s/protocol.md` — the governance file just points there:

```markdown
## S2S Orchestration

At session start: read `.s2s/live.md` to orient. If no active work, wait for user input.
When user expresses an idea or task: run `s2s request "<idea>"` and follow the output.
If uncertain at any point: read `.s2s/live.md` — it always contains the next action.
For command reference: run `s2s help <command>` or read `.s2s/protocol.md`.

## Rules (never violate)
- Never invent an s2s command or flag — always check `.s2s/protocol.md` first
- Never skip `s2s stage <stage> --submit` after writing an artifact
- Never proceed to the next stage without reading the next-action instruction from `--submit`
- Never modify `.s2s/live.md` — s2s writes it; you only read it
```

That is the entire orchestration section. ~15 lines. Everything else is in the files it points to.

### Keeping it in sync: version-aware regeneration

`s2s update` compares the `templateVersion` in the installed `.s2s/protocol.md` against the
current binary version. If they differ, it regenerates the file automatically. `s2s doctor`
warns if the protocol file is missing or version-mismatched.

### What the LLM must never do

- Invent a command or flag not listed in `.s2s/protocol.md`
- Skip `--submit` after writing an artifact
- Assume a stage is complete without running `s2s stage <stage> --submit`
- Proceed to the next stage without reading the next-action instruction from `--submit` output

AGENTS.md, CODEX.md, and CLAUDE.md each explicitly prohibit these and instruct the LLM to run `s2s status` or read `.s2s/live.md` if uncertain.

## Governance File Updates

`AGENTS.md`, `CODEX.md`, and `CLAUDE.md` in user projects currently describe stage orchestration at a high level.
They need to document the two-phase pattern explicitly for all stages:

```markdown
## Stage Execution Pattern

For each artifact-producing stage (pm, research, design, engineering):
1. Run `s2s stage <stage>` — read the full task output, including context, artifact spec, and
   governance constraints
2. Generate the required artifact content in this conversation using the full task context
3. Write each artifact to the exact path specified in the task output
4. Run `s2s stage <stage> --submit` — s2s validates quality and outputs the next step

engineering_exec: **Phase 2 decision (locked):** stays as-is — s2s spawns the configured execution
template (worktree isolation). In-session execution would break the worktree isolation model that
`engineering_exec` depends on. Re-evaluation deferred until a worktree-native chat-native model is
designed in a future phase.

After --submit, follow the next step instruction s2s outputs:
- If quality passes and no gate: proceed to the next stage
- If quality fails: fix the issues listed and re-submit
- If a review gate is created: wait for human approval via s2s approve / s2s reject
```

The guardrail templates in `src/governance/user-project/` must be updated accordingly for all
three files: AGENTS.md, CODEX.md, and CLAUDE.md.

## What Changes in the Codebase

### `src/conductor/pipeline.ts`

Split `runStage` into two functions:

```typescript
// Chat-native: builds and returns the context package (no LLM call)
export function buildStageContext(projectId: string, stage: PipelineStage): StageContext

// Both modes: records completion, runs quality, advances ledger
export async function recordStageCompletion(
  projectId: string,
  stage: PipelineStage,
  artifactPath: string,
): Promise<StageResult>
```

Keep `runStage` as a compatibility wrapper that calls both — used only in standalone mode.

### `src/agents/*.ts`

Repurpose agents as **context assemblers**, not LLM callers:
- Keep `buildContext()` — it assembles the messages that represent the task context
- Remove `run()` which calls `provider.complete()`
- Export a `buildTaskSpec(projectId)` function that returns the context package as a string

### `src/cli.ts` — `handleStageCommand`

Add mode check at the top:
```typescript
const execMode = runtime.execution?.mode ?? 'chat-native';
if (execMode === 'chat-native') {
  outputStageTask(context, stage, runtime);
  return; // no LLM call, no pipeline
}
// standalone: existing runStage() path
```

Add `--submit` flag handling: call `recordStageCompletion()`, output quality result.

### `src/providers/cli.ts`

**Delete this file** in Phase 5, after chat-native output is fully working. There is no valid use
case for it in either chat-native or standalone mode.

### `src/providers/interface.ts`

Remove `case 'cli'` from `createProvider`. Remove import of `CLIProvider`. Done in Phase 5.

### `config/llm.json` (in user projects)

Not created by default in chat-native mode. Only created when user explicitly enables standalone mode
via `s2s config edit`. Remove from `ensureConfigFiles` default path. Done in Phase 1.

### `.s2s/live.md` (in user projects)

Written by s2s on every state-changing command. Created empty on `s2s init`. Updated by:
- `s2s request` — sets active work, intent, route, next action
- `s2s stage <stage>` — sets status to `context_delivered`, sets next action
- `s2s stage <stage> --submit` — sets status to `submitted` or `gate_pending`, sets next action
- `s2s approve` / `s2s reject` — sets status to `approved` or `rejected`, sets next action

Implementation: a new `writeLiveState(projectId, state)` function called at the end of each
state-changing command handler in `src/cli.ts`.

### `src/governance/user-project/` templates

Update AGENTS.md, CODEX.md, and CLAUDE.md templates to:
- Document the two-phase stage pattern
- Add pointer to `.s2s/live.md` and `.s2s/protocol.md`
- Add the prohibition list (no invented commands, no skipping --submit, etc.)
- Keep each file under 40 lines

## What Does NOT Change

| Component | Reason |
|-----------|--------|
| Ledger + change lifecycle | Already chat-native; records state, not LLM output |
| Artifact store | The persistent memory layer; core to the vision |
| Quality checks (`src/quality/checks.ts`) | Structural validators; work on any artifact regardless of who wrote it |
| `s2s status`, `s2s show`, `s2s doctor` | Read-only observability; unchanged |
| `s2s approve`, `s2s reject` | Human gate commands; unchanged |
| `s2s request` | Orchestration entry point; outputs route, no LLM call needed |
| `s2s init`, `s2s update`, `s2s list` | Project management; unchanged (update will also regenerate `live.md` and `protocol.md`) |
| `s2s backup`, `s2s restore`, `s2s remove` | Admin commands; unchanged |
| `s2s completion`, `s2s version`, `s2s help` | Utility commands; unchanged |
| `engineering_exec` stage | **To be re-evaluated in Phase 2** — spawning model may or may not align with chat-native principles depending on worktree isolation needs |
| Execution templates (`config/execution.templates.json`) | Used by `engineering_exec`; may evolve depending on Phase 2 re-evaluation |
| Cost tracking | Kept for standalone mode and future use |

## Context Preservation Across Sessions and UI Changes

This is the core product power. Here is how it works end-to-end:

**Session 1 (user in Claude Code):**
- User says "add dark mode"
- `s2s request "add dark mode"` → classifies intent, writes `idea.json`, sets route
- `s2s stage pm` → outputs task → Claude generates PRD.md → `s2s stage pm --submit`
- PRD.md and ledger are written to disk

**Session 2 (user switches to Codex, different day):**
- Codex reads `.s2s/guardrails/AGENTS.md`, `CODEX.md`, and `CLAUDE.md` on startup
- AGENTS.md tells Codex: "read `.s2s/live.md` or run `s2s status` to orient"
- `.s2s/live.md` shows: active change, next action = "run s2s stage engineering"
- `s2s status` outputs: active change, current stage (engineering), artifacts produced so far (names only, not content)
- Codex runs `s2s stage engineering` → context package assembled by s2s includes PRD.md content from Session 1
- Engineering artifacts are generated with full prior context

No context lost. The artifacts bridge the sessions. The AI does not need to "remember" — s2s assembles the context for it.

## Implementation Phases

### Developer workflow (applies to every phase)

Before starting any phase:
```
git checkout main
git pull
git checkout -b feat/phase-N-short-name
```

Before opening the PR:
1. Run `npm run check` — must pass completely (typecheck, build, self-versioning, all contract scripts)
2. Bump the version: `package.json`, `CLI_VERSION` / `TEMPLATE_VERSION` / `DEFAULT_MIN_CLI_VERSION` in `src/cli.ts`
3. Add a `CHANGELOG.md` entry for the version with a clear description of changes
4. Every phase ships with its own PR into `main` — never stack phases in one PR
5. After the PR merges: `git checkout main && git pull` before starting the next phase

Version bump policy:
- Any change that affects user-facing CLI output, behavior, or installed files → bump required
- Internal refactor with no user-facing change → no bump needed (confirm with `npm run check:self-versioning`)

---

### Phase 1 — Stop auto-configuring the broken path

**Branch:** `feat/phase-1-stop-cli-mode`
**Goal:** Remove `mode: 'cli'` as an auto-configured default to stop ETIMEDOUT errors immediately.
The old pipeline code is not removed yet — only the auto-configuration that causes it to be invoked.

**Acceptance criteria:**
- `s2s init` on a new project does NOT write `config/llm.json` unless the user explicitly enables standalone mode
- `s2s stage pm` in a new project does NOT attempt to call any CLI binary
- `runtime.json` in a new project contains `"execution": { "mode": "chat-native" }`
- `npm run check` passes

**Tasks:**

1. **`src/types/index.ts`** — Add to `RuntimeConfig`:
   ```typescript
   execution?: {
     mode: 'chat-native' | 'standalone';
   };
   ```

2. **`src/cli/project/config.ts`** — Update `defaultRuntimeConfig()` to include:
   ```typescript
   execution: { mode: 'chat-native' }
   ```

3. **`src/cli.ts` → `ensureConfigFiles()`** — Remove the block that writes `config/llm.json`
   by default. `llm.json` must only be written when the user explicitly configures standalone
   mode via `s2s config edit`. Trace all call sites of `defaultLLMConfig()` and guard them.

4. **`src/cli.ts` → `handleStageCommand()`** — Add early guard: read `execution.mode` from
   runtime config. If `'chat-native'` (or not set), skip the `runStage()` call and print a
   placeholder message: `[s2s] chat-native mode: stage output coming in Phase 2`.
   This prevents the LLM call without breaking the command surface.

5. **`scripts/test-cli-v1-contract.sh`** — Update contract test assertions:
   - Remove any assertion that `config/llm.json` exists after init
   - Add assertion that `runtime.json` contains `execution.mode = chat-native`

6. **Bump version** and add CHANGELOG entry.

---

### Phase 2 — Chat-native output + living file

**Branch:** `feat/phase-2-chat-native-output`
**Goal:** `s2s stage <stage>` outputs a structured context package instead of making an LLM call.
`writeLiveState()` is implemented and called after every state-changing command.

**Acceptance criteria:**
- `s2s stage pm` in chat-native mode prints the full context package to stdout (no LLM call)
- Output includes: `[s2s]` verbose line, `=== S2S TASK ===` block, OBJECTIVE, CONTEXT, ARTIFACT SPECIFICATION, WHEN DONE instruction
- `s2s stage pm --context` outputs the same package without changing state
- `.s2s/live.md` is created on `s2s init` with idle state
- `.s2s/live.md` is updated after `s2s request`, `s2s stage <stage>`, `s2s approve`, `s2s reject`
- Every command output ends with `[s2s] Live state updated → .s2s/live.md`
- Verbose line format: `[s2s] stage N/M · <stage> · route: <route> · intent: <intent>`
- `runtime.json` `verbose: false` suppresses `[s2s]` prefix lines
- `engineering_exec` re-evaluation decision is made and documented in this PR's description
- `npm run check` passes

**Tasks:**

1. **`src/types/index.ts`** — Add:
   ```typescript
   export interface LiveState {
     updatedAt: string;
     project?: string;
     feature?: string;
     intent?: string;
     route?: string[];
     stage?: string;
     status: 'none' | 'context_delivered' | 'submitted' | 'gate_pending' | 'approved' | 'rejected';
     nextAction?: string;
     artifacts?: Record<string, 'pending' | 'produced'>;
     blockers?: string[];
   }
   ```
   Also add `verbose?: boolean` to `RuntimeConfig`.

2. **`src/cli/live-state.ts`** (new file) — Implement:
   ```typescript
   export function writeLiveState(s2sDir: string, state: LiveState): void
   export function readLiveState(s2sDir: string): LiveState | null
   export function renderLiveState(state: LiveState): string  // markdown format
   ```

3. **`src/conductor/pipeline.ts`** — Implement:
   ```typescript
   export function buildStageContext(
     projectId: string,
     stage: PipelineStage,
     appRoot: string,
   ): string
   ```
   This function:
   - Reads `idea.json`, ledger, all prior artifacts for this stage
   - Reads governance files (AGENTS.md, CODEX.md, CLAUDE.md)
   - Assembles the full context package string in the format defined in "Context Package Format"
   - Does NOT call any LLM provider
   - Returns the string (caller prints it)

4. **`src/cli.ts` → `handleStageCommand()`** — Replace the Phase 1 placeholder:
   - Read `execution.mode` from runtime config
   - If `'chat-native'`: call `buildStageContext()`, print result, call `writeLiveState()` with `status: 'context_delivered'`, return
   - Add `--context` flag: same as above but skip `writeLiveState()` call
   - Verbose line always printed first (unless `runtime.verbose === false`)

5. **`src/cli.ts`** — Add `writeLiveState()` calls to ALL state-changing command handlers:
   - `handleRequestCommand()` — after route is set
   - `handleApproveCommand()` — after gate approved
   - `handleRejectCommand()` — after gate rejected
   - Every call ends with printing `[s2s] Live state updated → .s2s/live.md`

6. **`src/cli.ts` → init flow** — After `.s2s/` directory is created, write initial `live.md`
   with `status: 'none'` and no active work.

7. **`engineering_exec` decision** — Review `handleStageCommand` for `engineering_exec`.
   Document the decision (stays as-is / adopts two-phase) in the PR description and update
   the plan document accordingly before merging.

8. **`scripts/test-cli-v1-contract.sh`** — Add assertions:
   - `s2s stage pm` output contains `=== S2S TASK`
   - `.s2s/live.md` exists after init
   - `.s2s/live.md` contains `status: context_delivered` after `s2s stage pm`

9. **Bump version** and add CHANGELOG entry.

---

### Phase 3 — `--submit` flag and quality auto-approve

**Branch:** `feat/phase-3-submit-flag`
**Goal:** Add `s2s stage <stage> --submit` to record artifact completion, run quality checks,
and advance ledger state. Quality auto-approve threshold configurable in `runtime.json`.

**Acceptance criteria:**
- `s2s stage pm --submit` reads `.s2s/artifacts/PRD.md`, runs quality checks, prints score
- If score ≥ threshold: auto-approves, prints next stage instruction, updates `live.md`
- If score < threshold: prints issues list, prints fix instruction, updates `live.md` to stay at `context_delivered`
- If approval required (per ledger policy): creates gate, prints `s2s approve / s2s reject` instruction
- If required artifact is missing: exits with error naming the missing file
- `runtime.json` `quality.minAutoApproveScore` controls the threshold (default 0.85)
- `runtime.json` `quality.blockOnFailure` controls whether to exit 1 on quality failure
- `s2s config edit` exposes the quality fields
- Output is minimal: 3-6 lines (see token budget)
- `npm run check` passes

**Tasks:**

1. **`src/types/index.ts`** — Add to `RuntimeConfig`:
   ```typescript
   quality?: {
     enabled: boolean;
     minAutoApproveScore: number;  // 0.0–1.0, default 0.85
     blockOnFailure: boolean;      // default false
   };
   ```

2. **`src/conductor/pipeline.ts`** — Implement:
   ```typescript
   export interface SubmitResult {
     stage: PipelineStage;
     artifacts: Record<string, { score: number; passed: boolean; issues: string[] }>;
     overallScore: number;
     autoApproved: boolean;
     gateCreated: boolean;
     gateId?: string;
     nextStage?: PipelineStage;
     nextAction: string;  // human-readable instruction for the AI
   }

   export async function recordStageCompletion(
     projectId: string,
     stage: PipelineStage,
     qualityConfig: RuntimeConfig['quality'],
   ): Promise<SubmitResult>
   ```
   This function:
   - Resolves expected artifact path(s) for the stage (pm→PRD.md, research→Research.md, etc.)
   - Checks each artifact exists; if not, throws with a clear message naming the missing file
   - Calls `runQualityChecks()` on each artifact
   - Compares overall score to `minAutoApproveScore`
   - If auto-approve: calls `advanceStageOwnership()` to advance ledger
   - If gate required: calls `createWorkGate()`
   - Returns `SubmitResult`

3. **`src/cli.ts` → `handleStageCommand()`** — Parse `--submit` flag:
   - If present: call `recordStageCompletion()`, format and print result, call `writeLiveState()`
   - Output format:
     - Pass: `[s2s] <stage> submitted · quality <score> ✓ · next: s2s stage <nextStage>`
     - Fail: `[s2s] <stage> submitted · quality <score> ✗ · threshold <threshold>` + issues list
     - Gate: `[s2s] <stage> submitted · quality <score> ✓ · gate created (<gateType>)`

4. **`src/cli.ts` → `handleConfigEditCommand()`** — Add quality configuration prompts:
   ```
   Quality auto-approve threshold [0.85]: _
   Block on quality failure? [n]: _
   ```

5. **`src/cli/live-state.ts`** — Update `writeLiveState()` to handle all submit outcomes:
   - Pass → `status: 'approved'`, `nextAction: 'run s2s stage <nextStage>'`
   - Fail → `status: 'context_delivered'` (stays, not submitted), `nextAction: 'fix issues and re-submit'`
   - Gate → `status: 'gate_pending'`, `nextAction: 'run s2s approve <gateId> or s2s reject <gateId>'`

6. **`scripts/test-cli-v1-contract.sh`** — Add `--submit` test scenarios:
   - Write a minimal valid PRD.md to artifacts dir, run `--submit`, assert quality output
   - Assert `live.md` updated correctly

7. **Bump version** and add CHANGELOG entry.

---

### Phase 4 — Protocol reference + governance templates

**Branch:** `feat/phase-4-protocol-governance`
**Goal:** Generate `.s2s/protocol.md` from CLI source. Rewrite governance templates to be short,
pointer-based, and enforce the two-phase pattern. Add `s2s doctor` checks for new files.

**Acceptance criteria:**
- `s2s init` writes `.s2s/protocol.md` containing all active commands with inputs/outputs/flags/next-action
- `s2s update` regenerates `.s2s/protocol.md` if version differs
- `s2s doctor` warns if `protocol.md` or `live.md` is missing or version-mismatched
- AGENTS.md, CODEX.md, CLAUDE.md templates each: under 40 lines, contain session entry ritual,
  two-phase stage pattern, pointers to `live.md` and `protocol.md`, prohibition list
- `execute` and `resume` stub commands are NOT in `protocol.md`
- Existing projects get migration notice from `s2s doctor` if governance files use old pattern
- `npm run check` passes

**Tasks:**

1. **`src/governance/protocol-generator.ts`** (new file) — Implement:
   ```typescript
   export function generateProtocolContent(version: string): string
   ```
   Returns the full `protocol.md` content. Manually maintained (not auto-generated from help text,
   which is too verbose). Must cover every active command in the command reference table from this
   plan. Structure per command: Purpose, When to use, Arguments, Flags, Inputs, Outputs, Next action,
   Example. Excluded: `execute`, `resume` (stubs).

2. **`src/cli.ts` → `ensureConfigFiles()`** — After writing governance files, also write:
   ```typescript
   writeFileIfChanged(
     path.join(s2sDir, 'protocol.md'),
     generateProtocolContent(TEMPLATE_VERSION),
   );
   ```

3. **`src/cli.ts` → `handleUpdateCommand()`** — Add regeneration of `protocol.md` and
   validation of `live.md` existence (create if missing with current state from ledger).

4. **`src/cli.ts` → doctor checks** — Add:
   - Check `protocol.md` exists in `.s2s/`
   - Check `protocol.md` version matches current CLI template version
   - Check `live.md` exists in `.s2s/`
   - Detect old governance pattern: if AGENTS.md contains `s2s request` instruction but not
     `live.md` pointer → warn "governance templates outdated, run s2s update"

5. **`src/governance/user-project/renderers.ts`** — Rewrite `renderAgentsGuardrail()`,
   `renderCodexGuardrail()`, `renderClaudeGuardrail()` to produce the new short format:
   - Session entry: read `live.md`, orient, wait for user
   - Two-phase stage pattern (4 steps)
   - Pointer to `live.md` and `protocol.md`
   - Prohibition list (4 rules)
   - Under 40 lines each
   Each file should have the same structure but use the appropriate AI-specific language
   (AGENTS.md is generic, CODEX.md is Codex-specific, CLAUDE.md is Claude-specific).

6. **`scripts/test-cli-v1-contract.sh`** — Add assertions:
   - `.s2s/protocol.md` exists after `s2s init`
   - AGENTS.md contains `live.md` pointer
   - AGENTS.md contains prohibition list keywords
   - `s2s doctor` output does NOT warn about protocol/live files on a fresh init

7. **Bump version** (governance template change = user-facing) and add CHANGELOG entry.

---

### Phase 5 — Remove the broken path

**Branch:** `feat/phase-5-remove-cli-provider`
**Goal:** Delete `CLIProvider` and all `mode: 'cli'` dead code now that chat-native is working.

**Acceptance criteria:**
- `src/providers/cli.ts` does not exist
- `src/providers/interface.ts` has no `case 'cli'` branch
- TypeScript compiles with no errors
- `npm run check` passes completely
- No user-facing behavior change (no version bump needed unless check:self-versioning requires it)

**Tasks:**

1. Delete `src/providers/cli.ts`

2. **`src/providers/interface.ts`** — Remove:
   - `import { CLIProvider } from './cli.js'`
   - `case 'cli': { ... }` block from `createProvider()`
   - `'cli'` from `mode` type in `resolveProviderLabel()` if present

3. **`src/types/index.ts`** — Remove `'cli'` from `LLMProviderConfig.mode` union type if present

4. Search for any remaining references to `CLIProvider`, `mode: 'cli'`, `defaultLLMConfig`
   with cli args — remove or update each one

5. Run `npm run typecheck` first to catch all broken references before running full check

6. **`scripts/test-cli-v1-contract.sh`** — Remove any test that references `mode: cli` in
   `llm.json` assertions

---

### Phase 6 — Standalone mode (Path A)

**Branch:** `feat/phase-6-standalone-mode`
**Goal:** Add `execution.mode: 'standalone'` as an explicit opt-in for headless/CI use.
In standalone mode, `s2s stage <stage>` runs the existing agent pipeline with a direct API provider.

**Acceptance criteria:**
- Setting `execution.mode: 'standalone'` in `runtime.json` causes `s2s stage pm` to call the LLM pipeline
- Standalone mode requires `config/llm.json` with `mode: 'api'` and a valid API key env var
- `s2s config edit` guides through standalone setup (provider, model, API key env var)
- `s2s doctor` warns if standalone is configured but the API key env var is not set
- `s2s doctor` warns if standalone is configured but `llm.json` is missing
- Quality auto-approve logic applies in standalone mode (same as chat-native submit)
- `npm run check` passes

**Tasks:**

1. **`src/types/index.ts`** — Update `RuntimeConfig.execution.mode` union:
   ```typescript
   execution?: {
     mode: 'chat-native' | 'standalone';
   };
   ```

2. **`src/cli.ts` → `handleStageCommand()`** — Update mode guard:
   ```typescript
   const execMode = runtime.execution?.mode ?? 'chat-native';
   if (execMode === 'chat-native') {
     // Phase 2 path: output context package
   } else if (execMode === 'standalone') {
     // Phase 6 path: run agent pipeline with API provider
     const result = await runStage(projectId, stage);
     // apply quality auto-approve logic (reuse from Phase 3)
     // update live.md
   }
   ```

3. **`src/cli.ts` → `ensureConfigFiles()`** — In standalone mode only: write `config/llm.json`
   with `mode: 'api'` defaults if it doesn't exist yet.

4. **`src/cli.ts` → `handleConfigEditCommand()`** — Add standalone configuration flow:
   ```
   Execution mode (chat-native / standalone) [chat-native]: _
   // if standalone:
   Provider (anthropic / openai) [anthropic]: _
   Model [claude-sonnet-4-5-20250929]: _
   API key environment variable [ANTHROPIC_API_KEY]: _
   ```

5. **`src/cli.ts` → doctor checks** — Add:
   - If `execution.mode === 'standalone'` and `llm.json` missing: warn
   - If `execution.mode === 'standalone'` and `process.env[apiKeyVar]` not set: warn

6. **Bump version** and add CHANGELOG entry.

---

### Phase 7 — Documentation (ships with each phase, finalized here)

**Branch:** `feat/phase-7-documentation`
**Goal:** Ensure all docs reflect the chat-native architecture. Every phase should have shipped
incremental doc updates in its own PR; this phase finalizes and cross-checks everything.

**Acceptance criteria:**
- No doc file references `mode: 'cli'` as a valid configuration
- User manual describes the two-phase stage pattern end-to-end
- Technical architecture doc describes what s2s owns vs. what the AI owns
- Pitch and user summary lead with token efficiency and context preservation
- Three new docs are written and complete
- All doc files are consistent with each other

**Files to update in each phase's PR:**

| Phase | Doc files to update in that PR |
|-------|-------------------------------|
| 1 | `docs/llm-access-modes_en.md` / `_es.md` — remove `mode: 'cli'` |
| 2 | `docs/technical-architecture_en.md` — add chat-native execution model |
| 3 | `docs/user-manual_en.md` / `_es.md` — add `--submit` workflow |
| 4 | `docs/user-manual_en.md` / `_es.md` — add live.md and protocol.md sections |
| 5 | No doc changes needed |
| 6 | `docs/llm-access-modes_en.md` / `_es.md` — add standalone mode section |

**Finalization tasks (this phase's PR):**

1. Update `docs/00_ThePitch.md` — lead with token efficiency and context preservation as the
   headline product benefits. Add concrete example: "s2s reduces AI token spend by handling all
   orchestration in the binary."

2. Update `docs/02_User_summary.md` — reflect new workflow end-to-end.

3. Update `README.md` — quick-start section: `s2s init` → `s2s request` → `s2s stage pm` →
   generate artifact → `s2s stage pm --submit`.

4. Write `docs/chat-native-workflow_en.md` — complete user walkthrough: session start,
   how the AI is directed, two-phase stage pattern, session recovery, switching chat UIs.

5. Write `docs/token-efficiency_en.md` — product differentiator doc: what s2s handles in the
   binary (zero tokens), what the AI handles (focused tokens), approximate cost comparison
   vs. unguided session, how to configure quality threshold and verbose mode.

6. Write `docs/live-state_en.md` — reference doc for `.s2s/live.md`: format, all statuses,
   when it is written, how the AI uses it, how a human can read it.

7. Update `docs/execution-templates_en.md` / `_es.md` — reflect Phase 2 decision on
   `engineering_exec`.

8. Add `CHANGELOG.md` summary entry for the full rearchitecture release.

9. **No version bump needed** — doc-only phase, but verify `check:self-versioning` passes.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Chat AI does not write artifact to expected path | Context package specifies exact path; quality check on `--submit` catches missing file |
| Chat AI calls `--submit` before writing file | `recordStageCompletion` checks artifact exists; outputs clear error |
| Existing projects have `mode: 'cli'` in `llm.json` | `s2s doctor` warns and suggests `s2s config edit` to fix |
| `engineering_exec` model decision (Phase 2) | Re-evaluated explicitly before Phase 3 — decision documented and locked before implementing `--submit` |
| Governance templates out of sync with new pattern | Phase 4 updates templates + `s2s doctor` checks for old pattern |

---

## Next

After this rearchitecture stabilizes, the natural next capability is structured iteration (feedback loop, retry/fix/revise/replan). See:

- `docs/plans/iterate-capability-plan.md` — full design, chat-native compatible, ready to implement as a follow-on
- `docs/plans/plan-standalone-pipeline_en.md` — standalone/API mode (Path A), deferred opt-in
