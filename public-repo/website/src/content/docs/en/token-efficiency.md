---
title: "Token Efficiency"
description: "s2s eliminates AI token overhead from workflow reasoning, state reconstruction, and orientation, keeping the AI focused on artifact generation."
---

## Where tokens go in an unguided session

Every AI coding session has a budget. The question is how much of that budget goes to the work you actually wanted — writing a PRD, producing a TechSpec, generating code — versus how much goes to the overhead of figuring out where you are and what to do next.

In an unguided session, the overhead is substantial. Without external state, the AI reconstructs context from the conversation history on every turn:

- What stage are we in? Re-read prior messages.
- What was decided in the PM phase? Re-summarize prior artifacts.
- Should I ask a follow-up or proceed? Reason about workflow position.
- Is that artifact saved somewhere, or do I need to regenerate it? Uncertainty about prior work.

For a medium-complexity feature going through PM and Engineering, this overhead typically runs 1,500–3,000 tokens across two stages — before any actual artifact is written. In long-running projects with many prior decisions, it is worse. The AI is spending a significant fraction of its context window re-reading history it should not have to touch.

## How s2s eliminates orchestration overhead

Every workflow decision that s2s makes runs in the CLI binary at zero LLM token cost:

| Operation | Token cost |
|-----------|-----------|
| Intent classification | 0 |
| Stage route planning | 0 |
| Context package construction | 0 |
| `.s2s/live.md` state update | 0 |
| Artifact quality assessment | 0 |
| Ledger advancement | 0 |
| Gate creation and lifecycle | 0 |
| Worktree setup and isolation | 0 |
| Git delivery (branch, push, PR) | 0 |

None of this calls an LLM. The orchestrator runs locally, reads from structured files, and writes back to structured files. Your AI chat budget is untouched by every one of these operations.

## What the AI gets instead

Rather than reconstructing context from conversation history, the AI receives a context package assembled by the conductor for this specific stage and this specific request. The package contains:

- The original user request and its classified intent
- Where this stage sits in the route
- Prior stage artifacts, summarized and structured — not the raw conversation
- The exact content requirements for this stage's artifact
- The exact file path to write to
- The exact command to run when done

The AI reads the package, generates the artifact, and submits. It does not need to remember anything from prior turns because the package contains exactly what is relevant.

## The numbers

For a medium-complexity feature going through `pm → engineering`:

**Without s2s:**

| Activity | Token estimate |
|----------|---------------|
| Session orientation (re-reading history) | 500–1,000 |
| Reconstructing prior decisions per stage | 300–800 |
| Workflow reasoning per stage | 200–500 |
| Total overhead across two stages | 1,500–3,000 |

**With s2s:**

| Activity | Token estimate |
|----------|---------------|
| Reading `live.md` at session start | ~150 |
| Receiving context package per stage | ~200–400 (focused, no redundancy) |
| Total overhead across two stages | ~200–500 |

That is roughly a 6–10x reduction in token overhead for a two-stage feature. The AI's entire remaining budget goes to the PRD and the TechSpec — the things you actually needed.

The benefit scales with project complexity. On a long-running project with ten prior stages of decisions, the AI would need to reconstruct an enormous amount of history without s2s. With s2s, the context package contains exactly the prior decisions relevant to this stage. The conversation history is irrelevant.

## Why focused context beats full history

There is a temptation to think that giving the AI more context is always better. In practice, it is not. Longer context windows mean more tokens spent on retrieval and reasoning, more noise mixed with signal, and higher cost per request.

s2s takes the opposite approach: give the AI exactly what it needs for this stage, nothing more. The context package for the Engineering stage contains the PRD summary and the research findings — not the full conversation thread that produced them. The AI gets signal without noise.

This is also why `.s2s/live.md` is the orientation primitive rather than `s2s status`. Reading `live.md` costs around 150 tokens. Running `s2s status` and reading its output costs around 400 tokens. Over many sessions and many stages, that difference compounds.

## What this means for cost

If you are using a paid AI API in standalone mode, the efficiency gains translate directly to lower cost per feature. The orchestration overhead that s2s eliminates is pure waste — tokens that went to workflow reasoning rather than to the artifact your project needed.

For teams running AI-assisted development at scale, eliminating 1,500–3,000 tokens of overhead per feature, across dozens of features per month, is a meaningful reduction in API spend.

In chat-native mode (the default), you are working within your AI client's existing subscription or session — the token savings mean you hit context limits later and session quality stays higher for longer.

## Configuring quality checks

Quality checks run on `--submit`. They are the only place where s2s evaluates artifact content — and even this runs locally, not through an LLM call. The quality score determines whether the artifact advances automatically or requires a review gate.

```json
{
  "quality": {
    "enabled": true,
    "minAutoApproveScore": 0.85,
    "blockOnFailure": false
  }
}
```

`minAutoApproveScore` is a 0.0–1.0 threshold. Artifacts that score above it advance to the next stage automatically. Artifacts below it return a failure message listing what is missing, and the AI fixes and resubmits. The default is 0.85.

`blockOnFailure` controls whether a quality failure exits with a non-zero code. Useful in CI pipelines where you want quality failures to be hard failures. Defaults to false.

Update these settings with `s2s config edit`.
