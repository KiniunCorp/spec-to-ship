# Spec-To-Ship — Iterate Capability Plan

Document Version: 1.1
Status: draft
Target: v0.3.x (after chat-native rearchitecture stabilizes)
Last Updated: 2026-04-10

> **Chat-native update (v1.1):** This plan has been revised to align with the chat-native
> architecture (`docs/plans/plan-chat-native-architecture_en.md`). The core design —
> feedback model, iteration actions taxonomy, state model, implementation phases —
> is unchanged. What changed: the CLI surface follows the two-phase pattern, the
> chat AI makes iteration decisions (not an internal LLM call), and `s2s iterate`
> assembles context packages instead of running its own orchestrator pipeline.
> `autoRetryOnTransientFailure` is deferred to standalone mode only.

---

## 1. Why this matters

The core promise of S2S is governed, traceable, safe iteration through work. Today, S2S handles the forward path well: request → plan → spec → slice → execute → deliver. But the **feedback loop** — the path back from execution results to the next action — is manual and unstructured.

In real development, the forward path runs once. The iteration loop runs many times:
- A slice executes but tests fail
- A PR gets review comments
- A gate is rejected with feedback
- The user realizes mid-execution that the spec needs adjustment
- Execution reveals that the technical approach was wrong
- One slice's output changes the requirements for the next slice

Currently, the user handles these by manually re-running stages with `--refine` or creating new work from scratch. There's no structured way to feed results back into the orchestrator, track iteration history, or coordinate follow-up work.

This plan describes a real iterate capability that closes the feedback loop.

---

## 2. What iterate means in S2S

Iterate is not a single stage. It is a **feedback-driven re-entry mechanism** that:

1. Accepts structured input about what happened (execution results, review feedback, test failures, user observations)
2. Assembles a context package for the chat AI to decide what kind of follow-up is needed (re-run, new slice, spec revision, stage re-entry)
3. The chat AI produces the artifact or fix with full context of what was tried before
4. `s2s iterate --submit` records the decision, creates the follow-up work units, and outputs the next instruction
5. Preserves the full iteration history for traceability

In chat-native mode: **s2s assembles context and records outcomes; the chat AI decides and generates.** This is the same pattern as all other stages.

Iterate operates at multiple levels:
- **Slice-level**: retry or fix a single slice based on execution feedback
- **Spec-level**: revise the spec based on review feedback, then re-derive slices
- **Change-level**: adjust the overall change scope based on what was learned during execution

---

## 3. Current state (v0.2.x)

What exists:
- `--refine` flag re-runs `initializeSpec` with a refinement-aware prompt
- `feature_refinement` intent reuses the active change and can create additive spec versions
- `createRefinementSpecVersion` creates v2/v3 specs linked to prior versions
- Gates can be rejected, which blocks progression
- Run records track `succeeded`/`failed` status with evidence

What's missing:
- No structured feedback input mechanism
- No iteration history tracking (attempt count, what changed between attempts)
- No automatic follow-up slice creation from failed runs
- No way to feed PR review comments or test output back as context
- No re-run with updated constraints (same slice, different approach)
- No coordination between "this slice failed" and "create a targeted fix slice"
- No concept of iteration budget or max-retry limits

---

## 4. Design principles

### 4.1 Feedback is first-class input
Iteration starts with structured feedback, not just a flag. The feedback has a source (user, test runner, PR review, execution failure), content, and target (which slice, run, spec, or change it applies to).

### 4.2 Additive, never destructive
Iteration creates new work units (slices, runs, spec versions). It never overwrites completed history. The full chain of attempts is preserved.

### 4.3 AI-driven decisions via chat-native context
The chat AI decides what follow-up is needed based on the iteration context package that `s2s iterate` assembles. The package contains the feedback, prior attempt evidence, iteration history, and available actions. The user can override by specifying `--action` on `--submit`. s2s does not make LLM calls to classify feedback — the chat session's AI handles this naturally.

