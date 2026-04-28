---
title: "Chat-Native Workflow"
description: "In chat-native mode, s2s orchestrates intent classification, routing, state, and quality checks without spending any LLM tokens on orchestration decisions."
---

## Why this design exists

When you work with an AI coding assistant without any surrounding structure, the AI spends tokens on things that are not the actual work. It figures out what stage it is in. It reconstructs what was decided earlier in the conversation. It reasons about whether to ask a follow-up question or just proceed. None of that is artifact generation — it is workflow overhead.

Chat-native mode eliminates that overhead. s2s handles all orchestration decisions in the binary, at zero token cost. The AI's entire budget goes to generating the thing you actually needed — a PRD, a technical spec, code.

## The division of responsibility

Understanding who owns what makes the whole workflow clear.

**s2s owns:** intent classification, stage routing, context package construction, state management, quality checking, gate creation, worktree setup, git delivery. All of this runs locally in the CLI binary. None of it calls an LLM.

**Your AI client owns:** reading the context package, generating the artifact content, writing it to the specified path, running the submit command, and following the next-action instruction.

**You own:** reviewing artifacts at gates, approving or rejecting, and providing new direction when the work needs to change.

The AI does not decide what to build or how much work to do. The orchestrator decides that. The AI's job is narrow: take the task package it receives and produce the artifact described.

## How a session starts

Your AI client reads `.s2s/guardrails/` and the root shims (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`) at the start of every session. These governance files tell it how to behave in the s2s workflow. You do not need to paste any instructions into the chat — the AI loads them automatically.

After that, the AI reads `.s2s/live.md`:

```
# S2S Live State

Updated: 2026-04-24T09:15:00.000Z
Project: my-app
Feature: add rate limiting to the API

## Current State

| Field       | Value                    |
|-------------|--------------------------|
| Stage       | pm                       |
| Status      | context_delivered        |
| Route       | pm → engineering         |
| Next action | generate artifact for 'pm' stage, write to .s2s/artifacts/, then run: s2s stage pm --submit |
```

If `status` is `none`, there is no active work and the AI waits for you to submit a request. If there is active work, the AI follows the `nextAction` field. This is how the session picks up exactly where it left off, even if you are starting a new chat window or switching clients.

## Submitting a work request

You do not run s2s commands yourself. You tell your AI what you want to do, and the AI runs the s2s commands on your behalf. That is the whole point of the chat-native model — you stay in the conversation.

You say something like: "Let's add rate limiting to the API."

The AI runs:

```bash
s2s request "add rate limiting to the API"
```

The orchestrator classifies the intent against nine possible types (new feature, bug fix, investigation, refinement, hotfix, and others), selects the minimum stage route, creates the Change and Spec records, and updates `live.md` with the route and the first stage to run.

```
[s2s] request received
intent: new_feature · confidence: 0.91
route: pm → design → engineering → engineering_exec
approval required: yes
next: s2s stage pm
```

The AI reads this output and proceeds to the first stage.

## The two-phase stage pattern

Every artifact-producing stage — `pm`, `research`, `design`, `engineering` — follows the same pattern.

### Phase 1: get the task package

The AI runs:

```bash
s2s stage pm
```

s2s outputs a structured context package. This is not a prompt — it is a machine-assembled task specification built from the ledger state, the user's request, the classified intent, and the artifacts from any prior stages. It includes:

- **OBJECTIVE** — what artifact to produce and why it exists in this route
- **CONTEXT** — the user request, intent classification, and prior stage artifacts
- **ARTIFACT SPECIFICATION** — exact content requirements for this stage's output
- **File path** — where to write the artifact
- **WHEN DONE** — the exact `--submit` command to run next

s2s then updates `live.md` with `status: context_delivered` and returns. No LLM call is made. The AI now has everything it needs.

### Phase 2: generate and submit

The AI reads the context package and generates the artifact — a PRD, a Research document, a PrototypeSpec, a TechSpec and Backlog, depending on the stage. It writes the artifact to the specified path.

Then it runs:

```bash
s2s stage pm --submit
```

s2s reads the artifact, runs quality checks against the artifact specification, advances the ledger state, and outputs the result with a next-action instruction.

## What happens after submit

There are three possible outcomes, and each one tells the AI exactly what to do next.

**Quality passes, no gate required:**

```
[s2s] pm submitted · quality 91% ✓ · next: s2s stage design
```

The AI proceeds to the next stage in the route.

**Quality check fails:**

```
[s2s] pm submitted · quality 62% ✗ · threshold 85%
Issues: missing success criteria, no scope boundary defined
```

The AI fixes the issues in the artifact file and re-runs `--submit`. It does not start the stage over — it edits the existing artifact and resubmits.

**Review gate created:**

```
[s2s] pm submitted · quality 88% ✓ · gate created (gate_abc123)
waiting for: s2s approve gate_abc123
```

The AI stops and surfaces the gate to you. You review the artifact — read the PRD, check the tech spec, examine the planned slices. Then you decide.

## Approval gates

Gates are the human checkpoints. When a gate is pending, `live.md` shows `status: gate_pending`. The AI does not proceed past a gate without your explicit decision.

To approve:

```bash
s2s approve gate_abc123
```

To reject and provide new direction:

```bash
s2s reject gate_abc123
```

After rejection, `live.md` shows `status: rejected` and the AI waits for you to describe what you want to change. You can submit a new or refined request, and the orchestrator builds a new route from that point.

Gates are triggered by the orchestrator based on the classified intent and configuration. New features and requests that touch security or data typically require gates. Bug fixes often route straight through.

## How route accumulation works

When you refine existing work — "actually, let's add caching to that feature too" — the orchestrator does not start from scratch. It classifies the new intent and merges the new route into the existing effective route. If an earlier request required an approval gate, that gate policy is preserved. You cannot accidentally drop a compliance checkpoint by submitting a clarifying message.

This is what makes the workflow safe for iterative development. Each refinement builds on the established decisions rather than overwriting them.

## Session recovery

If the chat context scrolls away, the session restarts, or you switch to a different client, the AI reads `live.md` to reorient. It does not need to reconstruct state from the conversation history. The file always contains the current stage, status, and next action.

```bash
cat .s2s/live.md
```

This is also true when switching AI clients. If you move from Claude Code to Codex mid-project, the new client reads the same governance files and `live.md`. The session continues seamlessly.

## Engineering execution

`s2s stage engineering_exec` is different from the other stages. It does not use the two-phase task/submit pattern. Instead, it spawns a configured AI agent in an isolated git worktree to implement the code directly.

The worktree is a clean branch separate from your working directory:

```
s2s-claude/add-rate-limiting   ← isolated worktree branch
main                           ← your working directory, untouched
```

After `engineering_exec` completes, s2s records the result and updates `live.md`. Your main branch is clean until you review and choose to merge.