### 4.4 Budget-aware
Iteration should have configurable limits to prevent infinite loops: max retries per slice, max spec revisions per change, cost thresholds.

### 4.5 Context-carrying
Each iteration attempt carries forward the full context of prior attempts — what was tried, what failed, what the feedback said. The context package includes this history so the AI doesn't repeat the same mistakes.

---

## 5. Feedback model

### 5.1 Feedback sources

| Source | Trigger | Content |
|---|---|---|
| **Execution failure** | Run completes with `status=failed` | Error output, test failures, verification result |
| **PR review** | User provides review comments | Review text, requested changes, file-specific notes |
| **Gate rejection** | `s2s reject <gateId>` with a note | Rejection reason, reviewer guidance |
| **User observation** | User runs `s2s iterate` with a message | Freeform text describing what needs to change |
| **Test output** | External test runner results | Test names, failure messages, stack traces |

### 5.2 Feedback entity

```typescript
interface WorkFeedback {
  id: string;
  projectId: string;
  changeId: string;
  source: 'execution_failure' | 'pr_review' | 'gate_rejection' | 'user_observation' | 'test_output';
  targetKind: 'slice' | 'run' | 'spec' | 'change';
  targetId: string;
  content: string;
  structuredData?: {
    testFailures?: Array<{ name: string; message: string; file?: string }>;
    reviewComments?: Array<{ file: string; line?: number; body: string }>;
    errorOutput?: string;
  };
  createdAt: string;
}
```

### 5.3 Iteration record

```typescript
interface WorkIteration {
  id: string;
  projectId: string;
  changeId: string;
  specId: string;
  sourceSliceId?: string;
  sourceRunId?: string;
  feedbackIds: string[];
  action: 'retry_slice' | 'fix_slice' | 'revise_spec' | 'add_slice' | 'replan';
  resultSliceId?: string;
  resultSpecId?: string;
  attempt: number;
  maxAttempts: number;
  status: 'planned' | 'in_progress' | 'succeeded' | 'failed' | 'abandoned';
  context: string; // accumulated context assembled for the AI
  createdAt: string;
  completedAt?: string;
}
```

---

## 6. Iteration actions

When feedback arrives, the chat AI reads the context package and decides which action to take. The user confirms (or overrides with `--action`) when running `--submit`.

### 6.1 Retry slice (`retry_slice`)
**When**: Execution failed due to transient or fixable issues. The slice scope is correct, just the implementation attempt failed.
**What happens**: The AI addresses the failure and instructs `s2s iterate --submit --action retry_slice`. s2s creates a new Run for the same Slice carrying forward the prior attempt evidence and feedback.
**Example**: Tests failed because of a missing import. The AI fixes the import and submits.

### 6.2 Fix slice (`fix_slice`)
**When**: Execution produced output but it doesn't meet acceptance criteria. A targeted fix is needed.
**What happens**: The AI produces a narrower fix (specific files, specific checks) and submits. s2s creates a new child Slice linked to the source Slice with a narrowed scope.
**Example**: PR review says "the error handling in auth.ts doesn't cover the timeout case."

### 6.3 Revise spec (`revise_spec`)
**When**: Feedback indicates the specification itself needs updating — the approach was wrong, requirements changed, or new constraints were discovered during execution.
**What happens**: The AI produces a revised spec artifact. `s2s iterate --submit --action revise_spec` calls `createRefinementSpecVersion`. Existing incomplete slices may be updated or cancelled. New slices are derived from the revised spec.
**Example**: During implementation, the team discovers the chosen API doesn't support pagination.

### 6.4 Add slice (`add_slice`)
**When**: The current slices are fine but something additional is needed that wasn't in the original plan.
**What happens**: The AI produces a new Slice definition artifact. s2s creates a new Slice attached to the current Spec with explicit dependency on the completed slices.
**Example**: After implementing the dashboard, the team realizes they also need a loading skeleton.

### 6.5 Replan (`replan`)
**When**: The feedback is fundamental enough that the entire engineering plan needs rethinking. Multiple slices are affected.
**What happens**: The AI produces updated TechSpec.md + Backlog.md. `s2s iterate --submit --action replan` re-enters the engineering stage flow, cancels incomplete slices, and derives new ones.
**Example**: The technical approach doesn't work at all. Need a different architecture.

---

## 7. CLI surface

### 7.1 Two-phase pattern

`s2s iterate` follows the same two-phase pattern as all other s2s commands:

**Phase 1 — Get context:**
```bash
# Iterate with freeform feedback
s2s iterate "the login timeout handling is wrong, needs exponential backoff"

# Iterate on a specific slice
s2s iterate --slice <sliceId> "acceptance check 2 is failing"

# Iterate on a specific run (s2s loads the run's failure evidence automatically)
s2s iterate --run <runId>

# Iterate from a gate rejection (s2s loads the rejection note automatically)
s2s iterate --gate <gateId>

# Iterate with test output piped in
cat test-results.json | s2s iterate --source test_output --slice <sliceId>

# Preview context without changing state
s2s iterate "..." --context
```

`s2s iterate` (Phase 1) outputs a structured context package — the iteration task for the chat AI. No LLM call is made. The AI reads the package, decides the action, and produces the fix/artifact.

**Phase 2 — Record completion:**
```bash
# Record after the AI has produced the fix; s2s infers action from context when possible
s2s iterate --submit

# Specify the action explicitly (AI tells you which one to use in the context package)
s2s iterate --submit --action retry_slice
s2s iterate --submit --action fix_slice
s2s iterate --submit --action revise_spec
s2s iterate --submit --action add_slice
s2s iterate --submit --action replan

# JSON output for automation
s2s iterate --submit --action fix_slice --json
```

### 7.2 Context package format

```
=== S2S ITERATE: fix_slice context for slice-build-dashboard ===

OBJECTIVE
Address the failure feedback below. Produce the fix, then run:
  s2s iterate --submit --action fix_slice

ITERATION HISTORY
- Attempt 1 (run-abc): FAILED
  Verification: 2 of 5 acceptance checks passed
  Failed: "Dashboard renders with gate status", "Loading skeleton appears"

FEEDBACK
- Source: PR review
- Target: slice-build-dashboard (run-abc)
- Content: "The gate status component doesn't handle the 'pending' state.
  Also, the loading skeleton should use the design system's Skeleton component."

SLICE SCOPE (unchanged)
[original slice definition]

CONSTRAINTS FROM PRIOR ATTEMPTS
- Do not re-implement the header component (already correct in prior run)
- Focus on: src/components/GateStatus.tsx, src/components/DashboardSkeleton.tsx
- Must pass all 5 acceptance checks before submitting

ITERATION BUDGET
- Attempt: 2 of 3 (max retries for this slice)

WHEN DONE
After producing the fix, run:
  s2s iterate --submit --action fix_slice
======================================================
```

### 7.3 After failed `s2s stage engineering_exec`

When `engineering_exec` produces a failed run, its output includes the iterate instruction:

```
== Execution Result ==
- [FAIL] slice-build-dashboard: verification failed (2/5 checks)

Run `s2s iterate --run run-xyz` to get the iteration context package.
```

### 7.4 Inspection commands

```bash
s2s show slice <sliceId>    # shows iteration history (attempts, feedback, child slices)
s2s show iterations         # lists all iteration records for the active change
s2s show run <runId>        # shows linked feedback and iteration actions
```

---

## 8. Context assembly

### 8.1 What s2s assembles

`s2s iterate` (Phase 1) assembles and outputs the iteration context package. The package contains:

1. **Run evidence** — if `--run` is specified: error output, test failures, verification result from the run record
2. **Feedback content** — user message, gate rejection note, or piped test output
3. **Iteration history** — prior attempt summaries for this slice (attempt number, what failed, what the feedback was)
4. **Slice scope** — the original slice definition (scope, acceptance criteria, files)
5. **Iteration budget** — current attempt count vs. max, cost budget remaining
6. **Available actions** — the 5 action types with brief descriptions so the AI can choose
7. **Explicit constraints from prior attempts** — what the AI should NOT repeat
8. **WHEN DONE instruction** — the exact `s2s iterate --submit --action <action>` command

The AI reads this package, decides the action, does the work, and calls `--submit`.

### 8.2 What s2s records on `--submit`

`s2s iterate --submit --action <action>` does:

1. Reads the `--action` value (required; the AI specifies this in the context package WHEN DONE instruction)
2. Creates the appropriate work units:
   - `retry_slice` → new Run for the same Slice
   - `fix_slice` → new child Slice linked to source
   - `revise_spec` → calls `createRefinementSpecVersion`, cancels incomplete slices
   - `add_slice` → new Slice attached to current Spec
   - `replan` → re-enters engineering stage flow
3. Persists the WorkIteration record with status, feedbackIds, resultSliceId/Spec
4. Updates the ledger and live.md
5. Outputs next-action instruction (e.g., `s2s stage engineering_exec` for retry/fix actions)

### 8.3 Budget enforcement

Before outputting the context package, `s2s iterate` checks:
- If `attempt >= maxAttempts` for this slice → outputs budget-exhausted warning; user must explicitly override with `--force` to proceed
- If cost budget is near the threshold → includes warning in the context package

---

## 9. State model changes

### 9.1 New entities
- `WorkFeedback` — persisted in `.s2s/artifacts/<projectId>/feedback/<feedbackId>.json`
- `WorkIteration` — persisted in `.s2s/artifacts/<projectId>/iterations/<iterationId>.json`

### 9.2 Entity extensions

**WorkSlice** — add:
```typescript
parentSliceId?: string;        // if this is a fix-slice, links to the source
iterationIds?: string[];       // iteration records for this slice
maxAttempts?: number;          // iteration budget for this slice
```

**WorkRun** — add:
```typescript
feedbackIds?: string[];        // feedback that triggered or resulted from this run
iterationId?: string;          // which iteration record this run belongs to
attempt?: number;              // attempt number within the iteration
```

**WorkSpec** — already has:
```typescript
refinedFromSpecId?: string;    // links to prior version (already exists)
refinementReason?: string;     // why the revision happened (already exists)
```

**WorkLedger** — add:
```typescript
feedbackIds?: string[];
iterationIds?: string[];
```

### 9.3 Configuration

```json
{
  "iteration": {
    "maxRetriesPerSlice": 3,
    "maxSpecRevisionsPerChange": 5,
    "requireApprovalForReplan": true,
    "autoRetryOnTransientFailure": false
  }
}
```

> **Note:** `autoRetryOnTransientFailure` only applies in standalone mode (where s2s makes direct LLM API calls). In chat-native mode (default), s2s never executes autonomously — the user is always in the loop.

---

## 10. Implementation phases

> Each phase ships on its own branch (`feat/iterate-phase-N-short-name`) with its own PR into `main`. Before starting: `git checkout main && git pull && git checkout -b feat/iterate-phase-N-short-name`. Run `npm run check` before PR. Bump version and add CHANGELOG entry for any user-facing change.

### Phase 1: Feedback ingestion and storage
- Add `WorkFeedback` entity type and store
- Add `s2s iterate "<message>"` command (Phase 1 only: outputs context package placeholder, no --submit yet)
- Add `--slice`, `--run`, `--gate` targeting flags
- Persist feedback in artifacts (feedback is stored even before action is decided)
- Display feedback in `s2s show run` and `s2s show slice`

### Phase 2: Context package output
- Implement the full context package format for `s2s iterate` Phase 1
- Load run evidence, iteration history, slice scope, budget into package
- Add `--context` flag for preview without state change
- Add `--submit --action <action>` flag to record completion
- Implement all 5 action handlers (create Run / Slice / Spec / replan)
- Add WorkIteration entity type and store
- Wire budget enforcement (check maxAttempts before outputting context)

### Phase 3: Engineering exec integration
- After failed `engineering_exec`, output iterate instruction automatically
- `s2s show run <runId>` shows linked feedback and iterate options
- `s2s iterate --run <runId>` auto-loads run failure evidence into context package

### Phase 4: Spec revision and replanning
- Wire `revise_spec` action through `createRefinementSpecVersion` with feedback context
- Implement `replan` action: re-enter engineering stage flow with feedback
- Cancel incomplete slices when spec is revised
- Derive new slices from revised spec

### Phase 5: Coordination and UX
- Add `s2s show iterations` command
- Add iteration history to `s2s show slice`
- Surface iteration count in `s2s status`
- Add iteration budget warnings when approaching limits
- Governance template updates: document iterate pattern in AGENTS.md / CODEX.md / CLAUDE.md

---

## 11. What this enables

With a real iterate capability, the S2S workflow becomes:

```
s2s request "build a release dashboard"
  → orchestrator plans: pm → design → engineering → engineering_exec

s2s stage pm        (chat-native: AI generates PRD → s2s stage pm --submit)
s2s stage design    (chat-native: AI generates design spec → s2s stage design --submit)
s2s stage engineering
  → AI generates TechSpec.md + Backlog.md
s2s stage engineering --submit
  → slices derived: slice-1 (dashboard), slice-2 (gates), slice-3 (tests)

s2s stage engineering_exec
  → slice-1 executes, tests fail on gate status component
  → output: "Run s2s iterate --run run-abc to get iteration context"

s2s iterate --run run-abc
  → context package output: failure evidence, iteration history, WHEN DONE instruction
  → AI reads package, fixes GateStatus.tsx and DashboardSkeleton.tsx
s2s iterate --submit --action fix_slice
  → child slice created and linked, attempt recorded
  → output: "Run s2s stage engineering_exec to continue"

s2s stage engineering_exec
  → slice-2 executes, PR review has comments

s2s iterate --slice slice-2 "reviewer says: use the design system Skeleton component"
  → context package: slice scope, prior run evidence, reviewer feedback
  → AI applies fix
s2s iterate --submit --action fix_slice
  → fix recorded, reviewer approves

s2s stage engineering_exec
  → slice-3 executes successfully
  → all slices done, change complete
```

This is the workflow we've been doing manually. S2S provides the structured context while the chat AI handles the actual decisions and fixes — keeping the human in the loop for approvals.

---

## 12. Dependencies and risks

**Dependencies:**
- Artifact store needs new entity types (feedback, iteration) — low risk, follows existing pattern
- `s2s iterate` context package assembly depends on chat-native phase being complete (Phase 2 of chat-native rearchitecture provides the template)
- `SLICE_CONTEXT.md` generation needs iteration context — low risk, additive
- Runtime config needs iteration settings — low risk

**Risks:**
- Iteration budget enforcement must be robust to prevent cost runaway (user always in loop in chat-native, lower risk than standalone)
- Context package for execution agents must be concise enough to be useful (not dump entire history) — token efficiency applies here
- The line between "retry" and "fix" may be unclear — the context package should describe both and let the AI choose; `--submit --action` makes the decision explicit
- In chat-native mode, the AI might not follow the WHEN DONE instruction and skip `--submit` — context package must make this very clear

---

## 13. Open questions

1. Should `s2s iterate` be a separate command or a mode of `s2s stage`? (Current plan: separate)
2. Should failed runs automatically suggest iteration, or require explicit user action? (Current plan: suggest, not auto-execute)
3. How much prior-attempt context should the context package include? (Full history vs. summary — token efficiency constraint)
4. Should iteration work across changes, or only within the active change?
5. Should there be a "give up" action that marks a slice as abandoned with a reason?
6. How should iteration interact with the `--refine` flag? (Replace it? Complement it?)
7. Should the AI be allowed to propose a different action than the one suggested in the context package? (Yes, via `--submit --action <different-action>` override)
8. In standalone mode: should `autoRetryOnTransientFailure` use the same context package format, or bypass it entirely?
